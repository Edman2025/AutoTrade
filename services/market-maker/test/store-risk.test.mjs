import test from "node:test";
import assert from "node:assert/strict";
import { MakerStore } from "../lib/store.mjs";
import { RiskEngine } from "../lib/risk-engine.mjs";
import { loadConfig } from "../lib/config.mjs";

test("store starts paused and preserves a two-phase intent audit trail", () => {
  const store = new MakerStore(":memory:");
  try {
    assert.equal(store.controlState().paused, true);
    const intent = store.createIntent({ kind: "swap", summary: { amount: "1" }, unsignedTx: "abc", ttlMs: 60_000 });
    assert.equal(intent.state, "prepared");
    const approved = store.approveIntent(intent.id);
    assert.equal(approved.state, "approved");
    assert.deepEqual(store.listAudit().map((event) => event.action), ["intent.approved", "intent.prepared"]);
  } finally { store.close(); }
});

test("risk engine blocks observe mode and passes a bounded prepare action after resume", () => {
  const wallet = "11111111111111111111111111111111";
  const config = loadConfig({
    MAKER_MODE: "prepare",
    MAKER_WALLET_ADDRESS: wallet,
    MAKER_ADMIN_TOKEN: "0123456789abcdef0123456789abcdef",
  });
  const store = new MakerStore(":memory:");
  try {
    store.setPaused(false);
    const engine = new RiskEngine(config, store);
    const result = engine.evaluate({ inputSymbol: "ANTFUN", amountInRaw: "1000000", slippageBps: 50 }, {
      quotedAt: new Date().toISOString(),
      priceImpactBps: 10,
      identityVerified: true,
      topologyVerified: true,
      walletSolRaw: "1000000000",
      inventoryReducing: true,
      dailyNotionalUsdtRaw: "0",
      dailyLossBps: 0,
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.reasons, []);
  } finally { store.close(); }
});

test("risk engine blocks stale quotes and excessive impact", () => {
  const config = loadConfig({});
  const store = new MakerStore(":memory:");
  try {
    const engine = new RiskEngine(config, store);
    const result = engine.evaluate({ inputSymbol: "BG", amountInRaw: "1000000", slippageBps: 50 }, {
      quotedAt: new Date(Date.now() - 60_000).toISOString(),
      priceImpactBps: 500,
      identityVerified: true,
      topologyVerified: false,
      inventoryReducing: true,
    });
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((reason) => reason.includes("observe")));
    assert.ok(result.reasons.some((reason) => reason.includes("stale")));
    assert.ok(result.reasons.some((reason) => reason.includes("Price impact")));
    assert.ok(result.reasons.some((reason) => reason.includes("topology")));
  } finally { store.close(); }
});
