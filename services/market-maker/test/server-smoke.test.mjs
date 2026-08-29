import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

test("HTTP API rejects foreign origins, emits security headers, and keeps SSE alive", { timeout: 15_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd: new URL("../../../", import.meta.url),
    env: { ...process.env, MAKER_MODE: "observe", MAKER_HOST: "127.0.0.1", MAKER_PORT: String(port), MAKER_DATABASE_PATH: ":memory:", MAKER_SSE_HEARTBEAT_MS: "1000", SOLANA_RPC_URL: "http://127.0.0.1:9" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForListening(child);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-frame-options"), "DENY");
    assert.match(health.headers.get("permissions-policy"), /camera=\(\)/);
    const foreign = await fetch(`http://127.0.0.1:${port}/api/v1/config`, { headers: { Origin: "https://attacker.example" } });
    assert.equal(foreign.status, 403);
    const plaintextOperator = await fetch(`http://127.0.0.1:${port}/api/v1/control/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "http" },
      body: JSON.stringify({ reason: "transport-test" }),
    });
    assert.equal(plaintextOperator.status, 426);

    const controller = new AbortController();
    const events = await fetch(`http://127.0.0.1:${port}/api/v1/events`, { signal: controller.signal });
    const reader = events.body.getReader();
    let text = "";
    const deadline = Date.now() + 3_500;
    while (!text.includes(": ping") && Date.now() < deadline) {
      const { value } = await reader.read();
      text += Buffer.from(value ?? []).toString("utf8");
    }
    controller.abort();
    assert.match(text, /event: ready/);
    assert.match(text, /: ping/);
  } finally {
    const exited = child.exitCode == null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve();
    child.kill("SIGTERM");
    await exited;
  }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5_000);
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!output.includes('"status":"listening"')) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}: ${output}`));
    });
  });
}
