import { resolve } from "node:path";
import {
  DEFAULT_TEST_WALLET_VAULT,
  decryptTestWalletBackup,
} from "./test-wallet-vault.mjs";

const acknowledgement = "--i-understand-this-prints-a-recovery-phrase";
if (!process.argv.includes(acknowledgement)) {
  throw new Error(`Refusing to print a recovery phrase without ${acknowledgement}.`);
}

const idArgument = process.argv.find((argument) => argument.startsWith("--id="));
const walletId = Number(idArgument?.slice("--id=".length));
if (!Number.isInteger(walletId) || walletId < 1) {
  throw new Error("Supply one wallet number, for example --id=1.");
}

const vaultArgument = process.argv.find((argument) => argument.startsWith("--vault="));
const vaultPath = resolve(vaultArgument?.slice("--vault=".length) || DEFAULT_TEST_WALLET_VAULT);
const secret = await decryptTestWalletBackup(vaultPath);
const wallet = secret.wallets.find((entry) => entry.id === walletId);
if (!wallet) throw new Error(`Wallet ${walletId} does not exist in this vault.`);

console.log(wallet.mnemonic);
