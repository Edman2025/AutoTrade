import { PublicKey } from "@solana/web3.js";

export const NETWORK = "mainnet-beta";
export const PROGRAMS = Object.freeze({
  dammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  dlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
});

export const TOKENS = Object.freeze({
  BG: Object.freeze({ mint: "HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan", decimals: 6 }),
  ANTFUN: Object.freeze({ mint: "CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt", decimals: 6 }),
  USDT: Object.freeze({ mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 }),
});

export const POOLS = Object.freeze({
  bgAntfun: Object.freeze({
    address: "AJJxmAV2C2WTHVHD4FEP71Vt8Rdu5day1v4Pr1FJPXEy",
    kind: "damm-v2",
    tokenX: "BG",
    tokenY: "ANTFUN",
    programId: PROGRAMS.dammV2,
  }),
  antfunUsdt: Object.freeze({
    address: "54Vp27uLaw4wNLo5n7r4fcC6zLamoQc28xBARjss4EUJ",
    kind: "dlmm",
    tokenX: "ANTFUN",
    tokenY: "USDT",
    programId: PROGRAMS.dlmm,
  }),
});

const DEFAULTS = Object.freeze({
  rpcUrl: "https://api.mainnet.solana.com",
  host: "127.0.0.1",
  port: 8788,
  mode: "observe",
  enablePositionIndex: false,
  snapshotIntervalMs: 10_000,
  quoteStaleMs: 3_000,
  maxSlippageBps: 100,
  maxPriceImpactBps: 100,
  maxTradeBgRaw: 1_000_000_000_000n,
  maxTradeAntfunRaw: 4_000_000_000n,
  maxTradeUsdtRaw: 2_000_000_000n,
  maxDailyNotionalUsdtRaw: 10_000_000_000n,
  minSolReserveRaw: 100_000_000n,
  maxConsecutiveFailures: 3,
  cooldownMs: 30_000,
  dailyLossLimitBps: 300,
  inventoryToleranceBps: 500,
  inventoryTargetBgBps: 4_500,
  inventoryTargetAntfunBps: 1_000,
  inventoryTargetUsdtBps: 4_500,
  sseHeartbeatMs: 20_000,
});

