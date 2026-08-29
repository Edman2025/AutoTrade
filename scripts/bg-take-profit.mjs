import { createRequire } from "node:module";
import { unlinkSync } from "node:fs";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { BN } from "@coral-xyz/anchor";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { decryptVault } from "./wallet-vault.mjs";

const require = createRequire(import.meta.url);
const DLMM = require("@meteora-ag/dlmm");

const MINT = {
  sol: new PublicKey("So11111111111111111111111111111111111111112"),
  usdt: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  antfun: new PublicKey("CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt"),
  bg: new PublicKey("HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan"),
};

const POOL = {
  solUsdt: new PublicKey("C8G7RiugU2cznu7SAtCJ9aAShEzFEELUCm87ydRW8fSZ"),
  antfunUsdt: new PublicKey("54Vp27uLaw4wNLo5n7r4fcC6zLamoQc28xBARjss4EUJ"),
  bgAntfun: new PublicKey("AJJxmAV2C2WTHVHD4FEP71Vt8Rdu5day1v4Pr1FJPXEy"),
};

const ENTRY_LAMPORTS = 10_000_000n;
const ENTRY_BG_RAW = 496_500_584n;
const DEFAULT_TARGET_LAMPORTS = 10_300_000n;
const DEFAULT_LEG_SLIPPAGE_BPS = 100;
const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet.solana.com";
const broadcast = process.argv.includes("--broadcast");
const simulateFirstLeg = process.argv.includes("--simulate-first-leg");
const targetLamports = BigInt(
  process.argv.find((arg) => arg.startsWith("--target-lamports="))?.split("=")[1]
    ?? process.env.BG_TAKE_PROFIT_TARGET_LAMPORTS
    ?? DEFAULT_TARGET_LAMPORTS,
);
const legSlippageBps = Number(
  process.argv.find((arg) => arg.startsWith("--leg-slippage-bps="))?.split("=")[1]
    ?? process.env.BG_TAKE_PROFIT_LEG_SLIPPAGE_BPS
    ?? DEFAULT_LEG_SLIPPAGE_BPS,
);

if (!Number.isInteger(legSlippageBps) || legSlippageBps < 1 || legSlippageBps > 100) {
  throw new Error("Per-leg slippage must be an integer from 1 to 100 bps so compounded route slippage stays below 3%.");
}
if (targetLamports < DEFAULT_TARGET_LAMPORTS) {
  throw new Error("Refusing a target below 0.0103 SOL, the authorized +3% take-profit threshold.");
}

const dataDir = resolve(".autotrade");
const statePath = resolve(dataDir, "bg-take-profit.json");
const lockPath = resolve(dataDir, "bg-take-profit.lock");
await mkdir(dataDir, { recursive: true, mode: 0o700 });

