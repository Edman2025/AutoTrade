import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { HDNodeWallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import { resolve } from "node:path";
import {
  DEFAULT_TEST_WALLET_ADDRESSES,
  DEFAULT_TEST_WALLET_VAULT,
  writeEncryptedTestWalletBackup,
} from "./test-wallet-vault.mjs";

const EVM_PATH = "m/44'/60'/0'/0/0";
const SOLANA_PATH = "m/44'/501'/0'/0'";

const count = Number(process.argv[2] ?? 1000);
const vaultPath = resolve(process.argv[3] ?? DEFAULT_TEST_WALLET_VAULT);
const addressesPath = resolve(process.argv[4] ?? DEFAULT_TEST_WALLET_ADDRESSES);

if (!Number.isInteger(count) || count < 1 || count > 10_000) {
  throw new Error("Wallet count must be an integer from 1 to 10,000.");
}

const createdAt = new Date().toISOString();
const wallets = [];
const publicWallets = [];
const seenEvm = new Set();
const seenSolana = new Set();

for (let index = 0; index < count; index += 1) {
  const mnemonic = generateMnemonic(256);
  const seed = mnemonicToSeedSync(mnemonic);
  const evmAddress = HDNodeWallet.fromSeed(seed).derivePath(EVM_PATH).address;
  const solanaAddress = Keypair.fromSeed(
    derivePath(SOLANA_PATH, seed.toString("hex")).key,
  ).publicKey.toBase58();

  if (seenEvm.has(evmAddress) || seenSolana.has(solanaAddress)) {
    throw new Error("Unexpected duplicate address; no files were written.");
  }
  seenEvm.add(evmAddress);
  seenSolana.add(solanaAddress);

  const entry = {
    id: index + 1,
    mnemonic,
    addresses: { evm: evmAddress, solana: solanaAddress },
  };
  wallets.push(entry);
  publicWallets.push({ id: entry.id, ...entry.addresses });
}

const metadata = {
  purpose: "Local/testnet fixtures only. Never fund or use on a production platform.",
  createdAt,
  walletCount: count,
  mnemonic: "BIP-39, 256-bit entropy, 24 English words per wallet",
  derivation: { evm: EVM_PATH, solana: SOLANA_PATH },
};

await writeEncryptedTestWalletBackup({
  vaultPath,
  addressesPath,
  secret: { ...metadata, wallets },
  publicManifest: { ...metadata, wallets: publicWallets },
});

console.log(`Created ${count} independent test wallets.`);
console.log(`Encrypted mnemonic backup: ${vaultPath}`);
console.log(`Public address manifest:   ${addressesPath}`);
console.log("Vault password: stored in this Mac user's login Keychain.");
console.log("No mnemonic or private key was printed or written in plaintext.");
