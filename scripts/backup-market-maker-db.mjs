#!/usr/bin/env node
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = resolve(process.env.MAKER_DATABASE_PATH || "services/market-maker/data/maker.sqlite");
const backupDirectory = resolve(process.env.MAKER_BACKUP_DIRECTORY || `${dirname(databasePath)}/backups`);
const retentionDays = boundedInteger(process.env.MAKER_BACKUP_RETENTION_DAYS, 14, 1, 365);
if (backupDirectory === dirname(backupDirectory) || backupDirectory === databasePath || !backupDirectory.startsWith(`${dirname(databasePath)}${sep}`)) {
  throw new Error("Backup directory must be a dedicated child of the database directory.");
}
if (basename(databasePath) === "" || !statSync(databasePath).isFile()) throw new Error("SQLite source database does not exist.");

mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = resolve(backupDirectory, `maker-${stamp}.sqlite`);
const escapedTarget = target.replaceAll("'", "''");
const database = new DatabaseSync(databasePath);
try {
  database.exec(`VACUUM INTO '${escapedTarget}'`);
} finally {
  database.close();
}
chmodSync(target, 0o600);

const cutoff = Date.now() - retentionDays * 86_400_000;
let removed = 0;
for (const name of readdirSync(backupDirectory)) {
  if (!/^maker-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sqlite$/.test(name)) continue;
  const candidate = resolve(backupDirectory, name);
  if (!candidate.startsWith(`${backupDirectory}${sep}`) || statSync(candidate).mtimeMs >= cutoff) continue;
  unlinkSync(candidate);
  removed += 1;
}
console.log(JSON.stringify({ status: "complete", backup: target, removed, retentionDays }));

function boundedInteger(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Value must be between ${min} and ${max}.`);
  return number;
}
