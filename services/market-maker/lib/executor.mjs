import { createRequire } from "node:module";
import { BN } from "@coral-xyz/anchor";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PROGRAMS, TOKENS, tokenByMint } from "./config.mjs";
import { priceTable, RiskAccountingService } from "./risk-accounting.mjs";

const require = createRequire(import.meta.url);
const DLMM = require("@meteora-ag/dlmm");

const ALLOWED_PROGRAMS = new Set([
  PROGRAMS.dammV2,
  PROGRAMS.dlmm,
  SystemProgram.programId.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);

export class TransactionExecutor {
  constructor(config, marketData, riskEngine, store, connection = marketData.connection ?? new Connection(config.rpcUrl, "confirmed"), riskAccounting = null) {
    this.config = config;
    this.marketData = marketData;
    this.riskEngine = riskEngine;
    this.store = store;
    this.connection = connection;
    this.cpAmm = new CpAmm(connection);
    this.riskAccounting = riskAccounting ?? new RiskAccountingService(config, store);
  }

  async quote(action) {
    if (action?.kind === "route-swap") return this.routeQuote(action);
    const normalized = normalizeAction(action, this.config);
    const quote = await this.quotePool(normalized.pool, normalized.inputSymbol, normalized.amountInRaw, normalized.slippageBps);
    const snapshot = await this.marketData.capture();
    const poolSnapshot = snapshot.pools[normalized.pool];
    const walletSolRaw = this.config.walletAddress
      ? await this.connection.getBalance(new PublicKey(this.config.walletAddress), "confirmed")
      : null;
    const accounting = this.riskAccounting.contextFor({ action: normalized, quote, snapshot });
    const risk = this.riskEngine.evaluate(normalized, {
      quotedAt: quote.quotedAt,
      priceImpactBps: quote.priceImpactBps,
      identityVerified: Boolean(poolSnapshot?.identity?.verified),
      topologyVerified: Boolean(snapshot.topologyReady),
      walletSolRaw,
      ...accounting,
      rpcPolicyVerified: this.config.rpcPolicyVerified,
      walletIdentityVerified: Boolean(snapshot.wallet?.addressVerified),
    });
    return { action: normalized, quote, risk, accounting, impliedPrices: snapshot.impliedPrices, snapshotSlot: snapshot.slot };
  }

  async routeQuote(action, context = {}) {
    const normalized = normalizeRouteAction(action, this.config);
    const route = routePlan(normalized.inputSymbol);
    const legs = [];
    let amountInRaw = normalized.amountInRaw;
    for (const leg of route) {
      const quote = await this.quotePool(leg.pool, leg.inputSymbol, amountInRaw, normalized.slippageBps);
      legs.push({ ...leg, quote });
      amountInRaw = quote.minOutRaw;
    }
    const snapshot = context.snapshot ?? await this.marketData.capture();
    const walletSolRaw = Object.hasOwn(context, "walletSolRaw")
      ? context.walletSolRaw
      : this.config.walletAddress
        ? await this.connection.getBalance(new PublicKey(this.config.walletAddress), "confirmed")
        : null;
    const routeQuote = { minOutRaw: legs.at(-1).quote.minOutRaw };
    const accounting = this.riskAccounting.contextFor({ action: normalized, quote: routeQuote, snapshot });
    const legRisks = legs.map((leg) => this.riskEngine.evaluate({
      kind: "swap",
      pool: leg.pool,
      inputSymbol: leg.inputSymbol,
      outputSymbol: leg.outputSymbol,
      amountInRaw: leg.quote.amountInRaw,
      slippageBps: normalized.slippageBps,
    }, {
      quotedAt: leg.quote.quotedAt,
      priceImpactBps: leg.quote.priceImpactBps,
      identityVerified: Boolean(snapshot.pools[leg.pool]?.identity?.verified),
      topologyVerified: Boolean(snapshot.topologyReady),
      walletSolRaw,
      ...accounting,
      rpcPolicyVerified: this.config.rpcPolicyVerified,
      walletIdentityVerified: Boolean(snapshot.wallet?.addressVerified),
    }));
    const reasons = [...new Set(legRisks.flatMap((risk) => risk.reasons))];
    return {
      action: normalized,
      route: route.map((leg) => leg.pool),
      legs,
      expectedOutRaw: legs.at(-1).quote.expectedOutRaw,
      minOutRaw: legs.at(-1).quote.minOutRaw,
      outputSymbol: legs.at(-1).outputSymbol,
      compoundedSlippageBps: Math.round((1 - (1 - normalized.slippageBps / 10_000) ** legs.length) * 10_000),
      risk: { passed: reasons.length === 0, reasons, legs: legRisks },
      accounting,
      impliedPrices: snapshot.impliedPrices,
      snapshotSlot: snapshot.slot,
    };
  }

  async quotePool(poolKey, inputSymbol, amountInRaw, slippageBps) {
    const poolConfig = this.config.pools[poolKey];
    try {
      return await (poolConfig.kind === "damm-v2"
        ? this.marketData.cpQuote(poolConfig.address, TOKENS[inputSymbol].mint, amountInRaw, slippageBps)
        : this.marketData.dlmmQuote(poolConfig.address, TOKENS[inputSymbol].mint, amountInRaw, slippageBps));
    } catch (error) {
      throw Object.assign(new Error(`${poolConfig.tokenX}/${poolConfig.tokenY} mainnet quote failed: ${error.message}`), { statusCode: 503 });
    }
  }

  async prepare(action) {
    if (this.config.mode === "observe") throw Object.assign(new Error("Observe mode cannot prepare transactions."), { statusCode: 409 });
    if (action?.kind === "route-swap") return this.prepareRoute(action);
    const result = await this.quote(action);
    if (!result.risk.passed) throw Object.assign(new Error(`Risk check failed: ${result.risk.reasons.join(" ")}`), { statusCode: 409, details: result.risk });
    const transaction = await this.buildSwap(result.action, result.quote);
    const simulation = await this.simulate(transaction);
    const unsignedTx = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const summary = {
      action: result.action,
      quote: result.quote,
      risk: result.risk,
      simulation: { unitsConsumed: simulation.unitsConsumed ?? null, logs: tailLogs(simulation.logs) },
      feePayer: this.config.walletAddress,
      allowedPrograms: [...new Set(transaction.instructions.map((instruction) => instruction.programId.toBase58()))],
      validity: transactionValidity(transaction),
      accounting: { ...result.accounting, prices: priceTable(result.impliedPrices) },
    };
    return this.store.createIntent({ kind: "swap", summary, unsignedTx, ttlMs: 60_000 });
  }

  async submitSigned(intentId, signedTransactionBase64) {
    if (this.config.mode !== "live") throw Object.assign(new Error("Broadcasting is available only in explicitly acknowledged live mode."), { statusCode: 409 });
    const intent = this.store.getIntent(intentId);
    if (!intent) throw Object.assign(new Error("Intent not found."), { statusCode: 404 });
    if (intent.kind === "route-swap") return this.submitSignedRoute(intent, signedTransactionBase64);
    if (intent.state === "confirming") return this.recoverSingleConfirmation(intent);
    if (intent.state !== "approved") throw Object.assign(new Error("Intent must be approved before broadcast."), { statusCode: 409 });
    if (Date.parse(intent.expiresAt) <= Date.now()) throw Object.assign(new Error("Intent expired; rebuild and sign a fresh transaction."), { statusCode: 409 });
    const current = await this.quote(intent.summary.action);
    if (!current.risk.passed) {
      throw Object.assign(new Error(`Broadcast-time risk check failed: ${current.risk.reasons.join(" ")}`), { statusCode: 409, details: current.risk });
    }
    const transaction = Transaction.from(Buffer.from(signedTransactionBase64, "base64"));
    this.validateSignedTransaction(transaction, intent);
    const simulation = await this.connection.simulateTransaction(transaction);
    if (simulation.value.err) throw new Error(`Signed transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
    try {
      const balanceBefore = await this.marketData.snapshotWallet(this.config.walletAddress);
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      this.store.markIntentSubmitted(intentId, signature, balanceBefore);
      await this.confirm(signature, intent.summary.validity);
      const balanceAfter = await this.marketData.snapshotWallet(this.config.walletAddress);
      const execution = this.riskAccounting.buildExecution({ intent, signature, balanceBefore, balanceAfter });
      this.store.markExecuted(intentId, signature, execution);
      return { signature, status: "confirmed", accounting: executionSummary(execution) };
    } catch (error) {
      const submitted = this.store.getIntent(intentId)?.state === "confirming";
      if (submitted) this.store.markIntentConfirmationPending(intentId, error);
      else this.store.markFailed(intentId, error);
      throw error;
    }
  }

  async prepareRoute(action) {
    const result = await this.routeQuote(action);
    if (!result.risk.passed) throw Object.assign(new Error(`Risk check failed: ${result.risk.reasons.join(" ")}`), { statusCode: 409, details: result.risk });
    const first = result.legs[0];
    const transaction = await this.buildSwap({ kind: "swap", ...first }, first.quote);
    const simulation = await this.simulate(transaction);
    const prepared = preparedTransaction(transaction);
    const summary = {
      action: result.action,
      route: result.route,
      legs: result.legs,
      outputSymbol: result.outputSymbol,
      expectedOutRaw: result.expectedOutRaw,
      minOutRaw: result.minOutRaw,
      compoundedSlippageBps: result.compoundedSlippageBps,
      risk: result.risk,
      simulation: { unitsConsumed: simulation.unitsConsumed ?? null, logs: tailLogs(simulation.logs) },
      feePayer: this.config.walletAddress,
      accounting: { ...result.accounting, prices: priceTable(result.impliedPrices) },
    };
    return this.store.createRouteIntent({
      summary,
      legs: result.legs.map((leg, index) => ({
        ...leg,
        amountInRaw: leg.quote.amountInRaw,
        minOutRaw: leg.quote.minOutRaw,
        ...(index === 0 ? prepared : {}),
      })),
    });
  }

  async submitSignedRoute(intent, signedTransactionBase64) {
    const active = this.store.getActiveRouteLeg(intent.id, { includeUnsigned: true });
    if (!active) throw Object.assign(new Error("All route legs are already confirmed."), { statusCode: 409 });
    if (active.state === "submitted") return this.recoverRouteConfirmation(intent, active);
    if (active.state !== "prepared") throw Object.assign(new Error("Route is waiting for recovery before another transaction can be signed."), { statusCode: 409, details: { leg: redactRouteLeg(active) } });
    if (Date.parse(active.expiresAt) <= Date.now()) {
      this.store.markRouteLegFailed(intent.id, active.index, new Error("Route leg transaction expired before broadcast."));
      throw Object.assign(new Error("Route leg expired; resume it to build a fresh transaction."), { statusCode: 409 });
    }
    if (active.index === 0) {
      const current = await this.routeQuote(intent.summary.action);
      if (!current.risk.passed) throw Object.assign(new Error(`Broadcast-time route risk check failed: ${current.risk.reasons.join(" ")}`), { statusCode: 409, details: current.risk });
      if (BigInt(current.minOutRaw) < BigInt(intent.summary.minOutRaw)) {
        throw Object.assign(new Error("Current route quote is below the approved final minimum; rebuild the route instead of creating an avoidable partial execution."), { statusCode: 409 });
      }
    } else {
      const current = await this.quote({ kind: "swap", pool: active.pool, inputSymbol: active.inputSymbol, amountInRaw: active.amountInRaw, slippageBps: intent.summary.action.slippageBps });
      if (!current.risk.passed) throw Object.assign(new Error(`Broadcast-time route-leg risk check failed: ${current.risk.reasons.join(" ")}`), { statusCode: 409, details: current.risk });
      if (BigInt(current.quote.minOutRaw) < BigInt(active.minOutRaw)) {
        throw Object.assign(new Error("Current quote is below the signed route-leg minimum."), { statusCode: 409 });
      }
    }
    const transaction = Transaction.from(Buffer.from(signedTransactionBase64, "base64"));
    this.validateSignedTransaction(transaction, { ...intent, unsignedTx: active.unsignedTx, summary: { ...intent.summary, allowedPrograms: programsFor(Transaction.from(Buffer.from(active.unsignedTx, "base64"))) } });
    const simulation = await this.connection.simulateTransaction(transaction);
    if (simulation.value.err) throw new Error(`Signed route-leg simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const balanceBefore = await this.marketData.snapshotWallet(this.config.walletAddress);
    try {
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      this.store.markRouteLegSubmitted(intent.id, active.index, signature, balanceBefore);
      await this.confirm(signature, active);
      const balanceAfter = await this.marketData.snapshotWallet(this.config.walletAddress);
      this.store.markRouteLegConfirmed(intent.id, active.index, balanceAfter);
      return this.afterRouteLegConfirmed(intent.id, active.index);
    } catch (error) {
      const current = this.store.getActiveRouteLeg(intent.id, { includeUnsigned: true });
      if (current?.state !== "submitted") this.store.markRouteLegFailed(intent.id, active.index, error);
      throw error;
    }
  }

  async afterRouteLegConfirmed(intentId, legIndex) {
    const intent = this.store.getIntent(intentId);
    const legs = this.store.getRouteLegs(intentId, { includeUnsigned: true });
    if (legIndex === legs.length - 1) {
      const first = legs[0];
      const last = legs.at(-1);
      const signatures = legs.map((leg) => leg.signature);
      const execution = this.riskAccounting.buildExecution({
        intent,
        signature: signatures.join(","),
        balanceBefore: first.balanceBefore,
        balanceAfter: last.balanceAfter,
      });
      this.store.markExecuted(intentId, last.signature, execution);
      return { status: "confirmed", signatures, accounting: executionSummary(execution), route: legs.map(redactRouteLeg) };
    }
    const next = legs[legIndex + 1];
    const received = tokenBalance(legs[legIndex].balanceAfter, next.inputSymbol) - tokenBalance(legs[legIndex].balanceBefore, next.inputSymbol);
    if (received <= 0n) {
      const error = new Error("Confirmed first leg produced no recoverable intermediate-token balance.");
      this.store.markRouteLegFailed(intentId, next.index, error);
      throw error;
    }
    return this.prepareNextRouteLeg(intent, next, received);
  }

  async prepareNextRouteLeg(intent, leg, amountInRaw) {
    try {
      const quote = await this.quotePool(leg.pool, leg.inputSymbol, amountInRaw.toString(), intent.summary.action.slippageBps);
      if (BigInt(quote.minOutRaw) < BigInt(intent.summary.minOutRaw)) {
        throw new Error("Current recovery quote is below the route's originally approved final minimum; intermediate funds remain untouched.");
      }
      const action = { kind: "swap", pool: leg.pool, inputSymbol: leg.inputSymbol, outputSymbol: leg.outputSymbol, amountInRaw: amountInRaw.toString(), slippageBps: intent.summary.action.slippageBps };
      const transaction = await this.buildSwap(action, quote);
      await this.simulate(transaction);
      const prepared = preparedTransaction(transaction);
      const saved = this.store.prepareRouteLeg(intent.id, leg.index, { ...prepared, amountInRaw, minOutRaw: quote.minOutRaw });
      return { status: "awaiting-signature", completedLegs: leg.index, nextLeg: saved };
    } catch (error) {
      this.store.markRouteLegFailed(intent.id, leg.index, error);
      throw Object.assign(error, { statusCode: error.statusCode ?? 409, details: { recoverable: true, legIndex: leg.index } });
    }
  }

  async resumeRoute(intentId) {
    const intent = this.store.getIntent(intentId);
    if (!intent || intent.kind !== "route-swap") throw Object.assign(new Error("Route intent not found."), { statusCode: 404 });
    const active = this.store.getActiveRouteLeg(intentId, { includeUnsigned: true });
    if (!active) return { status: "confirmed", route: this.store.getRouteLegs(intentId) };
    if (active.state === "submitted") return this.recoverRouteConfirmation(intent, active);
    if (active.index === 0) throw Object.assign(new Error("The first route leg did not confirm; create and approve a fresh route intent."), { statusCode: 409 });
    const previous = this.store.getRouteLegs(intentId, { includeUnsigned: true })[active.index - 1];
    if (previous.state !== "confirmed") throw Object.assign(new Error("Previous route leg is not confirmed."), { statusCode: 409 });
    const received = tokenBalance(previous.balanceAfter, active.inputSymbol) - tokenBalance(previous.balanceBefore, active.inputSymbol);
    return this.prepareNextRouteLeg(intent, active, received);
  }

  async recoverRouteConfirmation(intent, leg) {
    const status = await this.connection.getSignatureStatuses([leg.signature], { searchTransactionHistory: true });
    const value = status.value[0];
    if (value?.err) {
      const error = new Error(`Submitted route leg failed: ${JSON.stringify(value.err)}`);
      this.store.markRouteLegFailed(intent.id, leg.index, error);
      throw Object.assign(error, { statusCode: 409 });
    }
    if (!value) throw Object.assign(new Error("Submitted route leg is not yet confirmed."), { statusCode: 409 });
    if (!["confirmed", "finalized"].includes(value.confirmationStatus)) throw Object.assign(new Error("Submitted route leg is not yet confirmed."), { statusCode: 409 });
    const balanceAfter = await this.marketData.snapshotWallet(this.config.walletAddress);
    this.store.markRouteLegConfirmed(intent.id, leg.index, balanceAfter);
    return this.afterRouteLegConfirmed(intent.id, leg.index);
  }

  async recoverSingleConfirmation(intent) {
    const status = await this.connection.getSignatureStatuses([intent.signature], { searchTransactionHistory: true });
    const value = status.value[0];
    if (value?.err) {
      const error = new Error(`Submitted transaction failed: ${JSON.stringify(value.err)}`);
      this.store.markFailed(intent.id, error);
      throw Object.assign(error, { statusCode: 409 });
    }
    if (!value || !["confirmed", "finalized"].includes(value.confirmationStatus)) {
      throw Object.assign(new Error("Submitted transaction is not confirmed; it will not be rebroadcast."), { statusCode: 409 });
    }
    const submission = this.store.getIntentSubmission(intent.id);
    if (!submission || submission.signature !== intent.signature) {
      throw Object.assign(new Error("Transaction confirmation data is incomplete; manual accounting reconciliation is required."), { statusCode: 409 });
    }
    const balanceAfter = await this.marketData.snapshotWallet(this.config.walletAddress);
    const execution = this.riskAccounting.buildExecution({
      intent,
      signature: intent.signature,
      balanceBefore: submission.balanceBefore,
      balanceAfter,
    });
    this.store.markExecuted(intent.id, intent.signature, execution);
    return { signature: intent.signature, status: "confirmed", recovered: true, accounting: executionSummary(execution) };
  }

  async confirm(signature, validity) {
    const result = await this.connection.confirmTransaction({
      signature,
      blockhash: validity.blockhash,
      lastValidBlockHeight: validity.lastValidBlockHeight,
    }, "confirmed");
    if (result.value.err) throw new Error(`Transaction confirmation failed: ${JSON.stringify(result.value.err)}`);
  }

  async buildSwap(action, quote) {
    const wallet = new PublicKey(this.config.walletAddress);
    let transaction;
    const poolConfig = this.config.pools[action.pool];
    if (poolConfig.kind === "damm-v2") {
      const poolAddress = new PublicKey(poolConfig.address);
      const state = await this.cpAmm.fetchPoolState(poolAddress);
      const [tokenAInfo, tokenBInfo] = await Promise.all([
        this.connection.getAccountInfo(state.tokenAMint, "confirmed"),
        this.connection.getAccountInfo(state.tokenBMint, "confirmed"),
      ]);
      if (!tokenAInfo || !tokenBInfo) throw new Error("Token mint account is missing.");
      transaction = await this.cpAmm.swap({
        payer: wallet,
        pool: poolAddress,
        inputTokenMint: new PublicKey(quote.inputMint),
        outputTokenMint: new PublicKey(quote.outputMint),
        amountIn: new BN(quote.amountInRaw),
        minimumAmountOut: new BN(quote.minOutRaw),
        tokenAMint: state.tokenAMint,
        tokenBMint: state.tokenBMint,
        tokenAVault: state.tokenAVault,
        tokenBVault: state.tokenBVault,
        tokenAProgram: tokenAInfo.owner,
        tokenBProgram: tokenBInfo.owner,
        referralTokenAccount: null,
        poolState: state,
      });
    } else {
      const poolAddress = new PublicKey(poolConfig.address);
      const instance = await DLMM.create(this.connection, poolAddress);
      transaction = await instance.swap({
        inToken: new PublicKey(quote.inputMint),
        outToken: new PublicKey(quote.outputMint),
        inAmount: new BN(quote.amountInRaw),
        minOutAmount: new BN(quote.minOutRaw),
        lbPair: poolAddress,
        user: wallet,
        binArraysPubkey: quote.binArrays.map((address) => new PublicKey(address)),
      });
    }
    const latest = await this.connection.getLatestBlockhash("confirmed");
    transaction.feePayer = wallet;
    transaction.recentBlockhash = latest.blockhash;
    transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
    this.validatePrograms(transaction);
    return transaction;
  }

  async simulate(transaction) {
    const response = await this.connection.simulateTransaction(transaction);
    if (response.value.err) {
      const logs = tailLogs(response.value.logs).join("\n");
      throw new Error(`Transaction simulation failed: ${JSON.stringify(response.value.err)}${logs ? `\n${logs}` : ""}`);
    }
    return response.value;
  }

  validateSignedTransaction(transaction, intent) {
    if (transaction.feePayer?.toBase58() !== this.config.walletAddress) throw new Error("Signed transaction fee payer does not match the configured maker wallet.");
    if (!intent.unsignedTx) throw new Error("The saved intent has no unsigned transaction to compare.");
    const expected = Transaction.from(Buffer.from(intent.unsignedTx, "base64"));
    if (!transaction.serializeMessage().equals(expected.serializeMessage())) {
      throw new Error("Signed transaction message does not exactly match the approved intent.");
    }
    this.validatePrograms(transaction);
    const allowedFromIntent = new Set(intent.summary.allowedPrograms);
    const actual = new Set(transaction.instructions.map((instruction) => instruction.programId.toBase58()));
    for (const program of actual) if (!allowedFromIntent.has(program)) throw new Error(`Signed transaction added an unexpected program: ${program}`);
    if (!transaction.signature) throw new Error("Transaction is not signed by its fee payer.");
  }

  validatePrograms(transaction) {
    for (const instruction of transaction.instructions) {
      const program = instruction.programId.toBase58();
      if (!ALLOWED_PROGRAMS.has(program)) throw new Error(`Transaction contains a non-whitelisted program: ${program}`);
    }
  }
}

function preparedTransaction(transaction) {
  const validity = transactionValidity(transaction);
  return {
    unsignedTx: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    ...validity,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function transactionValidity(transaction) {
  return { blockhash: transaction.recentBlockhash, lastValidBlockHeight: transaction.lastValidBlockHeight };
}

function programsFor(transaction) {
  return [...new Set(transaction.instructions.map((instruction) => instruction.programId.toBase58()))];
}

function tokenBalance(wallet, symbol) {
  return BigInt(wallet?.tokenAccounts?.find((account) => account.symbol === symbol)?.amountRaw ?? "0");
}

function executionSummary(execution) {
  return {
    inputSymbol: execution.inputSymbol,
    outputSymbol: execution.outputSymbol,
    amountInRaw: execution.amountInRaw,
    amountOutRaw: execution.amountOutRaw,
    notionalUsdtRaw: execution.notionalUsdtRaw,
    realizedPnlUsdtRaw: execution.realizedPnlUsdtRaw,
    solFeeRaw: execution.solFeeRaw,
  };
}

function redactRouteLeg(leg) { return { ...leg, unsignedTx: leg.unsignedTx ? "available" : null }; }

function normalizeAction(action, config) {
  if (!action || action.kind !== "swap") throw Object.assign(new Error("Only swap intents are supported."), { statusCode: 400 });
  if (!config.pools[action.pool]) throw Object.assign(new Error("Unsupported pool."), { statusCode: 400 });
  const poolConfig = config.pools[action.pool];
  const pair = [poolConfig.tokenX, poolConfig.tokenY];
  if (!pair.includes(action.inputSymbol)) throw Object.assign(new Error("Input token is not in the selected pool."), { statusCode: 400 });
  const outputSymbol = pair.find((symbol) => symbol !== action.inputSymbol);
  if (!/^\d+$/.test(String(action.amountInRaw)) || BigInt(action.amountInRaw) <= 0n) throw Object.assign(new Error("amountInRaw must be a positive base-unit integer."), { statusCode: 400 });
  const slippageBps = Number(action.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > config.risk.maxSlippageBps) throw Object.assign(new Error("slippageBps is outside the configured range."), { statusCode: 400 });
  tokenByMint(TOKENS[action.inputSymbol].mint);
  return { kind: "swap", pool: action.pool, inputSymbol: action.inputSymbol, outputSymbol, amountInRaw: String(action.amountInRaw), slippageBps };
}

function normalizeRouteAction(action, config) {
  if (!action || action.kind !== "route-swap") throw Object.assign(new Error("kind must equal route-swap."), { statusCode: 400 });
  if (!["BG", "USDT"].includes(action.inputSymbol)) throw Object.assign(new Error("Route inputSymbol must be BG or USDT."), { statusCode: 400 });
  if (!/^\d+$/.test(String(action.amountInRaw)) || BigInt(action.amountInRaw) <= 0n) throw Object.assign(new Error("amountInRaw must be a positive base-unit integer."), { statusCode: 400 });
  const slippageBps = Number(action.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > config.risk.maxSlippageBps) throw Object.assign(new Error("slippageBps is outside the configured range."), { statusCode: 400 });
  return { kind: "route-swap", inputSymbol: action.inputSymbol, amountInRaw: String(action.amountInRaw), slippageBps };
}

export function routePlan(inputSymbol) {
  if (inputSymbol === "USDT") return [
    { pool: "antfunUsdt", inputSymbol: "USDT", outputSymbol: "ANTFUN" },
    { pool: "bgAntfun", inputSymbol: "ANTFUN", outputSymbol: "BG" },
  ];
  if (inputSymbol === "BG") return [
    { pool: "bgAntfun", inputSymbol: "BG", outputSymbol: "ANTFUN" },
    { pool: "antfunUsdt", inputSymbol: "ANTFUN", outputSymbol: "USDT" },
  ];
  throw new Error("Route inputSymbol must be BG or USDT.");
}

function tailLogs(logs) { return Array.isArray(logs) ? logs.slice(-30) : []; }
