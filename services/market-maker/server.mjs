#!/usr/bin/env node
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { URL } from "node:url";
import { loadConfig, publicConfig } from "./lib/config.mjs";
import { MarketDataService } from "./lib/market-data.mjs";
import { MakerStore } from "./lib/store.mjs";
import { RiskEngine } from "./lib/risk-engine.mjs";
import { TransactionExecutor } from "./lib/executor.mjs";
import { VolumeAnalyticsService } from "./lib/volume-analytics.mjs";
import { RiskAccountingService } from "./lib/risk-accounting.mjs";
import { jsonSafe, parseJsonBody } from "./lib/json.mjs";

const config = loadConfig();
const store = new MakerStore(config.databasePath);
const marketData = new MarketDataService(config);
const riskEngine = new RiskEngine(config, store);
const riskAccounting = new RiskAccountingService(config, store);
const executor = new TransactionExecutor(config, marketData, riskEngine, store, undefined, riskAccounting);
const volumeAnalytics = new VolumeAnalyticsService(config, store);
const sseClients = new Set();
const rateBuckets = new Map();
const publicCaches = new Map();
let latest = store.latestSnapshot();
let refreshInFlight = null;

async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = marketData.capture().then((snapshot) => {
    latest = snapshot;
    store.saveSnapshot(snapshot);
    broadcast("snapshot", snapshot);
    return snapshot;
  }).catch((error) => {
    const payload = { capturedAt: new Date().toISOString(), error: error.message };
    store.audit("market-data", "snapshot.failed", payload);
    broadcast("error", payload);
    throw error;
  }).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

