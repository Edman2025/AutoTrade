import { validateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { HDNodeWallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEFAULT_TEST_WALLET_ADDRESSES,
  DEFAULT_TEST_WALLET_VAULT,
  decryptTestWalletBackup,
} from "./test-wallet-vault.mjs";

const vaultPath = resolve(process.argv[2] ?? DEFAULT_TEST_WALLET_VAULT);
const addressesPath = resolve(process.argv[3] ?? DEFAULT_TEST_WALLET_ADDRESSES);
const secret = await decryptTestWalletBackup(vaultPath);
const publicManifest = JSON.parse(await readFile(addressesPath, "utf8"));

if (!Array.isArray(secret.wallets) || secret.walletCount !== secret.wallets.length) {
  throw new Error("Encrypted wallet count is inconsistent.");
}
if (!Array.isArray(publicManifest.wallets) || publicManifest.wallets.length !== secret.wallets.length) {
  throw new Error("Public address manifest count is inconsistent.");
}

const publicById = new Map(publicManifest.wallets.map((wallet) => [wallet.id, wallet]));
const seenEvm = new Set();
const seenSolana = new Set();

for (const wallet of secret.wallets) {
  if (!validateMnemonic(wallet.mnemonic)) {
    throw new Error(`Wallet ${wallet.id} has an invalid BIP-39 mnemonic.`);
  }
  const seed = mnemonicToSeedSync(wallet.mnemonic);
  const evm = HDNodeWallet.fromSeed(seed).derivePath(secret.derivation.evm).address;
  const solana = Keypair.fromSeed(
    derivePath(secret.derivation.solana, seed.toString("hex")).key,
  ).publicKey.toBase58();
  const publicWallet = publicById.get(wallet.id);

  if (
    evm !== wallet.addresses.evm ||
    solana !== wallet.addresses.solana ||
    evm !== publicWallet?.evm ||
    solana !== publicWallet?.solana
  ) {
    throw new Error(`Wallet ${wallet.id} does not match its saved public addresses.`);
  }
  if (seenEvm.has(evm) || seenSolana.has(solana)) {
    throw new Error(`Wallet ${wallet.id} duplicates an earlier address.`);
  }
  seenEvm.add(evm);
  seenSolana.add(solana);
}

console.log(`Verified ${secret.wallets.length} encrypted test wallets.`);
console.log("All BIP-39 mnemonics are valid; all EVM and Solana addresses re-derived successfully.");
console.log("No mnemonic or private key was printed.");
