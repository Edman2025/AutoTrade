import { validateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair, PublicKey } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEFAULT_SIAM_WALLET_ADDRESSES,
  DEFAULT_SIAM_WALLET_VAULT,
  decryptSiamWalletBackup,
} from "./siam-wallet-vault.mjs";

const vaultPath = resolve(process.argv[2] ?? DEFAULT_SIAM_WALLET_VAULT);
const addressesPath = resolve(process.argv[3] ?? DEFAULT_SIAM_WALLET_ADDRESSES);
const secret = await decryptSiamWalletBackup(vaultPath);
const publicManifest = JSON.parse(await readFile(addressesPath, "utf8"));

if (!Array.isArray(secret.wallets) || secret.walletCount !== secret.wallets.length) {
  throw new Error("Encrypted wallet count is inconsistent.");
}
if (!Array.isArray(publicManifest.wallets) || publicManifest.wallets.length !== secret.wallets.length) {
  throw new Error("Public address manifest count is inconsistent.");
}

const publicById = new Map(publicManifest.wallets.map((wallet) => [wallet.id, wallet]));
const seenAddresses = new Set();
for (const wallet of secret.wallets) {
  if (!validateMnemonic(wallet.mnemonic)) {
    throw new Error(`Wallet ${wallet.id} has an invalid BIP-39 mnemonic.`);
  }
  const seed = mnemonicToSeedSync(wallet.mnemonic);
  const address = Keypair.fromSeed(
    derivePath(secret.derivation.solana, seed.toString("hex")).key,
  ).publicKey.toBase58();
  const publicWallet = publicById.get(wallet.id);
  if (address !== wallet.address || address !== publicWallet?.address) {
    throw new Error(`Wallet ${wallet.id} does not match its public manifest.`);
  }
  if (!PublicKey.isOnCurve(new PublicKey(address).toBytes())) {
    throw new Error(`Wallet ${wallet.id} is not an Ed25519 signer address.`);
  }
  if (seenAddresses.has(address)) {
    throw new Error(`Wallet ${wallet.id} duplicates an earlier address.`);
  }
  seenAddresses.add(address);
}

console.log(`Verified ${secret.wallets.length} encrypted Siam wallets.`);
console.log("All addresses re-derived successfully from valid 24-word BIP-39 mnemonics.");
console.log("No mnemonic or private key was printed.");
