import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../lib/config.mjs";
import { RiskAccountingService } from "../lib/risk-accounting.mjs";
import { MakerStore } from "../lib/store.mjs";

function wallet({ BG = "0", ANTFUN = "0", USDT = "0", solRaw = "200000000" } = {}) {
  return {
    address: "11111111111111111111111111111111",
    addressVerified: true,
    solRaw,
    tokenAccounts: [
      { symbol: "BG", amountRaw: BG },
      { symbol: "ANTFUN", amountRaw: ANTFUN },
      { symbol: "USDT", amountRaw: USDT },
    ],
  };
}

test("live risk context is populated from chain balances and the USDT ledger", () => {
  const config = loadConfig({
    MAKER_MODE: "live",
    MAKER_WALLET_ADDRESS: "11111111111111111111111111111111",
    MAKER_ADMIN_TOKEN: "0123456789abcdef0123456789abcdef",
    MAKER_LIVE_ACK: "I_UNDERSTAND_MAINNET",
    SOLANA_RPC_URL: "https://tenant.reviewed-rpc.example/key",
    MAKER_RPC_PROVIDER: "reviewed-test-provider",
    MAKER_RPC_SLA_ACK: "I_VERIFIED_PRIVATE_RPC_SLA",
  });
  const store = new MakerStore(":memory:");
  try {
    const service = new RiskAccountingService(config, store);
    const context = service.contextFor({
      action: { kind: "route-swap", inputSymbol: "BG", amountInRaw: "10000000" },
      quote: { minOutRaw: "1000000" },
      snapshot: { wallet: wallet({ BG: "100000000" }), impliedPrices: { bgInUsdt: 0.1, antfunInUsdt: 0.01 } },
    });
    assert.equal(context.ready, true);
    assert.equal(context.inventoryReducing, true);
    assert.equal(context.sufficientInputBalance, true);
    assert.equal(context.dailyNotionalUsdtRaw, "0");
    assert.equal(context.proposedNotionalUsdtRaw, "1000000");
    assert.equal(context.dailyLossBps, 0);
    assert.deepEqual(store.listCostBasis().map((row) => row.symbol), ["ANTFUN", "BG", "USDT"]);
  } finally { store.close(); }
});

test("confirmed balance deltas update cost basis, realized PnL, and daily notional atomically", () => {
  const config = loadConfig({});
  const store = new MakerStore(":memory:");
  try {
    const service = new RiskAccountingService(config, store);
    service.contextFor({
      action: { kind: "route-swap", inputSymbol: "BG", amountInRaw: "10000000" },
      quote: { minOutRaw: "1000000" },
      snapshot: { wallet: wallet({ BG: "100000000" }), impliedPrices: { bgInUsdt: 0.1, antfunInUsdt: 0.01 } },
    });
    const intent = store.createIntent({
      kind: "route-swap",
      summary: { action: { kind: "route-swap", inputSymbol: "BG", amountInRaw: "10000000" }, accounting: { prices: { BG: "100000", ANTFUN: "10000", USDT: "1000000" } } },
    });
    const execution = service.buildExecution({
      intent,
      signature: "signature",
      balanceBefore: wallet({ BG: "100000000" }),
      balanceAfter: wallet({ BG: "90000000", USDT: "1100000", solRaw: "199995000" }),
    });
    assert.equal(execution.realizedPnlUsdtRaw, "100000");
    assert.equal(execution.notionalUsdtRaw, "1100000");
    assert.equal(execution.solFeeRaw, "5000");
    store.markExecuted(intent.id, "signature", execution);
    assert.equal(store.getExecution(intent.id).realizedPnlUsdtRaw, "100000");
    assert.equal(store.listCostBasis().find((row) => row.symbol === "BG").quantityRaw, "90000000");
  } finally { store.close(); }
});

test("route legs preserve confirmed progress and expose only the active unsigned transaction", () => {
  const store = new MakerStore(":memory:");
  try {
    const intent = store.createRouteIntent({
      summary: { action: { kind: "route-swap", inputSymbol: "BG" } },
      legs: [
        { pool: "bgAntfun", inputSymbol: "BG", outputSymbol: "ANTFUN", amountInRaw: "10", minOutRaw: "9", unsignedTx: "first", blockhash: "block1", lastValidBlockHeight: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
        { pool: "antfunUsdt", inputSymbol: "ANTFUN", outputSymbol: "USDT", amountInRaw: "9", minOutRaw: "8" },
      ],
    });
    store.approveIntent(intent.id);
    store.markRouteLegSubmitted(intent.id, 0, "sig1", wallet({ BG: "10" }));
    store.markRouteLegConfirmed(intent.id, 0, wallet({ ANTFUN: "9" }));
    store.prepareRouteLeg(intent.id, 1, { amountInRaw: "9", minOutRaw: "8", unsignedTx: "second", blockhash: "block2", lastValidBlockHeight: 2, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const legs = store.getRouteLegs(intent.id, { includeUnsigned: true });
    assert.deepEqual(legs.map((leg) => leg.state), ["confirmed", "prepared"]);
    assert.equal(store.getActiveRouteLeg(intent.id, { includeUnsigned: true }).unsignedTx, "second");
  } finally { store.close(); }
});
