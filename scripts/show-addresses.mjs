import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { HDNodeWallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import { decryptVault } from "./wallet-vault.mjs";

const vault = await decryptVault();
const evm = HDNodeWallet.fromPhrase(vault.mnemonic, undefined, vault.derivation.evm);
const solana = Keypair.fromSeed(derivePath(vault.derivation.solana, mnemonicToSeedSync(vault.mnemonic).toString("hex")).key);
console.log(JSON.stringify({ evm: evm.address, solana: solana.publicKey.toBase58(), createdAt: vault.createdAt }, null, 2));
