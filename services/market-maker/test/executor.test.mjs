import test from "node:test";
import assert from "node:assert/strict";
import { routePlan, TransactionExecutor } from "../lib/executor.mjs";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { MakerStore } from "../lib/store.mjs";

test("prepare mode cannot broadcast a signed transaction", async () => {
  const executor = new TransactionExecutor(
    { mode: "prepare", rpcUrl: "http://127.0.0.1:9", walletAddress: "11111111111111111111111111111111" },
    { connection: null },
    {},
    {},
  );
  await assert.rejects(() => executor.submitSigned("intent", "AAAA"), /only in explicitly acknowledged live mode/);
});

test("signed transaction must exactly match the saved unsigned intent", () => {
  const wallet = Keypair.generate();
  const executor = new TransactionExecutor(
    { mode: "live", rpcUrl: "http://127.0.0.1:9", walletAddress: wallet.publicKey.toBase58() },
    { connection: null },
    {},
    {},
  );
  const build = (lamports) => {
    const transaction = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: "11111111111111111111111111111111" });
    transaction.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports }));
    return transaction;
  };
  const expected = build(1);
  const intent = {
    unsignedTx: expected.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    summary: { allowedPrograms: [SystemProgram.programId.toBase58()] },
  };
  const signed = build(1);
  signed.sign(wallet);
  assert.doesNotThrow(() => executor.validateSignedTransaction(signed, intent));

  const tampered = build(2);
  tampered.sign(wallet);
  assert.throws(() => executor.validateSignedTransaction(tampered, intent), /exactly match the approved intent/);
});

test("approved bridge route is deterministic in both directions", () => {
  assert.deepEqual(routePlan("USDT").map((leg) => leg.pool), ["antfunUsdt", "bgAntfun"]);
  assert.deepEqual(routePlan("BG").map((leg) => leg.pool), ["bgAntfun", "antfunUsdt"]);
  assert.throws(() => routePlan("SOL"), /BG or USDT/);
});

test("route quote chains each protected minimum into the next leg", async () => {
  const pools = {
    antfunUsdt: { tokenX: "ANTFUN", tokenY: "USDT", kind: "dlmm" },
    bgAntfun: { tokenX: "BG", tokenY: "ANTFUN", kind: "damm-v2" },
  };
  const executor = new TransactionExecutor(
    { mode: "observe", rpcUrl: "http://127.0.0.1:9", walletAddress: null, pools, risk: { maxSlippageBps: 100 } },
    { connection: null, capture: async () => ({ slot: 1, topologyReady: true, pools: Object.fromEntries(Object.keys(pools).map((key) => [key, { identity: { verified: true } }])) }) },
    { evaluate: () => ({ passed: false, reasons: ["System is in observe mode."] }) },
    {},
  );
  const seen = [];
  executor.quotePool = async (pool, inputSymbol, amountInRaw, slippageBps) => {
    seen.push({ pool, inputSymbol, amountInRaw, slippageBps });
    const minOutRaw = (BigInt(amountInRaw) - 1n).toString();
    return { quotedAt: new Date().toISOString(), amountInRaw, amountInUi: amountInRaw, expectedOutRaw: amountInRaw, expectedOutUi: amountInRaw, minOutRaw, minOutUi: minOutRaw, priceImpactBps: 1 };
  };
  const result = await executor.routeQuote({ kind: "route-swap", inputSymbol: "USDT", amountInRaw: "1000", slippageBps: 100 });
  assert.deepEqual(seen.map((item) => item.amountInRaw), ["1000", "999"]);
  assert.equal(result.minOutRaw, "998");
  assert.equal(result.compoundedSlippageBps, 199);
});

test("a confirmed single swap is recovered without rebroadcast and updates accounting", async () => {
  const store = new MakerStore(":memory:");
  try {
    const intent = store.createIntent({
      kind: "swap",
      summary: { action: { kind: "swap", inputSymbol: "BG", outputSymbol: "ANTFUN" } },
      unsignedTx: "unsigned",
    });
    store.approveIntent(intent.id);
    const balanceBefore = { solRaw: "100", tokenAccounts: [] };
    store.markIntentSubmitted(intent.id, "confirmed-signature", balanceBefore);
    const execution = {
      inputSymbol: "BG", outputSymbol: "ANTFUN", amountInRaw: "10", amountOutRaw: "9",
      notionalUsdtRaw: "10", realizedPnlUsdtRaw: "0", solFeeRaw: "1",
      balanceBefore, balanceAfter: { solRaw: "99", tokenAccounts: [] }, costBasisUpdates: [],
    };
    const executor = new TransactionExecutor(
      { mode: "live", rpcUrl: "http://127.0.0.1:9", walletAddress: Keypair.generate().publicKey.toBase58() },
      { connection: null, snapshotWallet: async () => execution.balanceAfter },
      {},
      store,
      { getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }) },
      { buildExecution: ({ balanceBefore: recovered }) => { assert.deepEqual(recovered, balanceBefore); return execution; } },
    );
    const result = await executor.recoverSingleConfirmation(store.getIntent(intent.id));
    assert.equal(result.recovered, true);
    assert.equal(store.getIntent(intent.id).state, "executed");
    assert.equal(store.getExecution(intent.id).signature, "confirmed-signature");
  } finally {
    store.close();
  }
});