const server = createServer(async (request, response) => {
  const started = Date.now();
  try {
    applyHeaders(request, response);
    if (request.method === "OPTIONS") return end(response, 204);
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      const control = store.controlState();
      const ready = config.mode === "observe" ? snapshotReady() : executionReady();
      return json(response, 200, {
        status: ready ? "ready" : "degraded",
        mode: config.mode,
        network: config.network,
        latestSnapshotAt: latest?.capturedAt ?? null,
        topologyReady: snapshotReady(),
        snapshotFresh: snapshotFresh(),
        paused: control.paused,
        pauseReason: control.pauseReason,
        consecutiveFailures: control.consecutiveFailures,
        lastExecutionAt: control.lastExecutionAt,
        privateRpcReady: config.privateRpcVerified,
        publicRpcRiskAccepted: config.publicRpcRiskAccepted,
        rpcPolicyReady: config.rpcPolicyVerified,
        rpcPolicyMode: config.rpcPolicyMode,
        walletIdentityVerified: Boolean(latest?.wallet?.addressVerified),
        accountingReady: Boolean(latest?.wallet && latest?.impliedPrices),
        solReserveReady: solReserveReady(),
        executionReady: executionReady(),
      });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/config") return json(response, 200, publicConfig(config));
    if (request.method === "GET" && url.pathname === "/api/v1/snapshot") return json(response, 200, latest ?? await refresh());
    if (request.method === "GET" && url.pathname === "/api/v1/audit") return json(response, 200, { events: store.listAudit(boundedLimit(url, 200)) });
    if (request.method === "GET" && url.pathname === "/api/v1/intents") return json(response, 200, { intents: store.listIntents(boundedLimit(url, 100)).map(redactIntent) });
    if (request.method === "GET" && url.pathname === "/api/v1/volume") return json(response, 200, await volumeAnalytics.read(boundedDays(url, 7)));
    if (request.method === "GET" && url.pathname === "/api/v1/accounting") return json(response, 200, riskAccounting.read(latest));
    if (request.method === "GET" && url.pathname === "/api/public/v1/token-intelligence") {
      requireRate(request, "public-token-intelligence", 30, 60_000);
      return json(response, 200, await cachedPublic("token-intelligence:BG", 60_000, () => marketData.tokenIntelligence("BG")));
    }
    if (request.method === "GET" && url.pathname === "/api/public/v1/execution-infrastructure") {
      requireRate(request, "public-execution-infrastructure", 60, 60_000);
      return json(response, 200, await cachedPublic("execution-infrastructure", 15_000, () => marketData.executionInfrastructure()));
    }
    if (request.method === "GET" && url.pathname === "/api/v1/events") return openSse(response);
    if (request.method === "POST" && url.pathname === "/api/public/v1/route-quotes") {
      requireRate(request, "public-route-quote", 20, 60_000);
      const body = await parseJsonBody(request);
      if (body.kind !== "route-swap") throw Object.assign(new Error("The public quote endpoint supports the fixed two-pool route only."), { statusCode: 400 });
      return json(response, 200, await executor.routeQuote(body));
    }
    if (request.method === "POST" && url.pathname === "/api/public/v1/batch-route-quotes") {
      requireRate(request, "public-batch-route-quote", 8, 60_000);
      const body = await parseJsonBody(request, 64_000);
      return json(response, 200, await quoteBatch(body));
    }
    if (request.method === "POST" && url.pathname === "/api/v1/quotes") {
      requireOperatorRead(request);
      requireRate(request, "operator-quote", 60, 60_000);
      const body = await parseJsonBody(request);
      return json(response, 200, await executor.quote(body));
    }

    requireAdmin(request);
    if (request.method === "POST" && url.pathname === "/api/v1/control/pause") {
      const body = await parseJsonBody(request);
      return json(response, 200, store.setPaused(true, body.reason || "Paused by operator."));
    }
    if (request.method === "POST" && url.pathname === "/api/v1/control/resume") {
      requireConfirmation(request, "RESUME_MAINNET");
      if (!executionReady()) throw Object.assign(new Error("Cannot resume until topology, wallet identity, accounting prices, and private RPC policy are all verified."), { statusCode: 409 });
      return json(response, 200, store.setPaused(false, null));
    }
    if (request.method === "POST" && url.pathname === "/api/v1/intents") {
      const body = await parseJsonBody(request);
      return json(response, 201, await executor.prepare(body));
    }
    const unsignedMatch = url.pathname.match(/^\/api\/v1\/intents\/([^/]+)\/unsigned$/);
    if (request.method === "GET" && unsignedMatch) {
      const intent = store.getIntent(unsignedMatch[1]);
      if (!intent) throw Object.assign(new Error("Intent not found."), { statusCode: 404 });
      const activeLeg = intent.kind === "route-swap" ? store.getActiveRouteLeg(intent.id, { includeUnsigned: true }) : null;
      const unsignedTx = activeLeg?.unsignedTx ?? intent.unsignedTx;
      const expiresAt = activeLeg?.expiresAt ?? intent.expiresAt;
      if (!unsignedTx) throw Object.assign(new Error("Intent has no unsigned transaction."), { statusCode: 409 });
      if (Date.parse(expiresAt) <= Date.now()) throw Object.assign(new Error("Intent expired; request a fresh transaction."), { statusCode: 409 });
      return json(response, 200, { id: intent.id, state: intent.state, expiresAt, unsignedTx, summary: intent.summary, routeLeg: activeLeg ? redactRouteLeg(activeLeg) : null });
    }
    const approveMatch = url.pathname.match(/^\/api\/v1\/intents\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveMatch) {
      const id = approveMatch[1];
      requireConfirmation(request, `APPROVE_${id}`);
      return json(response, 200, redactIntent(store.approveIntent(id)));
    }
    const submitMatch = url.pathname.match(/^\/api\/v1\/intents\/([^/]+)\/submit-signed$/);
    if (request.method === "POST" && submitMatch) {
      const id = submitMatch[1];
      requireConfirmation(request, `EXECUTE_${id}`);
      const body = await parseJsonBody(request, 128_000);
      if (typeof body.signedTransactionBase64 !== "string") throw Object.assign(new Error("signedTransactionBase64 is required."), { statusCode: 400 });
      return json(response, 200, await executor.submitSigned(id, body.signedTransactionBase64));
    }
    const resumeRouteMatch = url.pathname.match(/^\/api\/v1\/intents\/([^/]+)\/resume-route$/);
    if (request.method === "POST" && resumeRouteMatch) {
      const id = resumeRouteMatch[1];
      requireConfirmation(request, `RESUME_ROUTE_${id}`);
      return json(response, 200, await executor.resumeRoute(id));
    }
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    store.audit("api", "request.failed", { method: request.method, path: request.url, error: error.message, durationMs: Date.now() - started });
    return json(response, error.statusCode ?? 500, { error: error.message, details: error.details ?? null });
  }
});

