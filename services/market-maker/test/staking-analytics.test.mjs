import test from "node:test";
import assert from "node:assert/strict";
import { StakingAnalyticsService } from "../lib/staking-analytics.mjs";

const config = { stakingAnalyticsUrl: "http://127.0.0.1:4317/api/internal/staking-analytics" };

test("staking analytics validates source and masks wallet and transaction identities", async () => {
  const payload = {
    status: "ready",
    capturedAt: "2026-09-15T08:00:00.000Z",
    assets: { principal: "SIAM", reward: "ANTFUN", decimals: 6 },
    summary: { registeredUsers: 16, stakingUsers: 2, activeStakedRaw: "1012000000", settledRewardRaw: "6395" },
    planBreakdown: [],
    statusBreakdown: [],
    daily: [],
    orders: [{ id: "order", userId: "internal", address: "11111111111111111111111111111111", stakeSignature: "5".repeat(88) }],
    settlements: [{ orderId: "order", address: "11111111111111111111111111111111" }],
    payouts: [{ id: "payout", address: "11111111111111111111111111111111", signature: "4".repeat(88) }],
    coverage: {},
    source: { system: "Siam Community production ledger" },
  };
  let receivedToken;
  const service = new StakingAnalyticsService(config, {
    token: "x".repeat(48),
    fetchImpl: async (_url, options) => {
      receivedToken = options.headers["x-siam-analytics-token"];
      return { ok: true, json: async () => payload };
    },
  });
  const result = await service.read();
  assert.equal(receivedToken, "x".repeat(48));
  assert.equal(result.summary.activeStakedRaw, "1012000000");
  assert.equal(result.orders[0].address, undefined);
  assert.equal(result.orders[0].userId, undefined);
  assert.match(result.orders[0].participantId, /^用户 [a-f0-9]{10}$/);
  assert.equal(result.orders[0].stakeSignature, undefined);
  assert.equal(result.orders[0].stakeSignatureMasked, "555555…55555");
  assert.equal(result.payouts[0].signature, undefined);
  assert.equal(result.privacy.demoAccountsExcluded, true);
});

test("staking analytics fails closed without a credential", async () => {
  const service = new StakingAnalyticsService(config, { token: null, fetchImpl: async () => { throw new Error("must not fetch"); } });
  const result = await service.read();
  assert.equal(result.status, "unavailable");
  assert.equal(result.summary, null);
});