export function loadConfig(env = process.env) {
  const mode = oneOf(env.MAKER_MODE ?? DEFAULTS.mode, ["observe", "prepare", "live"], "MAKER_MODE");
  const walletAddress = env.MAKER_WALLET_ADDRESS?.trim() || null;

  if (walletAddress) asPublicKey(walletAddress, "MAKER_WALLET_ADDRESS");
  if (mode !== "observe" && !walletAddress) {
    throw new Error("MAKER_WALLET_ADDRESS is required in prepare or live mode.");
  }
  if (mode !== "observe" && !env.MAKER_ADMIN_TOKEN) {
    throw new Error("MAKER_ADMIN_TOKEN is required in prepare or live mode.");
  }
  if (mode !== "observe" && env.MAKER_ADMIN_TOKEN.length < 32) {
    throw new Error("MAKER_ADMIN_TOKEN must contain at least 32 characters.");
  }
  if (mode === "live" && env.MAKER_LIVE_ACK !== "I_UNDERSTAND_MAINNET") {
    throw new Error("Live mode requires MAKER_LIVE_ACK=I_UNDERSTAND_MAINNET.");
  }

  const allowedOrigins = (env.MAKER_ALLOWED_ORIGINS ?? "http://127.0.0.1:4173,http://localhost:4173")
    .split(",").map((value) => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) validateOrigin(origin);
  const rpcUrl = env.SOLANA_RPC_URL?.trim() || DEFAULTS.rpcUrl;
  const rpcProvider = env.MAKER_RPC_PROVIDER?.trim() || null;
  const rpcSlaAcknowledged = env.MAKER_RPC_SLA_ACK === "I_VERIFIED_PRIVATE_RPC_SLA";
  const privateRpcVerified = privateRpcPolicy(rpcUrl, rpcProvider, rpcSlaAcknowledged);
  const publicRpcRiskAccepted = env.MAKER_PUBLIC_RPC_LIVE_ACK === "I_ACCEPT_PUBLIC_RPC_LIVE_RISK" && httpsRpcPolicy(rpcUrl);
  const rpcPolicyVerified = privateRpcVerified || publicRpcRiskAccepted;
  const rpcPolicyMode = privateRpcVerified ? "private-authenticated" : publicRpcRiskAccepted ? "public-risk-accepted" : "unverified";
  const accountingTimeZone = env.MAKER_ACCOUNTING_TIME_ZONE?.trim() || "Asia/Shanghai";
  validateTimeZone(accountingTimeZone);
  const inventoryTargetsBps = {
    BG: integer(env.MAKER_INVENTORY_TARGET_BG_BPS, DEFAULTS.inventoryTargetBgBps, 0, 10_000, "MAKER_INVENTORY_TARGET_BG_BPS"),
    ANTFUN: integer(env.MAKER_INVENTORY_TARGET_ANTFUN_BPS, DEFAULTS.inventoryTargetAntfunBps, 0, 10_000, "MAKER_INVENTORY_TARGET_ANTFUN_BPS"),
    USDT: integer(env.MAKER_INVENTORY_TARGET_USDT_BPS, DEFAULTS.inventoryTargetUsdtBps, 0, 10_000, "MAKER_INVENTORY_TARGET_USDT_BPS"),
  };
  if (Object.values(inventoryTargetsBps).reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new Error("Inventory target basis points must sum to 10000.");
  }

  const config = {
    network: NETWORK,
    rpcUrl,
    rpcProvider,
    rpcSlaAcknowledged,
    privateRpcVerified,
    publicRpcRiskAccepted,
    rpcPolicyVerified,
    rpcPolicyMode,
    accountingTimeZone,
    host: env.MAKER_HOST?.trim() || DEFAULTS.host,
    port: integer(env.MAKER_PORT, DEFAULTS.port, 1, 65_535, "MAKER_PORT"),
    allowedOrigins,
    mode,
    enablePositionIndex: flag(env.MAKER_ENABLE_POSITION_INDEX, DEFAULTS.enablePositionIndex, "MAKER_ENABLE_POSITION_INDEX"),
    walletAddress,
    adminToken: env.MAKER_ADMIN_TOKEN || null,
    databasePath: env.MAKER_DATABASE_PATH?.trim() || "services/market-maker/data/maker.sqlite",
    snapshotIntervalMs: integer(env.MAKER_SNAPSHOT_INTERVAL_MS, DEFAULTS.snapshotIntervalMs, 2_000, 300_000, "MAKER_SNAPSHOT_INTERVAL_MS"),
    sseHeartbeatMs: integer(env.MAKER_SSE_HEARTBEAT_MS, DEFAULTS.sseHeartbeatMs, 1_000, 60_000, "MAKER_SSE_HEARTBEAT_MS"),
    pools: {
      bgAntfun: POOLS.bgAntfun,
      antfunUsdt: POOLS.antfunUsdt,
    },
    risk: {
      quoteStaleMs: integer(env.MAKER_QUOTE_STALE_MS, DEFAULTS.quoteStaleMs, 500, 30_000, "MAKER_QUOTE_STALE_MS"),
      maxSlippageBps: integer(env.MAKER_MAX_SLIPPAGE_BPS, DEFAULTS.maxSlippageBps, 1, 300, "MAKER_MAX_SLIPPAGE_BPS"),
      maxPriceImpactBps: integer(env.MAKER_MAX_PRICE_IMPACT_BPS, DEFAULTS.maxPriceImpactBps, 1, 500, "MAKER_MAX_PRICE_IMPACT_BPS"),
      maxTradeBgRaw: bigint(env.MAKER_MAX_TRADE_BG_RAW, DEFAULTS.maxTradeBgRaw, "MAKER_MAX_TRADE_BG_RAW"),
      maxTradeAntfunRaw: bigint(env.MAKER_MAX_TRADE_ANTFUN_RAW, DEFAULTS.maxTradeAntfunRaw, "MAKER_MAX_TRADE_ANTFUN_RAW"),
      maxTradeUsdtRaw: bigint(env.MAKER_MAX_TRADE_USDT_RAW, DEFAULTS.maxTradeUsdtRaw, "MAKER_MAX_TRADE_USDT_RAW"),
      maxDailyNotionalUsdtRaw: bigint(env.MAKER_MAX_DAILY_NOTIONAL_USDT_RAW, DEFAULTS.maxDailyNotionalUsdtRaw, "MAKER_MAX_DAILY_NOTIONAL_USDT_RAW"),
      minSolReserveRaw: bigint(env.MAKER_MIN_SOL_RESERVE_RAW, DEFAULTS.minSolReserveRaw, "MAKER_MIN_SOL_RESERVE_RAW"),
      maxConsecutiveFailures: integer(env.MAKER_MAX_CONSECUTIVE_FAILURES, DEFAULTS.maxConsecutiveFailures, 1, 20, "MAKER_MAX_CONSECUTIVE_FAILURES"),
      cooldownMs: integer(env.MAKER_COOLDOWN_MS, DEFAULTS.cooldownMs, 1_000, 3_600_000, "MAKER_COOLDOWN_MS"),
      dailyLossLimitBps: integer(env.MAKER_DAILY_LOSS_LIMIT_BPS, DEFAULTS.dailyLossLimitBps, 1, 10_000, "MAKER_DAILY_LOSS_LIMIT_BPS"),
      inventoryToleranceBps: integer(env.MAKER_INVENTORY_TOLERANCE_BPS, DEFAULTS.inventoryToleranceBps, 0, 5_000, "MAKER_INVENTORY_TOLERANCE_BPS"),
      inventoryTargetsBps,
    },
  };

  return Object.freeze(config);
}

