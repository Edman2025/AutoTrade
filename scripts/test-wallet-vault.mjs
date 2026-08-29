import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_TEST_WALLET_VAULT = resolve(".autotrade/test-wallets-vault.json");
export const DEFAULT_TEST_WALLET_ADDRESSES = resolve(".autotrade/test-wallet-addresses.json");
export const TEST_WALLET_KEYCHAIN_SERVICE = "AutoTrade test wallet vault";

function keychainAccount(vaultPath) {
  return createHash("sha256").update(resolve(vaultPath)).digest("hex");
}

function runKeychain(args, { allowFailure = false } = {}) {
  const result = spawnSync("security", args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error("Could not access the macOS login Keychain.");
  }
  return result;
}

function storeVaultPassword(vaultPath, password) {
  const account = keychainAccount(vaultPath);
  const existing = runKeychain(
    ["find-generic-password", "-a", account, "-s", TEST_WALLET_KEYCHAIN_SERVICE],
    { allowFailure: true },
  );
  if (existing.status === 0) {
    throw new Error("A Keychain key already exists for this vault path; refusing to replace it.");
  }
  runKeychain([
    "add-generic-password",
    "-a",
    account,
    "-s",
    TEST_WALLET_KEYCHAIN_SERVICE,
    "-w",
    password,
  ]);
  return account;
}

function readVaultPassword(vaultPath) {
  const result = runKeychain([
    "find-generic-password",
    "-a",
    keychainAccount(vaultPath),
    "-s",
    TEST_WALLET_KEYCHAIN_SERVICE,
    "-w",
  ]);
  return result.stdout.trim();
}

function deleteVaultPassword(vaultPath) {
  runKeychain(
    [
      "delete-generic-password",
      "-a",
      keychainAccount(vaultPath),
      "-s",
      TEST_WALLET_KEYCHAIN_SERVICE,
    ],
    { allowFailure: true },
  );
}

function deriveKey(password, salt) {
  return scryptSync(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeTemp(path, data, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, data, { flag: "wx", mode });
  return tempPath;
}

export async function writeEncryptedTestWalletBackup({ vaultPath, addressesPath, secret, publicManifest }) {
  const resolvedVaultPath = resolve(vaultPath);
  const resolvedAddressesPath = resolve(addressesPath);
  if (resolvedVaultPath === resolvedAddressesPath) {
    throw new Error("The encrypted vault and public address manifest must use different paths.");
  }
  if (await exists(resolvedVaultPath)) {
    throw new Error(`${resolvedVaultPath} already exists; refusing to overwrite it.`);
  }
  if (await exists(resolvedAddressesPath)) {
    throw new Error(`${resolvedAddressesPath} already exists; refusing to overwrite it.`);
  }

  const password = randomBytes(32).toString("base64url");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secret), "utf8"),
    cipher.final(),
  ]);
  const vault = {
    format: "autotrade-test-wallet-vault",
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    keychain: {
      service: TEST_WALLET_KEYCHAIN_SERVICE,
      account: keychainAccount(resolvedVaultPath),
    },
    walletCount: secret.wallets.length,
    createdAt: secret.createdAt,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };

  let vaultTemp;
  let addressesTemp;
  let keyStored = false;
  try {
    vaultTemp = await writeTemp(resolvedVaultPath, `${JSON.stringify(vault, null, 2)}\n`, 0o600);
    addressesTemp = await writeTemp(
      resolvedAddressesPath,
      `${JSON.stringify(publicManifest, null, 2)}\n`,
      0o600,
    );
    storeVaultPassword(resolvedVaultPath, password);
    keyStored = true;
    await rename(vaultTemp, resolvedVaultPath);
    vaultTemp = undefined;
    await rename(addressesTemp, resolvedAddressesPath);
    addressesTemp = undefined;
  } catch (error) {
    if (vaultTemp) await unlink(vaultTemp).catch(() => {});
    if (addressesTemp) await unlink(addressesTemp).catch(() => {});
    if (keyStored && !(await exists(resolvedVaultPath))) deleteVaultPassword(resolvedVaultPath);
    throw error;
  }
}

export async function decryptTestWalletBackup(vaultPath = DEFAULT_TEST_WALLET_VAULT) {
  const resolvedVaultPath = resolve(vaultPath);
  const vault = JSON.parse(await readFile(resolvedVaultPath, "utf8"));
  const expectedAccount = keychainAccount(resolvedVaultPath);
  if (
    vault.format !== "autotrade-test-wallet-vault" ||
    vault.version !== 1 ||
    vault.cipher !== "aes-256-gcm" ||
    vault.kdf !== "scrypt" ||
    vault.keychain?.service !== TEST_WALLET_KEYCHAIN_SERVICE ||
    vault.keychain?.account !== expectedAccount
  ) {
    throw new Error("Unsupported or misplaced test wallet vault.");
  }

  const key = deriveKey(readVaultPassword(resolvedVaultPath), Buffer.from(vault.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(vault.iv, "base64"));
  decipher.setAuthTag(Buffer.from(vault.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(vault.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
}
