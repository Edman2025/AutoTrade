import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { HDNodeWallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import { encryptAndWriteVault, vaultExists } from "./wallet-vault.mjs";

if (await vaultExists()) throw new Error("A local wallet vault already exists. Refusing to overwrite it.");
const mnemonic = generateMnemonic(256);
const evm = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0");
const seed = mnemonicToSeedSync(mnemonic);
const solana = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key);
await encryptAndWriteVault({ mnemonic, derivation: { evm: "m/44'/60'/0'/0/0", solana: "m/44'/501'/0'/0'" }, createdAt: new Date().toISOString() });
console.log("Created a local non-custodial HD wallet.");
console.log(`EVM address:    ${evm.address}`);
console.log(`Solana address: ${solana.publicKey.toBase58()}`);
console.log("Recovery phrase is AES-256-GCM encrypted in .autotrade/wallet-vault.json.");
console.log("Its vault key is stored only in this Mac user's login Keychain.");
console.log("Do not fund the wallet until you have independently recorded and verified the recovery phrase.");
