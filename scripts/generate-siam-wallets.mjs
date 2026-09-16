import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import { resolve } from "node:path";
import {
  DEFAULT_SIAM_WALLET_ADDRESSES,
  DEFAULT_SIAM_WALLET_VAULT,
  writeEncryptedSiamWalletBackup,
} from "./siam-wallet-vault.mjs";

const SOLANA_PATH = "m/44'/501'/0'/0'";
const count = Number(process.argv[2] ?? 6);
const vaultPath = resolve(process.argv[3] ?? DEFAULT_SIAM_WALLET_VAULT);
const addressesPath = resolve(process.argv[4] ?? DEFAULT_SIAM_WALLET_ADDRESSES);

if (!Number.isInteger(count) || count < 1 || count > 100) {
  throw new Error("Wallet count must be an integer from 1 to 100.");
}

const createdAt = new Date().toISOString();
const wallets = [];
const publicWallets = [];
const seenAddresses = new Set();

for (let index = 0; index < count; index += 1) {
  const mnemonic = generateMnemonic(256);
  const seed = mnemonicToSeedSync(mnemonic);
  const address = Keypair.fromSeed(
    derivePath(SOLANA_PATH, seed.toString("hex")).key,
  ).publicKey.toBase58();
  if (seenAddresses.has(address)) {
    throw new Error("Unexpected duplicate address; no files were written.");
  }
  seenAddresses.add(address);
  const wallet = { id: index + 1, label: `siam-wallet-${String(index + 1).padStart(2, "0")}`, mnemonic, address };
  wallets.push(wallet);
  publicWallets.push({ id: wallet.id, label: wallet.label, address });
}

const metadata = {
  purpose: "Independent Solana wallets for holding Siam SPL tokens and SOL transaction fees.",
  network: "Solana mainnet capable; unfunded at creation",
  createdAt,
  walletCount: count,
  mnemonic: "BIP-39, 256-bit entropy, 24 English words per wallet",
  derivation: { solana: SOLANA_PATH },
};

await writeEncryptedSiamWalletBackup({
  vaultPath,
  addressesPath,
  secret: { ...metadata, wallets },
  publicManifest: { ...metadata, wallets: publicWallets },
});

console.log(`Created ${count} independent Solana wallets for Siam tokens.`);
console.log(`Encrypted recovery vault: ${vaultPath}`);
console.log(`Public address manifest:  ${addressesPath}`);
console.log("Vault password is stored in this Mac user's login Keychain.");
console.log("No mnemonic or private key was printed or written in plaintext.");
