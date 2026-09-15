import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export class StakingAnalyticsService {
  constructor(config, { fetchImpl = fetch, token = loadStakingAnalyticsToken() } = {}) {
    this.url = config.stakingAnalyticsUrl;
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.cached = null;
    this.inFlight = null;
  }

  async read() {
    if (!this.token) return unavailable("质押数据凭据未配置。");
    if (this.cached && Date.now() - this.cached.loadedAt < 10_000) return this.cached.value;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async load() {
    try {
      const url = new URL(this.url);
      url.searchParams.set("limit", "500");
      const response = await this.fetchImpl(url, {
        headers: { "x-siam-analytics-token": this.token },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`质押数据源返回 HTTP ${response.status}`);
      const payload = await response.json();
      validatePayload(payload);
      const value = sanitize(payload);
      this.cached = { loadedAt: Date.now(), value };
      return value;
    } catch (error) {
      if (this.cached) return { ...this.cached.value, status: "stale", error: "质押数据源暂时不可用，正在显示最近成功数据。" };
      return unavailable(error instanceof Error ? error.message : "质押数据源暂时不可用。");
    }
  }
}

export function loadStakingAnalyticsToken(env = process.env) {
  const direct = env.SIAM_ANALYTICS_TOKEN?.trim();
  if (direct) return validToken(direct);
  const directory = env.CREDENTIALS_DIRECTORY;
  if (!directory) return null;
  try {
    return validToken(readFileSync(join(directory, "staking-analytics-token"), "utf8").trim());
  } catch {
    return null;
  }
}

function sanitize(payload) {
  return {
    ...payload,
    orders: payload.orders.map((row) => sanitizeRecord(row, ["address", "userId", "stakeSignature"])),
    settlements: payload.settlements.map((row) => sanitizeRecord(row, ["address"])),
    payouts: payload.payouts.map((row) => sanitizeRecord(row, ["address", "signature"])),
    privacy: {
      walletAddresses: "masked",
      transactionSignatures: "masked",
      demoAccountsExcluded: true,
    },
  };
}

function sanitizeRecord(row, fields) {
  const result = { ...row };
  if (row.address) {
    result.participantId = `用户 ${createHash("sha256").update(row.address).digest("hex").slice(0, 10)}`;
    result.addressMasked = mask(row.address);
  }
  if (row.stakeSignature) result.stakeSignatureMasked = mask(row.stakeSignature);
  if (row.signature) result.signatureMasked = mask(row.signature);
  for (const field of fields) delete result[field];
  return result;
}

function validatePayload(payload) {
  if (!payload || payload.status !== "ready" || !payload.summary) throw new Error("质押数据源响应无效");
  for (const key of ["orders", "settlements", "payouts", "daily", "planBreakdown", "statusBreakdown"]) {
    if (!Array.isArray(payload[key])) throw new Error(`质押数据源缺少 ${key}`);
  }
  if (payload.assets?.principal !== "SIAM" || payload.assets?.reward !== "ANTFUN" || payload.assets?.decimals !== 6) {
    throw new Error("质押资产口径不匹配");
  }
}

function unavailable(error) {
  return {
    status: "unavailable",
    capturedAt: null,
    timeZone: "Asia/Shanghai",
    assets: { principal: "SIAM", reward: "ANTFUN", decimals: 6 },
    summary: null,
    planBreakdown: [],
    statusBreakdown: [],
    daily: [],
    orders: [],
    settlements: [],
    payouts: [],
    coverage: null,
    source: { system: "Siam Community production ledger", population: "users.demo=0" },
    privacy: { walletAddresses: "masked", transactionSignatures: "masked", demoAccountsExcluded: true },
    error,
  };
}

function validToken(value) {
  if (value.length < 32 || value.length > 256) throw new Error("SIAM_ANALYTICS_TOKEN must contain 32 to 256 characters.");
  return value;
}

function mask(value) {
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-5)}` : "—";
}