server.listen(config.port, config.host, async () => {
  store.audit("system", "server.started", { host: config.host, port: config.port, mode: config.mode, network: config.network });
  console.log(JSON.stringify({ status: "listening", url: `http://${config.host}:${config.port}`, mode: config.mode, network: config.network }));
  await refresh().catch((error) => console.error(JSON.stringify({ status: "degraded", error: error.message })));
});

const timer = setInterval(() => refresh().catch(() => {}), config.snapshotIntervalMs);
timer.unref();
const sseHeartbeat = setInterval(() => {
  for (const client of sseClients) client.write(`: ping ${Date.now()}\n\n`);
}, config.sseHeartbeatMs);
sseHeartbeat.unref();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  clearInterval(timer);
  clearInterval(sseHeartbeat);
  for (const client of sseClients) client.end();
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections?.();
  const forcedExit = setTimeout(() => {
    server.closeAllConnections?.();
    store.close();
    process.exit(0);
  }, 1_000);
  forcedExit.unref();
});

function requireAdmin(request) {
  requireSecureOperatorTransport(request);
  if (!config.adminToken || config.mode === "observe") throw Object.assign(new Error("Mutation endpoints are disabled in observe mode."), { statusCode: 403 });
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(supplied, config.adminToken)) throw Object.assign(new Error("Unauthorized."), { statusCode: 401 });
}

function requireOperatorRead(request) {
  if (config.mode === "observe") return;
  requireSecureOperatorTransport(request);
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (!config.adminToken || !safeEqual(supplied, config.adminToken)) throw Object.assign(new Error("Unauthorized."), { statusCode: 401 });
}

function requireSecureOperatorTransport(request) {
  const forwarded = String(request.headers["x-forwarded-proto"] ?? "").toLowerCase();
  if (forwarded && forwarded !== "https") {
    throw Object.assign(new Error("Operator authentication is disabled over plaintext reverse-proxy transport."), { statusCode: 426 });
  }
}

function requireConfirmation(request, expected) {
  if (!safeEqual(request.headers["x-maker-confirm"] ?? "", expected)) throw Object.assign(new Error(`Confirmation header must equal ${expected}.`), { statusCode: 412 });
}

