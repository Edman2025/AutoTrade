import test from "node:test";
import assert from "node:assert/strict";
import { rawToUi, uiToRaw } from "../lib/market-data.mjs";

test("token amount conversion never uses floating point arithmetic", () => {
  assert.equal(uiToRaw("496.500584", 6), 496_500_584n);
  assert.equal(rawToUi(496_500_584n, 6), "496.500584");
  assert.equal(uiToRaw("0.01", 9), 10_000_000n);
  assert.equal(rawToUi(10_000_000n, 9), "0.01");
});
