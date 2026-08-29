import { createRequire } from "node:module";
import { BN } from "@coral-xyz/anchor";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const DLMM = require("@meteora-ag/dlmm");

const MINT = {
  bg: "HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan",
  antfun: "CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt",
  sol: "So11111111111111111111111111111111111111112",
  usdt: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

const POOL = {
  bgAntfun: "AJJxmAV2C2WTHVHD4FEP71Vt8Rdu5day1v4Pr1FJPXEy",
  antfunUsdt: "54Vp27uLaw4wNLo5n7r4fcC6zLamoQc28xBARjss4EUJ",
  solUsdt: "C8G7RiugU2cznu7SAtCJ9aAShEzFEELUCm87ydRW8fSZ",
};

const DECIMALS = {
  [MINT.bg]: 6,
  [MINT.antfun]: 6,
  [MINT.sol]: 9,
  [MINT.usdt]: 6,
};

const DATA_API = {
  cp: "https://damm-v2.datapi.meteora.ag/pools",
  dlmm: "https://dlmm.datapi.meteora.ag/pools",
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const config = {
  rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet.solana.com",
  amountAntfun: positiveNumber(args["amount-antfun"] ?? 1_000, "amount-antfun"),
  intervalMs: positiveInteger(args["interval-ms"] ?? 30_000, "interval-ms"),
  legSlippageBps: boundedInteger(args["leg-slippage-bps"] ?? 20, 1, 500, "leg-slippage-bps"),
  minNetBps: boundedInteger(args["min-net-bps"] ?? 80, 1, 10_000, "min-net-bps"),
  minSecondaryTvlUsd: nonNegativeNumber(args["min-secondary-tvl-usd"] ?? 1_000, "min-secondary-tvl-usd"),
  fixedCostAntfun: nonNegativeNumber(args["fixed-cost-antfun"] ?? 25, "fixed-cost-antfun"),
  once: Boolean(args.once),
};

const connection = new Connection(config.rpcUrl, "confirmed");
const cpAmm = new CpAmm(connection);
const poolCache = new Map();
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

do {
  const startedAt = Date.now();
  try {
    console.log(JSON.stringify(await scanOnce()));
  } catch (error) {
    console.log(JSON.stringify({
      type: "bg-arbitrage-scan-error",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  if (config.once || stopping) break;
  const remaining = Math.max(0, config.intervalMs - (Date.now() - startedAt));
  await sleep(remaining);
} while (!stopping);

async function scanOnce() {
  poolCache.clear();
  const checkedAt = new Date().toISOString();
  const amountIn = toRaw(config.amountAntfun, DECIMALS[MINT.antfun]);
  const fixedCostRaw = toRaw(config.fixedCostAntfun, DECIMALS[MINT.antfun]);
  const [cpPools, dlmmPools] = await Promise.all([
    fetchPools(DATA_API.cp, "cp"),
    fetchPools(DATA_API.dlmm, "dlmm"),
  ]);

  const discovered = [...cpPools, ...dlmmPools]
    .filter((pool) => hasMint(pool, MINT.bg));
  const directAntfunPools = discovered.filter((pool) =>
    pool.address !== POOL.bgAntfun && hasPair(pool, MINT.bg, MINT.antfun));
  const directSolPools = discovered.filter((pool) => hasPair(pool, MINT.bg, MINT.sol));
  const candidates = [...directAntfunPools, ...directSolPools];
  const eligible = candidates.filter((pool) =>
    pool.effectiveTvlUsd >= config.minSecondaryTvlUsd && poolHasInventory(pool));

  const opportunities = [];
  const rejected = [];
  for (const pool of eligible) {
    const routes = hasPair(pool, MINT.bg, MINT.antfun)
      ? samePairRoutes(pool)
      : triangularRoutes(pool);
    for (const route of routes) {
      try {
        const result = await evaluateRoute(route, amountIn, fixedCostRaw);
        if (result.netBps >= config.minNetBps) opportunities.push(result);
        else rejected.push({
          route: result.route,
          secondaryPool: pool.address,
          reason: "net return below alert threshold",
          netBps: result.netBps,
        });
      } catch (error) {
        rejected.push({
          route: route.name,
          secondaryPool: pool.address,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  for (const pool of candidates.filter((candidate) => !eligible.includes(candidate))) {
    rejected.push({
      secondaryPool: pool.address,
      pair: pool.name,
      reason: !poolHasInventory(pool)
        ? "pool has no usable inventory"
        : `effective TVL $${round(pool.effectiveTvlUsd, 2)} is below $${config.minSecondaryTvlUsd} safety floor`,
    });
  }

  return {
    type: "bg-arbitrage-scan",
    checkedAt,
    readOnly: true,
    status: opportunities.length ? "opportunity" : "no-opportunity",
    config: {
      amountAntfun: config.amountAntfun,
      legSlippageBps: config.legSlippageBps,
      minNetBps: config.minNetBps,
      minSecondaryTvlUsd: config.minSecondaryTvlUsd,
      fixedCostAntfun: config.fixedCostAntfun,
      intervalMs: config.intervalMs,
    },
    primaryPool: POOL.bgAntfun,
    candidatePools: candidates.map(poolSummary),
    opportunities: opportunities.sort((a, b) => b.netBps - a.netBps),
    rejected,
    sources: [DATA_API.cp, DATA_API.dlmm],
  };
}

function samePairRoutes(secondaryPool) {
  const primary = fixedPool("cp", POOL.bgAntfun, "BG-ANTFUN", MINT.bg, MINT.antfun);
  return [
    {
      name: `ANTFUN -> BG (${POOL.bgAntfun}) -> ANTFUN (${secondaryPool.address})`,
      secondaryPool,
      legs: [
        { pool: primary, input: MINT.antfun, output: MINT.bg },
        { pool: secondaryPool, input: MINT.bg, output: MINT.antfun },
      ],
    },
    {
      name: `ANTFUN -> BG (${secondaryPool.address}) -> ANTFUN (${POOL.bgAntfun})`,
      secondaryPool,
      legs: [
        { pool: secondaryPool, input: MINT.antfun, output: MINT.bg },
        { pool: primary, input: MINT.bg, output: MINT.antfun },
      ],
    },
  ];
}

function triangularRoutes(secondaryPool) {
  const bgAntfun = fixedPool("cp", POOL.bgAntfun, "BG-ANTFUN", MINT.bg, MINT.antfun);
  const antfunUsdt = fixedPool("dlmm", POOL.antfunUsdt, "ANTFUN-USDT", MINT.antfun, MINT.usdt);
  const solUsdt = fixedPool("dlmm", POOL.solUsdt, "SOL-USDT", MINT.sol, MINT.usdt);
  return [
    {
      name: `ANTFUN -> BG -> SOL (${secondaryPool.address}) -> USDT -> ANTFUN`,
      secondaryPool,
      legs: [
        { pool: bgAntfun, input: MINT.antfun, output: MINT.bg },
        { pool: secondaryPool, input: MINT.bg, output: MINT.sol },
        { pool: solUsdt, input: MINT.sol, output: MINT.usdt },
        { pool: antfunUsdt, input: MINT.usdt, output: MINT.antfun },
      ],
    },
    {
      name: `ANTFUN -> USDT -> SOL -> BG (${secondaryPool.address}) -> ANTFUN`,
      secondaryPool,
      legs: [
        { pool: antfunUsdt, input: MINT.antfun, output: MINT.usdt },
        { pool: solUsdt, input: MINT.usdt, output: MINT.sol },
        { pool: secondaryPool, input: MINT.sol, output: MINT.bg },
        { pool: bgAntfun, input: MINT.bg, output: MINT.antfun },
      ],
    },
  ];
}

async function evaluateRoute(route, amountIn, fixedCostRaw) {
  const expected = await runLegs(route.legs, amountIn, false);
  const protectedResult = await runLegs(route.legs, amountIn, true);
  const netRaw = protectedResult.output - amountIn - fixedCostRaw;
  return {
    route: route.name,
    secondaryPool: route.secondaryPool.address,
    secondaryPoolTvlUsd: round(route.secondaryPool.effectiveTvlUsd, 2),
    inputAntfun: fromRaw(amountIn, DECIMALS[MINT.antfun]),
    expectedOutputAntfun: fromRaw(expected.output, DECIMALS[MINT.antfun]),
    protectedOutputAntfun: fromRaw(protectedResult.output, DECIMALS[MINT.antfun]),
    fixedCostAntfun: config.fixedCostAntfun,
    netAntfun: fromRaw(netRaw, DECIMALS[MINT.antfun]),
    expectedBps: bps(expected.output - amountIn, amountIn),
    netBps: bps(netRaw, amountIn),
    legs: protectedResult.legs,
  };
}

async function runLegs(legs, initialAmount, protectedMode) {
  let amount = initialAmount;
  const results = [];
  for (const leg of legs) {
    const quote = await quotePool(leg.pool, leg.input, amount);
    amount = protectedMode ? quote.minOut : quote.expectedOut;
    if (amount <= 0n) throw new Error(`zero output from ${leg.pool.address}`);
    results.push({
      pool: leg.pool.address,
      kind: leg.pool.kind,
      inputMint: leg.input,
      outputMint: leg.output,
      inputRaw: quote.input.toString(),
      outputRaw: amount.toString(),
    });
  }
  return { output: amount, legs: results };
}

async function quotePool(pool, inputMint, amountIn) {
  if (!hasMint(pool, inputMint)) throw new Error(`pool ${pool.address} does not contain input mint`);
  if (pool.kind === "cp") return quoteCp(pool, inputMint, amountIn);
  if (pool.kind === "dlmm") return quoteDlmm(pool, inputMint, amountIn);
  throw new Error(`unsupported pool kind ${pool.kind}`);
}

async function quoteCp(pool, inputMint, amountIn) {
  const cacheKey = `cp:${pool.address}`;
  let cached = poolCache.get(cacheKey);
  if (!cached) {
    const state = await cpAmm.fetchPoolState(new PublicKey(pool.address));
    const slot = await connection.getSlot("confirmed");
    const currentTime = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1_000);
    cached = { state, slot, currentTime };
    poolCache.set(cacheKey, cached);
  }
  const tokenADecimal = decimalsFor(pool, cached.state.tokenAMint.toBase58());
  const tokenBDecimal = decimalsFor(pool, cached.state.tokenBMint.toBase58());
  const quote = cpAmm.getQuote({
    inAmount: new BN(amountIn.toString()),
    inputTokenMint: new PublicKey(inputMint),
    slippage: config.legSlippageBps,
    poolState: cached.state,
    currentTime: cached.currentTime,
    currentSlot: cached.slot,
    tokenADecimal,
    tokenBDecimal,
    hasReferral: false,
  });
  return {
    input: amountIn,
    expectedOut: BigInt(quote.swapOutAmount.toString()),
    minOut: BigInt(quote.minSwapOutAmount.toString()),
  };
}

async function quoteDlmm(pool, inputMint, amountIn) {
  const cacheKey = `dlmm:${pool.address}`;
  let instance = poolCache.get(cacheKey);
  if (!instance) {
    instance = await DLMM.create(connection, new PublicKey(pool.address));
    poolCache.set(cacheKey, instance);
  }
  const swapForY = pool.tokenX.address === inputMint;
  const binArrays = await instance.getBinArrayForSwap(swapForY, 4);
  const quote = instance.swapQuote(
    new BN(amountIn.toString()),
    swapForY,
    new BN(config.legSlippageBps),
    binArrays,
    false,
  );
  const consumed = BigInt(quote.consumedInAmount.toString());
  if (consumed !== amountIn) throw new Error(`pool ${pool.address} cannot consume the full input`);
  return {
    input: amountIn,
    expectedOut: BigInt(quote.outAmount.toString()),
    minOut: BigInt(quote.minOutAmount.toString()),
  };
}

async function fetchPools(baseUrl, kind) {
  const url = `${baseUrl}?query=${MINT.bg}&page_size=100`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${kind} pool discovery failed: HTTP ${response.status}`);
  const body = await response.json();
  return (body.data ?? []).map((pool) => normalizePool(pool, kind));
}

function normalizePool(pool, kind) {
  const tokenX = normalizeToken(pool.token_x);
  const tokenY = normalizeToken(pool.token_y);
  const reportedTvl = Number(pool.tvl ?? 0);
  const inferredTvl = inferTvl(tokenX, tokenY, pool);
  return {
    kind,
    address: pool.address,
    name: pool.name,
    tokenX,
    tokenY,
    baseFeePct: Number(pool.pool_config?.base_fee_pct ?? 0),
    reportedTvlUsd: Number.isFinite(reportedTvl) ? reportedTvl : 0,
    effectiveTvlUsd: reportedTvl > 0 ? reportedTvl : inferredTvl,
    volume24hUsd: Number(pool.volume?.["24h"] ?? 0),
    isBlacklisted: Boolean(pool.is_blacklisted),
  };
}

function normalizeToken(token) {
  return {
    address: token.address,
    symbol: token.symbol,
    decimals: Number(token.decimals),
    amount: Number(token.amount ?? 0),
    priceUsd: Number(token.price ?? 0),
  };
}

function inferTvl(tokenX, tokenY, sourcePool) {
  tokenX.amount = Number(sourcePool.token_x_amount ?? 0);
  tokenY.amount = Number(sourcePool.token_y_amount ?? 0);
  const xValue = tokenX.amount * tokenX.priceUsd;
  const yValue = tokenY.amount * tokenY.priceUsd;
  if (xValue > 0 && yValue > 0) return xValue + yValue;
  if (xValue > 0) return xValue * 2;
  if (yValue > 0) return yValue * 2;
  return 0;
}

function fixedPool(kind, address, name, tokenXAddress, tokenYAddress) {
  return {
    kind,
    address,
    name,
    tokenX: { address: tokenXAddress, decimals: DECIMALS[tokenXAddress], amount: Number.POSITIVE_INFINITY },
    tokenY: { address: tokenYAddress, decimals: DECIMALS[tokenYAddress], amount: Number.POSITIVE_INFINITY },
    effectiveTvlUsd: Number.POSITIVE_INFINITY,
  };
}

function poolSummary(pool) {
  return {
    kind: pool.kind,
    address: pool.address,
    pair: pool.name,
    baseFeePct: pool.baseFeePct,
    effectiveTvlUsd: round(pool.effectiveTvlUsd, 2),
    volume24hUsd: round(pool.volume24hUsd, 2),
    eligible: pool.effectiveTvlUsd >= config.minSecondaryTvlUsd && poolHasInventory(pool),
  };
}

function hasMint(pool, mint) {
  return pool.tokenX.address === mint || pool.tokenY.address === mint;
}

function hasPair(pool, mintA, mintB) {
  return hasMint(pool, mintA) && hasMint(pool, mintB);
}

function poolHasInventory(pool) {
  return !pool.isBlacklisted && pool.tokenX.amount > 0 && pool.tokenY.amount > 0;
}

function decimalsFor(pool, mint) {
  if (pool.tokenX.address === mint) return pool.tokenX.decimals;
  if (pool.tokenY.address === mint) return pool.tokenY.decimals;
  if (DECIMALS[mint] != null) return DECIMALS[mint];
  throw new Error(`missing decimals for ${mint} in pool ${pool.address}`);
}

function parseArgs(values) {
  const result = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, raw = "true"] = value.slice(2).split("=", 2);
    result[key] = raw === "true" ? true : raw;
  }
  return result;
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be greater than zero`);
  return parsed;
}

function nonNegativeNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${name} must be zero or greater`);
  return parsed;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function boundedInteger(value, min, max, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function toRaw(value, decimals) {
  const [whole, fraction = ""] = String(value).split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`cannot represent ${value} with ${decimals} decimals`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

function fromRaw(value, decimals) {
  return Number(value) / 10 ** decimals;
}

function bps(delta, base) {
  return Number(delta * 1_000_000n / base) / 100;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Read-only BG arbitrage monitor. It never loads a wallet or submits transactions.

Usage:
  node scripts/bg-arbitrage-monitor.mjs [options]

Options:
  --once                         Run one scan and exit
  --amount-antfun=1000           Starting amount used for executable route quotes
  --interval-ms=30000            Delay between scans
  --leg-slippage-bps=20          Conservative per-leg slippage allowance
  --min-net-bps=80               Alert only above this net return after fixed cost
  --min-secondary-tvl-usd=1000   Ignore unsafe dust pools
  --fixed-cost-antfun=25         Priority fee/tip/failure safety allowance
  --help                         Show this help

Environment:
  SOLANA_RPC_URL                 Optional read-only Solana RPC URL
`);
}