function safeEqual(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function applyHeaders(request, response) {
  const origin = request.headers.origin;
  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const effectiveOrigin = `${forwardedProto}://${request.headers.host ?? "localhost"}`;
  const originAllowed = !origin || config.allowedOrigins.includes(origin) || origin === effectiveOrigin;
  if (!originAllowed) throw Object.assign(new Error("Origin is not allowed."), { statusCode: 403 });
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Maker-Confirm");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

function json(response, status, payload) {
  const body = JSON.stringify(jsonSafe(payload));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function end(response, status) { response.writeHead(status); response.end(); }

function openSse(response) {
  response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  response.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
  sseClients.add(response);
  response.on("close", () => sseClients.delete(response));
}

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(jsonSafe(payload))}\n\n`;
  for (const client of sseClients) client.write(data);
}

function boundedLimit(url, fallback) {
  const value = Number(url.searchParams.get("limit") ?? fallback);
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 500)) : fallback;
}

function boundedDays(url, fallback) {
  const value = Number(url.searchParams.get("days") ?? fallback);
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 30)) : fallback;
}

function snapshotFresh() {
  if (!latest?.capturedAt) return false;
  const age = Date.now() - Date.parse(latest.capturedAt);
  return Number.isFinite(age) && age >= 0 && age <= Math.max(30_000, config.snapshotIntervalMs * 3);
}

function snapshotReady() { return Boolean(latest?.topologyReady && snapshotFresh()); }

function executionReady() {
  if (!snapshotReady()) return false;
  if (config.mode === "observe") return true;
  return Boolean(config.rpcPolicyVerified && latest?.wallet?.addressVerified && latest?.impliedPrices && solReserveReady());
}

function solReserveReady() {
  try { return BigInt(latest?.wallet?.solRaw ?? "0") >= config.risk.minSolReserveRaw; }
  catch { return false; }
}

function redactIntent(intent) {
  if (!intent) return null;
  const routeLegs = intent.kind === "route-swap" ? store.getRouteLegs(intent.id) : undefined;
  return { ...intent, unsignedTx: intent.unsignedTx ? "available" : null, routeLegs };
}

function redactRouteLeg(leg) { return { ...leg, unsignedTx: leg.unsignedTx ? "available" : null }; }

function requireRate(request, group, limit, windowMs) {
  const key = `${group}:${request.socket.remoteAddress ?? "unknown"}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw Object.assign(new Error("Rate limit exceeded."), { statusCode: 429 });
  if (rateBuckets.size > 2_000) {
    for (const [entry, value] of rateBuckets) if (now - value.startedAt >= windowMs) rateBuckets.delete(entry);
  }
}

async function cachedPublic(key, ttlMs, load) {
  const existing = publicCaches.get(key);
  if (existing && Date.now() - existing.createdAt < ttlMs) return existing.value;
  if (existing?.promise) return existing.promise;
  const promise = load().then((value) => {
    publicCaches.set(key, { createdAt: Date.now(), value });
    return value;
  }).catch((error) => {
    publicCaches.delete(key);
    throw error;
  });
  publicCaches.set(key, { createdAt: Date.now(), promise });
  return promise;
}

async function quoteBatch(body) {
  if (body?.kind !== "batch-route-quotes" || !Array.isArray(body.actions)) {
    throw Object.assign(new Error("kind=batch-route-quotes and actions[] are required."), { statusCode: 400 });
  }
  if (body.actions.length < 1 || body.actions.length > 12) {
    throw Object.assign(new Error("A batch must contain between 1 and 12 route actions."), { statusCode: 400 });
  }
  const riskSnapshot = snapshotFresh() && latest ? latest : await refresh();
  const walletSolRaw = riskSnapshot?.wallet?.solRaw == null ? null : BigInt(riskSnapshot.wallet.solRaw);
  const results = [];
  for (let index = 0; index < body.actions.length; index += 1) {
    const action = body.actions[index];
    const id = typeof action?.id === "string" && action.id.length <= 64 ? action.id : `row-${index + 1}`;
    try {
      if (action?.kind !== "route-swap") throw new Error("Only the fixed two-pool route is supported.");
      if (!["BG", "USDT"].includes(action.inputSymbol)) throw new Error("inputSymbol must be BG or USDT.");
      if (!/^\d+$/.test(String(action.amountInRaw ?? "")) || BigInt(action.amountInRaw) <= 0n) throw new Error("amountInRaw must be a positive integer.");
      const quote = await executor.routeQuote(action, { snapshot: riskSnapshot, walletSolRaw });
      results.push({ id, ok: true, quote });
    } catch (error) {
      results.push({ id, ok: false, error: error.message, details: error.details ?? null });
    }
  }
  return {
    quotedAt: new Date().toISOString(),
    atomic: false,
    signingMode: "external",
    broadcastEnabled: false,
    route: "BG↔ANTFUN↔USDT",
    total: results.length,
    passed: results.filter((item) => item.ok && item.quote?.risk?.passed).length,
    failed: results.filter((item) => !item.ok || !item.quote?.risk?.passed).length,
    results,
  };
}