export function publicConfig(config) {
  return {
    network: config.network,
    mode: config.mode,
    enablePositionIndex: config.enablePositionIndex,
    walletAddress: config.walletAddress,
    pools: config.pools,
    risk: Object.fromEntries(Object.entries(config.risk).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])),
    allowedOrigins: config.allowedOrigins,
    mutationsEnabled: Boolean(config.adminToken) && config.mode !== "observe",
    accountingTimeZone: config.accountingTimeZone,
    rpcPolicy: {
      provider: config.rpcProvider,
      privateAuthenticated: config.privateRpcVerified,
      slaAcknowledged: config.rpcSlaAcknowledged,
      publicRiskAccepted: config.publicRpcRiskAccepted,
      ready: config.rpcPolicyVerified,
      mode: config.rpcPolicyMode,
    },
  };
}

function privateRpcPolicy(value, provider, acknowledged) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const knownShared = new Set([
    "api.mainnet-beta.solana.com",
    "api.mainnet.solana.com",
    "solana-rpc.publicnode.com",
  ]);
  return url.protocol === "https:" && !knownShared.has(url.hostname.toLowerCase()) && Boolean(provider) && acknowledged;
}

function httpsRpcPolicy(value) {
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

function validateTimeZone(value) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); }
  catch { throw new Error(`Invalid MAKER_ACCOUNTING_TIME_ZONE: ${value}`); }
}

export function tokenByMint(mint) {
  const entry = Object.entries(TOKENS).find(([, token]) => token.mint === mint);
  if (!entry) throw new Error(`Unsupported mint: ${mint}`);
  return { symbol: entry[0], ...entry[1] };
}

function asPublicKey(value, label) {
  try { return new PublicKey(value); } catch { throw new Error(`${label} is not a valid Solana public key.`); }
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  return value;
}

function integer(value, fallback, min, max, label) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function bigint(value, fallback, label) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || BigInt(value) <= 0n) throw new Error(`${label} must be a positive base-unit integer.`);
  return BigInt(value);
}

function flag(value, fallback, label) {
  if (value == null || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be true or false.`);
}

function validateOrigin(value) {
  let origin;
  try { origin = new URL(value); } catch { throw new Error(`Invalid MAKER_ALLOWED_ORIGINS entry: ${value}`); }
  const loopback = origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
  if (origin.origin !== value || (!loopback && origin.protocol !== "https:")) {
    throw new Error(`MAKER_ALLOWED_ORIGINS must use HTTPS or a loopback HTTP origin: ${value}`);
  }
}
