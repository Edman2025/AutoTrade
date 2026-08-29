import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const vaultPath = resolve(".autotrade/wallet-vault.json");
const service = "AutoTrade local wallet vault";
const account = process.env.USER ?? "local-user";

function keychain(args) {
  const result = spawnSync("security", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Could not access the macOS Keychain.");
  return result.stdout.trim();
}
function deriveKey(password, salt) {
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export async function vaultExists() {
  try { await access(vaultPath, constants.F_OK); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}
export function createAndStoreVaultPassword() {
  const password = randomBytes(32).toString("base64url");
  keychain(["add-generic-password", "-U", "-a", account, "-s", service, "-w", password]);
  return password;
}
function readVaultPassword() { return keychain(["find-generic-password", "-a", account, "-s", service, "-w"]); }
export async function encryptAndWriteVault(secret) {
  const salt = randomBytes(16), iv = randomBytes(12), key = deriveKey(createAndStoreVaultPassword(), salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  const vault = { version: 1, cipher: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  await mkdir(dirname(vaultPath), { recursive: true, mode: 0o700 });
  await writeFile(vaultPath, JSON.stringify(vault, null, 2) + "\n", { mode: 0o600 });
}
export async function decryptVault() {
  const vault = JSON.parse(await readFile(vaultPath, "utf8"));
  if (vault.version !== 1 || vault.cipher !== "aes-256-gcm" || vault.kdf !== "scrypt") throw new Error("Unsupported local vault format.");
  const key = deriveKey(readVaultPassword(), Buffer.from(vault.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(vault.iv, "base64"));
  decipher.setAuthTag(Buffer.from(vault.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(vault.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
