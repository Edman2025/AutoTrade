import { decryptVault } from "./wallet-vault.mjs";
if (!process.argv.includes("--i-understand-this-prints-my-recovery-phrase")) throw new Error("Refusing to print a recovery phrase without the explicit acknowledgement flag.");
console.log((await decryptVault()).mnemonic);
