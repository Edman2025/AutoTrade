import test from "node:test";
import assert from "node:assert/strict";
import { aggregateHolders, buildLiquidityHistory, computeProfitability, parsePoolSwap } from "../lib/token-monitor.mjs";

test("aggregates every positive token account by owner and keeps exact concentration", () => {
  const accounts = [
    tokenAccount("ata-a1", "wallet-a", "6000000"),
    tokenAccount("ata-a2", "wallet-a", "4000000"),
    tokenAccount("pool-vault", "pool-authority", "90000000"),
    tokenAccount("empty", "wallet-b", "0"),
  ];
  const result = aggregateHolders(accounts, { supplyRaw: "100000000", poolVault: "pool-vault", operationalWallet: "wallet-a" });
  assert.equal(result.distinctHolders, 2);
  assert.equal(result.positiveTokenAccounts, 3);
  assert.equal(result.supplyCoverageBps, 10_000);
  assert.equal(result.holders[0].shareBps, 9_000);
  assert.deepEqual(result.holders[0].tags, ["主池流动性"]);
  assert.equal(result.holders[1].tokenAccounts, 2);
  assert.deepEqual(result.holders[1].tags, ["运营钱包"]);
});

test("parses a pool swap only when the two verified vaults move in opposite directions", () => {
  const transaction = {
    slot: 123,
    blockTime: 1_700_000_000,
    transaction: { message: { accountKeys: ["siam-vault", "antfun-vault", "trader-siam", "trader-antfun"] } },
    meta: {
      err: null,
      preTokenBalances: [
        balance(0, "SIAM", "pool", "1000000000"),
        balance(1, "ANTFUN", "pool", "500000000"),
        balance(2, "SIAM", "wallet", "0"),
        balance(3, "ANTFUN", "wallet", "100000000"),
      ],
      postTokenBalances: [
        balance(0, "SIAM", "pool", "900000000"),
        balance(1, "ANTFUN", "pool", "510000000"),
        balance(2, "SIAM", "wallet", "100000000"),
        balance(3, "ANTFUN", "wallet", "90000000"),
      ],
    },
  };
  const result = parsePoolSwap(transaction, {
    signature: "sig", siamMint: "SIAM", antfunMint: "ANTFUN", siamVault: "siam-vault", antfunVault: "antfun-vault",
  });
  assert.equal(result.side, "buy");
  assert.equal(result.walletAddress, "wallet");
  assert.equal(result.tokenAmountRaw, "100000000");
  assert.equal(result.quoteAmountRaw, "10000000");
});

test("profitability is explicitly limited to indexed swaps and flags uncovered sells", () => {
  const activities = [
    activity("2026-01-01T00:00:00.000Z", "buy", "100000000", "10000000"),
    activity("2026-01-01T00:01:00.000Z", "sell", "40000000", "8000000"),
    { ...activity("2026-01-01T00:02:00.000Z", "sell", "1000000", "100000"), walletAddress: "legacy" },
  ];
  const result = computeProfitability(activities, [], { siamInUsdt: 0.03, antfunInUsdt: 0.2 });
  const wallet = result.wallets.find((item) => item.address === "wallet");
  assert.equal(wallet.coverage, "window");
  assert.ok(Math.abs(wallet.estimatedPnlUsdt - 1.4) < 1e-9);
  assert.equal(result.wallets.find((item) => item.address === "legacy").coverage, "partial");
});

test("builds an honest liquidity series only from compatible mainnet snapshots", () => {
  const result = buildLiquidityHistory([
    snapshot("2026-01-01T00:00:00.000Z", 100, 20, 200, 50, 0.1, 0.5),
    { capturedAt: "2026-01-01T00:00:30.000Z", pools: {} },
    snapshot("2026-01-01T00:01:00.000Z", 110, 21, 205, 52, 0.1, 0.5),
  ]);
  assert.equal(result.status, "ready");
  assert.equal(result.window.samples, 2);
  assert.equal(result.points[0].totalLiquidityUsd, 170);
  assert.equal(result.current.totalLiquidityUsd, 176);
  assert.equal(result.changeBps, 353);
});

function tokenAccount(pubkey, owner, amount) {
  return { pubkey: { toBase58: () => pubkey }, account: { data: { parsed: { info: { owner, tokenAmount: { amount } } } } } };
}
function balance(accountIndex, mint, owner, amount) { return { accountIndex, mint, owner, uiTokenAmount: { amount } }; }
function activity(blockTime, side, tokenAmountRaw, quoteAmountRaw) {
  return { blockTime, side, tokenAmountRaw, quoteAmountRaw, walletAddress: "wallet" };
}
function snapshot(capturedAt, siam, poolAntfun, bridgeAntfun, usdt, siamInUsdt, antfunInUsdt) {
  return {
    capturedAt,
    impliedPrices: { siamInUsdt, antfunInUsdt },
    pools: {
      siamAntfun: { tokenA: { symbol: "SIAM", amountUi: String(siam) }, tokenB: { symbol: "ANTFUN", amountUi: String(poolAntfun) } },
      antfunUsdt: { tokenX: { symbol: "ANTFUN", amountUi: String(bridgeAntfun) }, tokenY: { symbol: "USDT", amountUi: String(usdt) } },
    },
  };
}
