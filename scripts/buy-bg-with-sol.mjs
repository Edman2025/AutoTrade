import { createRequire } from "node:module";
import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { BN } from "@coral-xyz/anchor";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
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
const amountSol = 0.01;
const amountLamports = 10_000_000;
const legSlippageBps = 100;
const broadcast = process.argv.includes("--broadcast");
const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet.solana.com";

const vault = await decryptVault();
const wallet = Keypair.fromSeed(
  derivePath(vault.derivation.solana, mnemonicToSeedSync(vault.mnemonic).toString("hex")).key,
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

async function simulateAndSend(label, tx) {
  const simulationBlockhash = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = simulationBlockhash.blockhash;
  tx.sign(wallet);
  const simulation = await connection.simulateTransaction(tx);
  if (simulation.value.err) {
    throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}\n${(simulation.value.logs ?? []).join("\n")}`);
  }
  if (!broadcast) return null;
  const sendBlockhash = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = sendBlockhash.blockhash;
  tx.sign(wallet);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction(
    { signature, ...sendBlockhash },
    "confirmed",
  );
  if (confirmation.value.err) throw new Error(`${label} failed on chain: ${JSON.stringify(confirmation.value.err)}`);
  console.log(`${label}: ${signature}`);
  return signature;
}

const startingSol = await connection.getBalance(wallet.publicKey, "confirmed");
if (startingSol < amountLamports + 7_000_000) {
  throw new Error(`Insufficient SOL: ${startingSol / LAMPORTS_PER_SOL}. Need 0.01 SOL plus account rent and fees.`);
}
const [startingUsdt, startingAntfun, startingBg] = await Promise.all([
  tokenBalance(MINT.usdt),
  tokenBalance(MINT.antfun),
  tokenBalance(MINT.bg),
]);
if (startingUsdt !== 0n || startingAntfun !== 0n) {
  throw new Error("Intermediate USDT or ANTFUN balance already exists; refusing to mix it into this fixed-budget purchase.");
}

const solUsdt = await DLMM.create(connection, POOL.solUsdt);
const bins1 = await solUsdt.getBinArrayForSwap(true, 4);
const quote1 = solUsdt.swapQuote(new BN(amountLamports), true, new BN(legSlippageBps), bins1, false);
const tx1 = await solUsdt.swap({
  inToken: MINT.sol,
  outToken: MINT.usdt,
  inAmount: new BN(amountLamports),
  minOutAmount: quote1.minOutAmount,
  lbPair: POOL.solUsdt,
  user: wallet.publicKey,
  binArraysPubkey: quote1.binArraysPubkey,
});

if (!broadcast) {
  await simulateAndSend("SOL->USDT simulation", tx1);
  console.log(JSON.stringify({
    mode: "simulation-only",
    wallet: wallet.publicKey.toBase58(),
    solBalance: startingSol / LAMPORTS_PER_SOL,
    solIn: amountSol,
    route: ["SOL", "USDT", "ANTFUN", "BG"],
    slippage: "1% per leg; approximately 2.97% compounded maximum",
    firstLeg: {
      expectedUsdt: Number(quote1.outAmount.toString()) / 1e6,
      minimumUsdt: Number(quote1.minOutAmount.toString()) / 1e6,
    },
  }, null, 2));
  process.exit(0);
}

await simulateAndSend("SOL->USDT", tx1);
const usdtIn = (await tokenBalance(MINT.usdt)) - startingUsdt;
if (usdtIn <= 0n) throw new Error("SOL->USDT confirmed but no USDT output was found.");

const antfunUsdt = await DLMM.create(connection, POOL.antfunUsdt);
const bins2 = await antfunUsdt.getBinArrayForSwap(false, 4);
const quote2 = antfunUsdt.swapQuote(new BN(usdtIn.toString()), false, new BN(legSlippageBps), bins2, false);
const tx2 = await antfunUsdt.swap({
  inToken: MINT.usdt,
  outToken: MINT.antfun,
  inAmount: new BN(usdtIn.toString()),
  minOutAmount: quote2.minOutAmount,
  lbPair: POOL.antfunUsdt,
  user: wallet.publicKey,
  binArraysPubkey: quote2.binArraysPubkey,
});
await simulateAndSend("USDT->ANTFUN", tx2);
const antfunIn = (await tokenBalance(MINT.antfun)) - startingAntfun;
if (antfunIn <= 0n) throw new Error("USDT->ANTFUN confirmed but no ANTFUN output was found.");

const cpAmm = new CpAmm(connection);
const poolState = await cpAmm.fetchPoolState(POOL.bgAntfun);
const slot = await connection.getSlot("confirmed");
const currentTime = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
const quote3 = cpAmm.getQuote({
  inAmount: new BN(antfunIn.toString()),
  inputTokenMint: MINT.antfun,
  slippage: legSlippageBps,
  poolState,
  currentTime,
  currentSlot: slot,
  tokenADecimal: 6,
  tokenBDecimal: 6,
  hasReferral: false,
});
const tx3 = await cpAmm.swap({
  payer: wallet.publicKey,
  pool: POOL.bgAntfun,
  inputTokenMint: MINT.antfun,
  outputTokenMint: MINT.bg,
  amountIn: new BN(antfunIn.toString()),
  minimumAmountOut: quote3.minSwapOutAmount,
  tokenAMint: poolState.tokenAMint,
  tokenBMint: poolState.tokenBMint,
  tokenAVault: poolState.tokenAVault,
  tokenBVault: poolState.tokenBVault,
  tokenAProgram: TOKEN_PROGRAM_ID,
  tokenBProgram: TOKEN_PROGRAM_ID,
  referralTokenAccount: null,
  poolState,
});
await simulateAndSend("ANTFUN->BG", tx3);
const bgReceived = (await tokenBalance(MINT.bg)) - startingBg;
const endingSol = await connection.getBalance(wallet.publicKey, "confirmed");
console.log(JSON.stringify({
  status: "complete",
  wallet: wallet.publicKey.toBase58(),
  solSpentOnSwap: amountSol,
  bgReceivedRaw: bgReceived.toString(),
  bgReceived: Number(bgReceived) / 1e6,
  remainingSol: endingSol / LAMPORTS_PER_SOL,
}, null, 2));
