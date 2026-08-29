#!/usr/bin/env node
import { spawn } from "node:child_process";

const intervalMs = boundedInteger(process.env.MAKER_BACKUP_INTERVAL_MS, 21_600_000, 60_000, 86_400_000);
let running = false;

async function backup() {
  if (running) return;
  running = true;
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL("./backup-market-maker-db.mjs", import.meta.url).pathname], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code !== 0) console.error(JSON.stringify({ status: "backup-failed", exitCode: code }));
      resolve();
    });
    child.on("error", (error) => {
      console.error(JSON.stringify({ status: "backup-failed", error: error.message }));
      resolve();
    });
  });
  running = false;
}

await backup();
setInterval(backup, intervalMs);

function boundedInteger(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Value must be between ${min} and ${max}.`);
  return number;
}
