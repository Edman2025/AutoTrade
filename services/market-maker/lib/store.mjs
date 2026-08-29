import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { jsonSafe } from "./json.mjs";

export class MakerStore {
  constructor(path) {
    const absolute = path === ":memory:" ? path : resolve(path);
    if (absolute !== ":memory:") mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    const previousUmask = process.umask(0o077);
    try {
      this.db = new DatabaseSync(absolute);
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      this.migrate();
      if (absolute !== ":memory:") {
        for (const file of [absolute, `${absolute}-wal`, `${absolute}-shm`]) {
          try { chmodSync(file, 0o600); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
      }
    } finally {
      process.umask(previousUmask);
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        slot INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS snapshots_captured_at ON snapshots(captured_at DESC);
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        state TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        unsigned_tx TEXT,
        approved_at TEXT,
        executed_at TEXT,
        signature TEXT,
        failure TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS control_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        paused INTEGER NOT NULL,
        pause_reason TEXT,
        consecutive_failures INTEGER NOT NULL,
        last_execution_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO control_state(singleton, paused, pause_reason, consecutive_failures, updated_at)
      VALUES(1, 1, 'Starts paused until an operator explicitly resumes it.', 0, datetime('now'));
      CREATE TABLE IF NOT EXISTS route_legs (
        intent_id TEXT NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
        leg_index INTEGER NOT NULL,
        pool TEXT NOT NULL,
        input_symbol TEXT NOT NULL,
        output_symbol TEXT NOT NULL,
        amount_in_raw TEXT NOT NULL,
        min_out_raw TEXT NOT NULL,
        state TEXT NOT NULL,
        unsigned_tx TEXT,
        blockhash TEXT,
        last_valid_block_height INTEGER,
        expires_at TEXT,
        signature TEXT,
        submitted_at TEXT,
        confirmed_at TEXT,
        balance_before TEXT,
        balance_after TEXT,
        failure TEXT,
        PRIMARY KEY(intent_id, leg_index)
      );
      CREATE INDEX IF NOT EXISTS route_legs_state ON route_legs(intent_id, state, leg_index);
      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_id TEXT NOT NULL UNIQUE REFERENCES intents(id),
        executed_at TEXT NOT NULL,
        signature TEXT NOT NULL,
        input_symbol TEXT NOT NULL,
        output_symbol TEXT NOT NULL,
        amount_in_raw TEXT NOT NULL,
        amount_out_raw TEXT NOT NULL,
        notional_usdt_raw TEXT NOT NULL,
        realized_pnl_usdt_raw TEXT NOT NULL,
        sol_fee_raw TEXT NOT NULL,
        balance_before TEXT NOT NULL,
        balance_after TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS executions_executed_at ON executions(executed_at);
      CREATE TABLE IF NOT EXISTS intent_submissions (
        intent_id TEXT PRIMARY KEY REFERENCES intents(id) ON DELETE CASCADE,
        signature TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        balance_before TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cost_basis (
        symbol TEXT PRIMARY KEY,
        quantity_raw TEXT NOT NULL,
        cost_usdt_raw TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS risk_days (
        day TEXT PRIMARY KEY,
        opening_equity_usdt_raw TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close() { this.db.close(); }

  saveSnapshot(snapshot) {
    this.db.prepare("INSERT INTO snapshots(captured_at,slot,payload) VALUES(?,?,?)")
      .run(snapshot.capturedAt, snapshot.slot, JSON.stringify(jsonSafe(snapshot)));
  }

  latestSnapshot() {
    const row = this.db.prepare("SELECT payload FROM snapshots ORDER BY id DESC LIMIT 1").get();
    return row ? JSON.parse(row.payload) : null;
  }

  createIntent({ kind, summary, unsignedTx = null, ttlMs = 60_000 }) {
    const now = new Date();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + ttlMs);
    this.db.prepare("INSERT INTO intents(id,created_at,expires_at,state,kind,summary,unsigned_tx) VALUES(?,?,?,?,?,?,?)")
      .run(id, now.toISOString(), expiresAt.toISOString(), "prepared", kind, JSON.stringify(jsonSafe(summary)), unsignedTx);
    this.audit("system", "intent.prepared", { id, kind, expiresAt: expiresAt.toISOString(), summary });
    return this.getIntent(id);
  }

  createRouteIntent({ summary, legs, ttlMs = 15 * 60_000 }) {
    if (!Array.isArray(legs) || legs.length < 2) throw new Error("A route intent requires at least two legs.");
    const intent = this.createIntent({ kind: "route-swap", summary, unsignedTx: legs[0].unsignedTx, ttlMs });
    const insert = this.db.prepare(`INSERT INTO route_legs(
      intent_id,leg_index,pool,input_symbol,output_symbol,amount_in_raw,min_out_raw,state,unsigned_tx,blockhash,last_valid_block_height,expires_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      legs.forEach((leg, index) => insert.run(
        intent.id, index, leg.pool, leg.inputSymbol, leg.outputSymbol, String(leg.amountInRaw), String(leg.minOutRaw),
        index === 0 ? "prepared" : "waiting", leg.unsignedTx ?? null, leg.blockhash ?? null,
        leg.lastValidBlockHeight ?? null, leg.expiresAt ?? null,
      ));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.prepare("DELETE FROM intents WHERE id=?").run(intent.id);
      throw error;
    }
    this.audit("system", "route.prepared", { id: intent.id, legs: legs.map((leg, index) => ({ index, pool: leg.pool, state: index === 0 ? "prepared" : "waiting" })) });
    return this.getIntent(intent.id);
  }

  getIntent(id) {
    const row = this.db.prepare("SELECT * FROM intents WHERE id=?").get(id);
    return row ? deserializeIntent(row) : null;
  }

  listIntents(limit = 100) {
    return this.db.prepare("SELECT * FROM intents ORDER BY created_at DESC LIMIT ?").all(limit).map(deserializeIntent);
  }

  listExecutedIntentsSince(since) {
    return this.db.prepare("SELECT * FROM intents WHERE state='executed' AND executed_at>=? ORDER BY executed_at ASC")
      .all(since).map(deserializeIntent);
  }

  listExecutionsSince(since) {
    return this.db.prepare("SELECT * FROM executions WHERE executed_at>=? ORDER BY executed_at ASC").all(since).map(deserializeExecution);
  }

  getExecution(intentId) {
    const row = this.db.prepare("SELECT * FROM executions WHERE intent_id=?").get(intentId);
    return row ? deserializeExecution(row) : null;
  }

  getRouteLegs(intentId, { includeUnsigned = false } = {}) {
    return this.db.prepare("SELECT * FROM route_legs WHERE intent_id=? ORDER BY leg_index ASC").all(intentId)
      .map((row) => deserializeRouteLeg(row, includeUnsigned));
  }

  getActiveRouteLeg(intentId, options) {
    return this.getRouteLegs(intentId, options).find((leg) => leg.state !== "confirmed") ?? null;
  }

  prepareRouteLeg(intentId, legIndex, prepared) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE route_legs SET
      amount_in_raw=?,min_out_raw=?,state='prepared',unsigned_tx=?,blockhash=?,last_valid_block_height=?,expires_at=?,signature=NULL,
      submitted_at=NULL,confirmed_at=NULL,balance_before=NULL,balance_after=NULL,failure=NULL
      WHERE intent_id=? AND leg_index=? AND state IN ('waiting','failed','expired')`)
      .run(String(prepared.amountInRaw), String(prepared.minOutRaw), prepared.unsignedTx, prepared.blockhash, prepared.lastValidBlockHeight, prepared.expiresAt, intentId, legIndex);
    if (result.changes !== 1) throw Object.assign(new Error("Route leg is not recoverable from its current state."), { statusCode: 409 });
    this.db.prepare("UPDATE intents SET unsigned_tx=?,expires_at=?,state='approved',failure=NULL WHERE id=?")
      .run(prepared.unsignedTx, prepared.expiresAt, intentId);
    this.audit("executor", "route.leg_prepared", { id: intentId, legIndex, expiresAt: prepared.expiresAt, preparedAt: now });
    return this.getRouteLegs(intentId).find((leg) => leg.index === legIndex);
  }

  markRouteLegSubmitted(intentId, legIndex, signature, balanceBefore) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE route_legs SET state='submitted',signature=?,submitted_at=?,balance_before=?,failure=NULL
      WHERE intent_id=? AND leg_index=? AND state='prepared'`)
      .run(signature, now, JSON.stringify(jsonSafe(balanceBefore)), intentId, legIndex);
    if (result.changes !== 1) throw Object.assign(new Error("Route leg is not prepared."), { statusCode: 409 });
    this.db.prepare("UPDATE intents SET state='executing',signature=? WHERE id=?").run(signature, intentId);
    this.audit("executor", "route.leg_submitted", { id: intentId, legIndex, signature });
  }

  markRouteLegConfirmed(intentId, legIndex, balanceAfter) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE route_legs SET state='confirmed',confirmed_at=?,balance_after=?,failure=NULL
      WHERE intent_id=? AND leg_index=? AND state='submitted'`)
      .run(now, JSON.stringify(jsonSafe(balanceAfter)), intentId, legIndex);
    if (result.changes !== 1) throw Object.assign(new Error("Route leg was not submitted."), { statusCode: 409 });
    this.audit("executor", "route.leg_confirmed", { id: intentId, legIndex });
  }

  markRouteLegFailed(intentId, legIndex, error) {
    const message = error instanceof Error ? error.message : String(error);
    this.db.prepare("UPDATE route_legs SET state='failed',failure=? WHERE intent_id=? AND leg_index=? AND state!='confirmed'")
      .run(message, intentId, legIndex);
    this.db.prepare("UPDATE intents SET state='route_recovery',failure=? WHERE id=?").run(message, intentId);
    this.db.prepare("UPDATE control_state SET consecutive_failures=consecutive_failures+1,updated_at=? WHERE singleton=1")
      .run(new Date().toISOString());
    this.audit("executor", "route.leg_failed", { id: intentId, legIndex, error: message });
  }

  markIntentSubmitted(id, signature, balanceBefore) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare("UPDATE intents SET state='confirming',signature=?,failure=NULL WHERE id=? AND state='approved'")
        .run(signature, id);
      if (result.changes !== 1) throw Object.assign(new Error("Intent is not approved."), { statusCode: 409 });
      this.db.prepare("INSERT INTO intent_submissions(intent_id,signature,submitted_at,balance_before) VALUES(?,?,?,?)")
        .run(id, signature, now, JSON.stringify(jsonSafe(balanceBefore)));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.audit("executor", "intent.submitted", { id, signature });
  }

  getIntentSubmission(id) {
    const row = this.db.prepare("SELECT * FROM intent_submissions WHERE intent_id=?").get(id);
    return row ? {
      intentId: row.intent_id,
      signature: row.signature,
      submittedAt: row.submitted_at,
      balanceBefore: JSON.parse(row.balance_before),
    } : null;
  }

  markIntentConfirmationPending(id, error) {
    const message = error instanceof Error ? error.message : String(error);
    this.db.prepare("UPDATE intents SET state='confirming',failure=? WHERE id=?").run(message, id);
    this.audit("executor", "intent.confirmation_pending", { id, error: message });
  }

  approveIntent(id, actor = "operator") {
    const intent = this.getIntent(id);
    if (!intent) throw Object.assign(new Error("Intent not found."), { statusCode: 404 });
    if (intent.state !== "prepared") throw Object.assign(new Error(`Intent is ${intent.state}, not prepared.`), { statusCode: 409 });
    if (Date.parse(intent.expiresAt) <= Date.now()) {
      this.db.prepare("UPDATE intents SET state='expired' WHERE id=?").run(id);
      throw Object.assign(new Error("Intent expired; request a fresh quote."), { statusCode: 409 });
    }
    this.db.prepare("UPDATE intents SET state='approved', approved_at=? WHERE id=?").run(new Date().toISOString(), id);
    this.audit(actor, "intent.approved", { id });
    return this.getIntent(id);
  }

  markExecuted(id, signature, execution = null) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (execution) {
        this.db.prepare(`INSERT INTO executions(
          intent_id,executed_at,signature,input_symbol,output_symbol,amount_in_raw,amount_out_raw,notional_usdt_raw,
          realized_pnl_usdt_raw,sol_fee_raw,balance_before,balance_after
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, now, signature, execution.inputSymbol, execution.outputSymbol, String(execution.amountInRaw), String(execution.amountOutRaw),
            String(execution.notionalUsdtRaw), String(execution.realizedPnlUsdtRaw), String(execution.solFeeRaw ?? "0"),
            JSON.stringify(jsonSafe(execution.balanceBefore)), JSON.stringify(jsonSafe(execution.balanceAfter)));
        for (const basis of execution.costBasisUpdates ?? []) {
          this.db.prepare(`INSERT INTO cost_basis(symbol,quantity_raw,cost_usdt_raw,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(symbol) DO UPDATE SET quantity_raw=excluded.quantity_raw,cost_usdt_raw=excluded.cost_usdt_raw,updated_at=excluded.updated_at`)
            .run(basis.symbol, String(basis.quantityRaw), String(basis.costUsdtRaw), now);
        }
      }
      this.db.prepare("UPDATE intents SET state='executed', executed_at=?, signature=?,unsigned_tx=NULL,failure=NULL WHERE id=?")
        .run(now, signature, id);
      this.db.prepare("UPDATE control_state SET consecutive_failures=0,last_execution_at=?,updated_at=? WHERE singleton=1")
        .run(now, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.audit("executor", "intent.executed", { id, signature });
  }

  markFailed(id, error) {
    const message = error instanceof Error ? error.message : String(error);
    this.db.prepare("UPDATE intents SET state='failed', failure=? WHERE id=?").run(message, id);
    this.db.prepare("UPDATE control_state SET consecutive_failures=consecutive_failures+1,updated_at=? WHERE singleton=1")
      .run(new Date().toISOString());
    this.audit("executor", "intent.failed", { id, error: message });
  }

  controlState() {
    const row = this.db.prepare("SELECT * FROM control_state WHERE singleton=1").get();
    return {
      paused: Boolean(row.paused),
      pauseReason: row.pause_reason,
      consecutiveFailures: row.consecutive_failures,
      lastExecutionAt: row.last_execution_at,
      updatedAt: row.updated_at,
    };
  }

  setPaused(paused, reason, actor = "operator") {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE control_state SET paused=?,pause_reason=?,updated_at=? WHERE singleton=1")
      .run(paused ? 1 : 0, paused ? reason || "Paused by operator." : null, now);
    this.audit(actor, paused ? "control.paused" : "control.resumed", { reason: reason || null });
    return this.controlState();
  }

  audit(actor, action, payload = {}) {
    this.db.prepare("INSERT INTO audit_events(created_at,actor,action,payload) VALUES(?,?,?,?)")
      .run(new Date().toISOString(), actor, action, JSON.stringify(jsonSafe(payload)));
  }

  listAudit(limit = 200) {
    return this.db.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?").all(limit).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actor: row.actor,
      action: row.action,
      payload: JSON.parse(row.payload),
    }));
  }

  ensureRiskDay(day, openingEquityUsdtRaw) {
    this.db.prepare("INSERT OR IGNORE INTO risk_days(day,opening_equity_usdt_raw,created_at) VALUES(?,?,?)")
      .run(day, String(openingEquityUsdtRaw), new Date().toISOString());
    const row = this.db.prepare("SELECT * FROM risk_days WHERE day=?").get(day);
    return { day: row.day, openingEquityUsdtRaw: row.opening_equity_usdt_raw, createdAt: row.created_at };
  }

  dailyAccountingBetween(start, end) {
    const rows = this.db.prepare("SELECT notional_usdt_raw,realized_pnl_usdt_raw FROM executions WHERE executed_at BETWEEN ? AND ?").all(start, end);
    return rows.reduce((total, row) => ({
      notionalUsdtRaw: total.notionalUsdtRaw + BigInt(row.notional_usdt_raw),
      realizedPnlUsdtRaw: total.realizedPnlUsdtRaw + BigInt(row.realized_pnl_usdt_raw),
      executions: total.executions + 1,
    }), { notionalUsdtRaw: 0n, realizedPnlUsdtRaw: 0n, executions: 0 });
  }

  getCostBasis(symbol) {
    const row = this.db.prepare("SELECT * FROM cost_basis WHERE symbol=?").get(symbol);
    return row ? { symbol: row.symbol, quantityRaw: row.quantity_raw, costUsdtRaw: row.cost_usdt_raw, updatedAt: row.updated_at } : null;
  }

  listCostBasis() {
    return this.db.prepare("SELECT * FROM cost_basis ORDER BY symbol").all().map((row) => ({
      symbol: row.symbol, quantityRaw: row.quantity_raw, costUsdtRaw: row.cost_usdt_raw, updatedAt: row.updated_at,
    }));
  }

  reconcileCostBasis(symbol, quantityRaw, costUsdtRaw, reason = "chain-balance-baseline") {
    const now = new Date().toISOString();
    const previous = this.getCostBasis(symbol);
    this.db.prepare(`INSERT INTO cost_basis(symbol,quantity_raw,cost_usdt_raw,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(symbol) DO UPDATE SET quantity_raw=excluded.quantity_raw,cost_usdt_raw=excluded.cost_usdt_raw,updated_at=excluded.updated_at`)
      .run(symbol, String(quantityRaw), String(costUsdtRaw), now);
    this.audit("accounting", "cost_basis.reconciled", { symbol, previous, quantityRaw: String(quantityRaw), costUsdtRaw: String(costUsdtRaw), reason });
    return this.getCostBasis(symbol);
  }
}

function deserializeIntent(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    state: row.state,
    kind: row.kind,
    summary: JSON.parse(row.summary),
    unsignedTx: row.unsigned_tx,
    approvedAt: row.approved_at,
    executedAt: row.executed_at,
    signature: row.signature,
    failure: row.failure,
  };
}

function deserializeRouteLeg(row, includeUnsigned) {
  return {
    index: row.leg_index,
    pool: row.pool,
    inputSymbol: row.input_symbol,
    outputSymbol: row.output_symbol,
    amountInRaw: row.amount_in_raw,
    minOutRaw: row.min_out_raw,
    state: row.state,
    unsignedTx: includeUnsigned ? row.unsigned_tx : row.unsigned_tx ? "available" : null,
    blockhash: row.blockhash,
    lastValidBlockHeight: row.last_valid_block_height,
    expiresAt: row.expires_at,
    signature: row.signature,
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    balanceBefore: row.balance_before ? JSON.parse(row.balance_before) : null,
    balanceAfter: row.balance_after ? JSON.parse(row.balance_after) : null,
    failure: row.failure,
  };
}

function deserializeExecution(row) {
  return {
    id: row.id,
    intentId: row.intent_id,
    executedAt: row.executed_at,
    signature: row.signature,
    inputSymbol: row.input_symbol,
    outputSymbol: row.output_symbol,
    amountInRaw: row.amount_in_raw,
    amountOutRaw: row.amount_out_raw,
    notionalUsdtRaw: row.notional_usdt_raw,
    realizedPnlUsdtRaw: row.realized_pnl_usdt_raw,
    solFeeRaw: row.sol_fee_raw,
    balanceBefore: JSON.parse(row.balance_before),
    balanceAfter: JSON.parse(row.balance_after),
  };
}
