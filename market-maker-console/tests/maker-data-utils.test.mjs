import test from "node:test";
import assert from "node:assert/strict";
import { newerSnapshot } from "../src/makerDataUtils.js";

test("a slower poll response cannot overwrite a newer SSE snapshot", () => {
  const current = { capturedAt: "2026-08-28T03:00:10.000Z", slot: 20 };
  const stalePoll = { capturedAt: "2026-08-28T03:00:09.000Z", slot: 19 };
  assert.equal(newerSnapshot(current, stalePoll), current);
});

test("a newer snapshot replaces the current value", () => {
  const current = { capturedAt: "2026-08-28T03:00:10.000Z", slot: 20 };
  const next = { capturedAt: "2026-08-28T03:00:11.000Z", slot: 21 };
  assert.equal(newerSnapshot(current, next), next);
});
