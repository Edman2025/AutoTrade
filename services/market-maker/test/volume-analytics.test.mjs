import test from "node:test";
import assert from "node:assert/strict";
import { aggregateBeijingDaily, estimateIntentNotionalUsd, fetchPoolHistory } from "../lib/volume-analytics.mjs";

test("groups official hourly buckets by Beijing calendar day", () => {
  const now = Date.parse("2026-08-27T08:30:00Z") / 1_000;
  const rows = aggregateBeijingDaily([
    { timestamp: Date.parse("2026-08-26T15:00:00Z") / 1_000, volume: 10 },
    { timestamp: Date.parse("2026-08-26T16:00:00Z") / 1_000, volume: 20 },
    { timestamp: Date.parse("2026-08-27T01:00:00Z") / 1_000, volume: 30 },
  ], 2, now);
  assert.deepEqual(rows, [
    { date: "2026-08-26", volume: 10 },
    { date: "2026-08-27", volume: 50 },
  ]);
});

test("values executed intents only when a USDT side is recorded", () => {
  assert.equal(estimateIntentNotionalUsd({ summary: { action: { inputSymbol: "USDT", amountInRaw: "1250000" }, quote: {} } }), 1.25);
  assert.equal(estimateIntentNotionalUsd({ summary: { action: { inputSymbol: "ANTFUN" }, quote: { outputSymbol: "USDT", expectedOutUi: "9.75" } } }), 9.75);
  assert.equal(estimateIntentNotionalUsd({ summary: { action: { inputSymbol: "BG" }, quote: { outputSymbol: "ANTFUN", expectedOutUi: "100" } } }), null);
});

test("fetches long histories in bounded official API chunks and removes boundary duplicates", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.toString());
    const start = Number(url.searchParams.get("start_time"));
    const end = Number(url.searchParams.get("end_time"));
    return { ok: true, json: async () => ({ data: [{ timestamp: start, volume: 1 }, { timestamp: end, volume: 2 }] }) };
  };
  const result = await fetchPoolHistory({
    fetchImpl,
    pool: { kind: "dlmm", address: "pool" },
    startTime: 0,
    endTime: 200 * 60 * 60,
  });
  assert.equal(calls.length, 3);
  assert.equal(new Set(result.buckets.map((item) => item.timestamp)).size, result.buckets.length);
});
