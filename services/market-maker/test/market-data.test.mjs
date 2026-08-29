import test from "node:test";
import assert from "node:assert/strict";
import { aggregateParsedTokenAccounts, impliedPrices, MarketDataService, percentToBps, poolExecutable, retryRpcRead } from "../lib/market-data.mjs";

test("converts SDK percentage price impact to basis points", () => {
  assert.equal(percentToBps("0.074"), 7);
  assert.equal(percentToBps("1"), 100);
  assert.equal(percentToBps({ toString: () => "1.255" }), 126);
});

test("rejects invalid price impact values", () => {
  assert.throws(() => percentToBps("not-a-number"), /non-negative percentage/);
  assert.throws(() => percentToBps(-0.1), /non-negative percentage/);
});

test("aggregates only supported public token accounts without floating point", () => {
  const parsed = (mint, amount) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount } } } } } });
  const accounts = aggregateParsedTokenAccounts([
    parsed("HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan", "1000001"),
    parsed("HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan", "2000002"),
    parsed("11111111111111111111111111111111", "999"),
  ]);
  assert.deepEqual(accounts, [{
    symbol: "BG",
    mint: "HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan",
    decimals: 6,
    amountRaw: "3000003",
    amountUi: "3.000003",
    accounts: 2,
  }]);
});

test("derives the BG USDT price through the approved two-pool topology", () => {
  const prices = impliedPrices({
    bgAntfun: { price: { base: "BG", quote: "ANTFUN", baseInQuote: 0.03, quoteInBase: 33.333333 } },
    antfunUsdt: { price: { base: "ANTFUN", quote: "USDT", baseInQuote: 0.02, quoteInBase: 50 } },
  });
  assert.equal(prices.bgInAntfun, 0.03);
  assert.equal(prices.antfunInUsdt, 0.02);
  assert.ok(Math.abs(prices.bgInUsdt - 0.0006) < 1e-15);
});

test("pool execution readiness requires identity, reserves, and two-way quotes", () => {
  const pool = {
    identity: { verified: true }, enabled: true,
    tokenX: { symbol: "ANTFUN", amountRaw: "100" },
    tokenY: { symbol: "USDT", amountRaw: "200" },
    quotes: [{ inputSymbol: "ANTFUN", expectedOutRaw: "10" }, { inputSymbol: "USDT", expectedOutRaw: "5" }],
  };
  assert.equal(poolExecutable(pool), true);
  assert.equal(poolExecutable({ ...pool, quotes: pool.quotes.slice(0, 1) }), false);
  assert.equal(poolExecutable({ ...pool, tokenX: { symbol: "ANTFUN", amountRaw: "0" } }), false);
});

test("transient RPC read failures are retried without changing quote policy", async () => {
  let attempts = 0;
  const result = await retryRpcRead(async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError("fetch failed");
    return "ready";
  }, { attempts: 3, delayMs: 0 });
  assert.equal(result, "ready");
  assert.equal(attempts, 3);
});

test("token intelligence reports authorities and exact holder concentration", async () => {
  const service = Object.create(MarketDataService.prototype);
  service.config = { network: "mainnet-beta" };
  service.connection = {
    getParsedAccountInfo: async () => ({ value: { owner: { toBase58: () => "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, data: { parsed: { info: { decimals: 6, isInitialized: true, supply: "100000000", mintAuthority: null, freezeAuthority: null } } } } }),
    getTokenSupply: async () => ({ value: { amount: "100000000", decimals: 6, uiAmountString: "100" } }),
    getTokenLargestAccounts: async () => ({ value: [
      { address: { toBase58: () => "largest-1" }, amount: "50000000", uiAmountString: "50" },
      { address: { toBase58: () => "largest-2" }, amount: "25000000", uiAmountString: "25" },
    ] }),
  };
  const result = await service.tokenIntelligence("BG");
  assert.equal(result.authoritiesRevoked, true);
  assert.equal(result.concentration.top1Bps, 5_000);
  assert.equal(result.concentration.top5Bps, 7_500);
  assert.equal(result.largestAccounts[1].shareBps, 2_500);
});

test("execution infrastructure exposes priority-fee percentiles without enabling bundle broadcast", async () => {
  const service = Object.create(MarketDataService.prototype);
  service.config = { network: "mainnet-beta", rpcPolicyMode: "public-risk-accepted", rpcPolicyVerified: true };
  service.connection = {
    getLatestBlockhashAndContext: async () => ({ context: { slot: 123 }, value: { lastValidBlockHeight: 456 } }),
    getRecentPrioritizationFees: async () => [0, 10, 20, 30].map((prioritizationFee, slot) => ({ prioritizationFee, slot })),
  };
  const result = await service.executionInfrastructure();
  assert.equal(result.priorityFeeMicroLamports.p50, 10);
  assert.equal(result.priorityFeeMicroLamports.p90, 30);
  assert.equal(result.deliveryChannels.jito.configured, false);
  assert.equal(result.signing.bundleBroadcast, false);
});
