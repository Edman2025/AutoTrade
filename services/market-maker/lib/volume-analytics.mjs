const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const BEIJING_OFFSET_SECONDS = 8 * HOUR_SECONDS;
const MAX_HISTORY_SPAN_HOURS = 95;

const DATA_API = Object.freeze({
  "damm-v2": "https://damm-v2.datapi.meteora.ag",
  dlmm: "https://dlmm.datapi.meteora.ag",
});

export class VolumeAnalyticsService {
  constructor(config, store, { fetchImpl = globalThis.fetch, now = () => Date.now(), cacheTtlMs = 60_000 } = {}) {
    this.config = config;
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async read(days = 7) {
    const normalizedDays = Math.max(1, Math.min(Number(days) || 7, 30));
    const cached = this.cache.get(normalizedDays);
    if (cached && this.now() - cached.cachedAt < this.cacheTtlMs) return cached.payload;
    if (this.inFlight.has(normalizedDays)) return this.inFlight.get(normalizedDays);
    const pending = this.refresh(normalizedDays)
      .then((payload) => {
        this.cache.set(normalizedDays, { cachedAt: this.now(), payload });
        return payload;
      })
      .catch((error) => {
        if (cached?.payload) return { ...cached.payload, status: "stale", errors: [...(cached.payload.errors ?? []), messageOf(error)] };
        throw error;
      })
      .finally(() => this.inFlight.delete(normalizedDays));
    this.inFlight.set(normalizedDays, pending);
    return pending;
  }

  async refresh(days) {
    const nowSeconds = Math.floor(this.now() / 1_000);
    const currentHour = Math.floor(nowSeconds / HOUR_SECONDS) * HOUR_SECONDS;
    const todayStart = startOfBeijingDay(nowSeconds);
    const rangeStart = todayStart - (days - 1) * DAY_SECONDS;
    const poolEntries = Object.entries(this.config.pools);
    const results = await Promise.allSettled(poolEntries.map(async ([key, pool]) => ({
      key,
      pair: `${pool.tokenX}/${pool.tokenY}`,
      kind: pool.kind,
      address: pool.address,
      history: await fetchPoolHistory({ fetchImpl: this.fetchImpl, pool, startTime: rangeStart, endTime: currentHour }),
    })));

    const errors = [];
    const poolHistories = {};
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const [key, pool] = poolEntries[index];
      if (result.status === "fulfilled") poolHistories[key] = result.value;
      else errors.push(`${pool.tokenX}/${pool.tokenY}: ${messageOf(result.reason)}`);
    }

    const dates = Array.from({ length: days }, (_, index) => beijingDate(rangeStart + index * DAY_SECONDS));
    const daily = dates.map((date) => ({ date, totalUsd: 0, pools: {}, systemUsd: 0, systemExecutions: 0 }));
    const dailyByDate = new Map(daily.map((row) => [row.date, row]));
    let lastBucketAt = null;
    for (const [key, item] of Object.entries(poolHistories)) {
      for (const bucket of item.history.buckets) {
        const row = dailyByDate.get(beijingDate(bucket.timestamp));
        if (!row) continue;
        row.pools[key] = roundUsd((row.pools[key] ?? 0) + bucket.volume);
        row.totalUsd = roundUsd(row.totalUsd + bucket.volume);
        if (lastBucketAt == null || bucket.timestamp > lastBucketAt) lastBucketAt = bucket.timestamp;
      }
      for (const row of daily) if (row.pools[key] == null) row.pools[key] = 0;
    }

    const systemIntents = this.store.listExecutedIntentsSince(new Date(rangeStart * 1_000).toISOString());
    let unvaluedExecutions = 0;
    for (const intent of systemIntents) {
      const row = dailyByDate.get(beijingDate(Math.floor(Date.parse(intent.executedAt) / 1_000)));
      if (!row) continue;
      row.systemExecutions += 1;
      const notional = estimateIntentNotionalUsd(intent);
      if (notional == null) unvaluedExecutions += 1;
      else row.systemUsd = roundUsd(row.systemUsd + notional);
    }

    const today = daily.at(-1) ?? { totalUsd: 0, pools: {}, systemUsd: 0, systemExecutions: 0 };
    return {
      status: errors.length ? (Object.keys(poolHistories).length ? "degraded" : "unavailable") : "ready",
      generatedAt: new Date(this.now()).toISOString(),
      timezone: "Asia/Shanghai",
      currency: "USD",
      source: "Meteora Data API",
      aggregation: "Official hourly pool volume grouped by Beijing calendar day",
      lastBucketAt: lastBucketAt == null ? null : new Date(lastBucketAt * 1_000).toISOString(),
      days,
      today: {
        date: today.date,
        totalUsd: today.totalUsd,
        pools: today.pools,
        systemUsd: today.systemUsd,
        systemExecutions: today.systemExecutions,
      },
      period: {
        totalUsd: roundUsd(daily.reduce((sum, row) => sum + row.totalUsd, 0)),
        systemUsd: roundUsd(daily.reduce((sum, row) => sum + row.systemUsd, 0)),
        systemExecutions: daily.reduce((sum, row) => sum + row.systemExecutions, 0),
        unvaluedExecutions,
      },
      pools: Object.fromEntries(Object.entries(poolHistories).map(([key, item]) => [key, {
        pair: item.pair,
        kind: item.kind,
        address: item.address,
        sourceUrl: `${DATA_API[item.kind]}/pools/${item.address}/volume/history`,
      }])),
      daily,
      errors,
    };
  }
}