let lockHandle;
try {
  lockHandle = await open(lockPath, "wx", 0o600);
  await lockHandle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  const ageMs = Date.now() - (await stat(lockPath)).mtimeMs;
  if (ageMs < 15 * 60 * 1000) {
    console.log(JSON.stringify({ status: "skipped", reason: "another take-profit check is running" }));
    process.exit(0);
  }
  await unlink(lockPath);
  lockHandle = await open(lockPath, "wx", 0o600);
  await lockHandle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
}
process.on("exit", () => {
  try { unlinkSync(lockPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
});

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function asSol(raw) {
  return Number(raw) / LAMPORTS_PER_SOL;
}

function asToken(raw) {
  return Number(raw) / 1e6;
}

function bn(raw) {
  return new BN(raw.toString());
}

try {
  const vault = await decryptVault();
  const wallet = Keypair.fromSeed(
    derivePath(
      vault.derivation.solana,
      mnemonicToSeedSync(vault.mnemonic).toString("hex"),
    ).key,
  );
  const connection = new Connection(rpcUrl, "confirmed");

  async function tokenBalance(mint) {
    const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);
    try {
      return BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
    } catch (error) {
      if (/could not find account|Invalid param/i.test(error.message)) return 0n;
      throw error;
    }
  }

  async function balances() {
    const [sol, bg, antfun, usdt] = await Promise.all([
      connection.getBalance(wallet.publicKey, "confirmed"),
      tokenBalance(MINT.bg),
      tokenBalance(MINT.antfun),
      tokenBalance(MINT.usdt),
    ]);
    return { sol: BigInt(sol), bg, antfun, usdt };
  }

  async function cpQuote(amountIn) {
    const cpAmm = new CpAmm(connection);
    const poolState = await cpAmm.fetchPoolState(POOL.bgAntfun);
    const slot = await connection.getSlot("confirmed");
    const currentTime = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    const quote = cpAmm.getQuote({
      inAmount: bn(amountIn),
      inputTokenMint: MINT.bg,
      slippage: legSlippageBps,
      poolState,
      currentTime,
      currentSlot: slot,
      tokenADecimal: 6,
      tokenBDecimal: 6,
      hasReferral: false,
    });
    return { cpAmm, poolState, quote };
  }

  async function dlmmQuote(poolAddress, amountIn, swapForY) {
    const pool = await DLMM.create(connection, poolAddress);
    const binArrays = await pool.getBinArrayForSwap(swapForY, 4);
    const quote = pool.swapQuote(
      bn(amountIn),
      swapForY,
      new BN(legSlippageBps),
      binArrays,
      false,
    );
    if (!BigInt(quote.consumedInAmount.toString()) || BigInt(quote.consumedInAmount.toString()) !== amountIn) {
      throw new Error(`Pool ${poolAddress.toBase58()} cannot consume the full input amount.`);
    }
    return { pool, quote };
  }

  async function quoteFullRoute(bgAmount) {
    const leg1 = await cpQuote(bgAmount);
    const minAntfun = BigInt(leg1.quote.minSwapOutAmount.toString());
    const leg2 = await dlmmQuote(POOL.antfunUsdt, minAntfun, true);
    const minUsdt = BigInt(leg2.quote.minOutAmount.toString());
    const leg3 = await dlmmQuote(POOL.solUsdt, minUsdt, false);
    return {
      minAntfun,
      minUsdt,
      minSol: BigInt(leg3.quote.minOutAmount.toString()),
      expectedAntfun: BigInt(leg1.quote.swapOutAmount.toString()),
      expectedUsdtFromConservativeInput: BigInt(leg2.quote.outAmount.toString()),
      expectedSolFromConservativeInput: BigInt(leg3.quote.outAmount.toString()),
    };
  }

  async function simulateOnly(label, transaction) {
    const simulationBlockhash = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = wallet.publicKey;
    transaction.recentBlockhash = simulationBlockhash.blockhash;
    transaction.sign(wallet);
    const simulation = await connection.simulateTransaction(transaction);
    if (simulation.value.err) {
      throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}\n${(simulation.value.logs ?? []).join("\n")}`);
    }
    return simulation.value;
  }

  async function simulateAndSend(label, transaction) {
    await simulateOnly(label, transaction);
    const sendBlockhash = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = sendBlockhash.blockhash;
    transaction.sign(wallet);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const confirmation = await connection.confirmTransaction(
      { signature, ...sendBlockhash },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new Error(`${label} failed on chain: ${JSON.stringify(confirmation.value.err)}`);
    }
    console.log(JSON.stringify({ event: "transaction-confirmed", label, signature }));
    return signature;
  }

  async function buildBgToAntfun(amountIn) {
    const { cpAmm, poolState, quote } = await cpQuote(amountIn);
    return cpAmm.swap({
      payer: wallet.publicKey,
      pool: POOL.bgAntfun,
      inputTokenMint: MINT.bg,
      outputTokenMint: MINT.antfun,
      amountIn: bn(amountIn),
      minimumAmountOut: quote.minSwapOutAmount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
      poolState,
    });
  }

  async function sellBgToAntfun(amountIn) {
    const transaction = await buildBgToAntfun(amountIn);
    return simulateAndSend("BG->ANTFUN", transaction);
  }

  async function swapDlmm({ label, poolAddress, inToken, outToken, amountIn, swapForY }) {
    const { pool, quote } = await dlmmQuote(poolAddress, amountIn, swapForY);
    const transaction = await pool.swap({
      inToken,
      outToken,
      inAmount: quote.consumedInAmount,
      minOutAmount: quote.minOutAmount,
      lbPair: poolAddress,
      user: wallet.publicKey,
      binArraysPubkey: quote.binArraysPubkey,
    });
    return simulateAndSend(label, transaction);
  }

  let state = await readState();
  const current = await balances();

  if (state?.status === "complete") {
    console.log(JSON.stringify({ status: "complete", state }));
    process.exit(0);
  }

  if (state?.status !== "triggered") {
    if (current.bg === 0n) {
      console.log(JSON.stringify({ status: "no-position", wallet: wallet.publicKey.toBase58() }));
      process.exit(0);
    }
    if (current.antfun !== 0n || current.usdt !== 0n) {
      throw new Error("Unexpected ANTFUN or USDT balance exists; refusing to mix it into the take-profit route.");
    }

    const route = await quoteFullRoute(current.bg);
    const shouldTrigger = route.minSol >= targetLamports;
    const quoteResult = {
      status: shouldTrigger ? (broadcast ? "triggering" : "target-reached-dry-run") : "waiting",
      checkedAt: new Date().toISOString(),
      wallet: wallet.publicKey.toBase58(),
      bgBalance: asToken(current.bg),
      bgBalanceRaw: current.bg.toString(),
      entry: { sol: asSol(ENTRY_LAMPORTS), bg: asToken(ENTRY_BG_RAW) },
      targetSol: asSol(targetLamports),
      conservativeRouteSol: asSol(route.minSol),
      expectedRouteSol: asSol(route.expectedSolFromConservativeInput),
      progressToTargetPct: Number((route.minSol * 10_000n) / targetLamports) / 100,
      route: ["BG", "ANTFUN", "USDT", "SOL"],
      slippage: `${legSlippageBps / 100}% per leg; ${(1 - (1 - legSlippageBps / 10_000) ** 3) * 100}% compounded maximum`,
    };
    console.log(JSON.stringify(quoteResult));
    if (simulateFirstLeg) {
      const simulation = await simulateOnly("BG->ANTFUN", await buildBgToAntfun(current.bg));
      console.log(JSON.stringify({
        status: "first-leg-simulation-passed",
        unitsConsumed: simulation.unitsConsumed,
      }));
    }
    if (!shouldTrigger || !broadcast) process.exit(0);

    state = {
      version: 1,
      status: "triggered",
      phase: "sell-bg",
      triggeredAt: new Date().toISOString(),
      wallet: wallet.publicKey.toBase58(),
      entryLamports: ENTRY_LAMPORTS.toString(),
      entryBgRaw: ENTRY_BG_RAW.toString(),
      targetLamports: targetLamports.toString(),
      triggerMinSol: route.minSol.toString(),
      startingSolLamports: current.sol.toString(),
      signatures: [],
    };
    await writeState(state);
  }

  if (!broadcast) {
    console.log(JSON.stringify({ status: "resume-required", state }));
    process.exit(0);
  }

  let live = await balances();
  if (live.bg > 0n) {
    const signature = await sellBgToAntfun(live.bg);
    state.signatures.push({ leg: "BG->ANTFUN", signature });
    state.phase = "sell-antfun";
    await writeState(state);
    live = await balances();
  }

  if (live.antfun > 0n) {
    const signature = await swapDlmm({
      label: "ANTFUN->USDT",
      poolAddress: POOL.antfunUsdt,
      inToken: MINT.antfun,
      outToken: MINT.usdt,
      amountIn: live.antfun,
      swapForY: true,
    });
    state.signatures.push({ leg: "ANTFUN->USDT", signature });
    state.phase = "sell-usdt";
    await writeState(state);
    live = await balances();
  }

  if (live.usdt > 0n) {
    const signature = await swapDlmm({
      label: "USDT->SOL",
      poolAddress: POOL.solUsdt,
      inToken: MINT.usdt,
      outToken: MINT.sol,
      amountIn: live.usdt,
      swapForY: false,
    });
    state.signatures.push({ leg: "USDT->SOL", signature });
    state.phase = "verify";
    await writeState(state);
    live = await balances();
  }

  if (live.bg !== 0n || live.antfun !== 0n || live.usdt !== 0n) {
    throw new Error(`Take-profit route did not finish cleanly: BG=${live.bg}, ANTFUN=${live.antfun}, USDT=${live.usdt}`);
  }

  state.status = "complete";
  state.phase = "complete";
  state.completedAt = new Date().toISOString();
  state.endingSolLamports = live.sol.toString();
  state.netSolChangeLamports = (live.sol - BigInt(state.startingSolLamports)).toString();
  await writeState(state);
  console.log(JSON.stringify({
    status: "complete",
    soldBg: asToken(ENTRY_BG_RAW),
    netSolChange: asSol(BigInt(state.netSolChangeLamports)),
    signatures: state.signatures,
  }));
} finally {
  await lockHandle?.close();
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}