export async function fetchPoolHistory({ fetchImpl, pool, startTime, endTime }) {
  const baseUrl = DATA_API[pool.kind];
  if (!baseUrl) throw new Error(`Unsupported pool kind: ${pool.kind}`);
  const bucketsByTimestamp = new Map();
  for (let cursor = startTime; cursor <= endTime;) {
    const chunkEnd = Math.min(endTime, cursor + MAX_HISTORY_SPAN_HOURS * HOUR_SECONDS);
    const url = new URL(`/pools/${pool.address}/volume/history`, baseUrl);
    url.searchParams.set("timeframe", "1h");
    url.searchParams.set("start_time", String(cursor));
    url.searchParams.set("end_time", String(chunkEnd));
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Meteora Data API returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error("Meteora Data API returned an invalid history payload");
    for (const raw of payload.data) {
      const timestamp = Number(raw.timestamp);
      const volume = Number(raw.volume);
      if (!Number.isInteger(timestamp) || !Number.isFinite(volume) || volume < 0) continue;
      bucketsByTimestamp.set(timestamp, { timestamp, volume });
    }
    cursor = chunkEnd + HOUR_SECONDS;
  }
  return { buckets: [...bucketsByTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp) };
}

export function aggregateBeijingDaily(buckets, days, nowSeconds) {
  const todayStart = startOfBeijingDay(nowSeconds);
  const rangeStart = todayStart - (days - 1) * DAY_SECONDS;
  const rows = Array.from({ length: days }, (_, index) => ({ date: beijingDate(rangeStart + index * DAY_SECONDS), volume: 0 }));
  const byDate = new Map(rows.map((row) => [row.date, row]));
  for (const bucket of buckets) {
    const row = byDate.get(beijingDate(bucket.timestamp));
    if (row) row.volume = roundUsd(row.volume + Number(bucket.volume));
  }
  return rows;
}

export function estimateIntentNotionalUsd(intent) {
  const action = intent?.summary?.action;
  const quote = intent?.summary?.quote;
  if (action?.inputSymbol === "USDT") return finiteNonNegative(quote?.amountInUi ?? rawSixToNumber(action.amountInRaw));
  if (quote?.outputSymbol === "USDT") return finiteNonNegative(quote.expectedOutUi);
  return null;
}

function startOfBeijingDay(timestampSeconds) {
  return Math.floor((timestampSeconds + BEIJING_OFFSET_SECONDS) / DAY_SECONDS) * DAY_SECONDS - BEIJING_OFFSET_SECONDS;
}

function beijingDate(timestampSeconds) {
  return new Date((timestampSeconds + BEIJING_OFFSET_SECONDS) * 1_000).toISOString().slice(0, 10);
}

function rawSixToNumber(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return null;
  return Number(BigInt(value)) / 1_000_000;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roundUsd(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
function messageOf(error) { return error instanceof Error ? error.message : String(error); }
