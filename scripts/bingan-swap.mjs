import { mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair, Connection, VersionedTransaction } from "@solana/web3.js";
import { decryptVault } from "./wallet-vault.mjs";

const mint = "HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan";
const args = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith("--")).map((x) => {
  const [key, value = "true"] = x.slice(2).split("=", 2);
  return [key, value];
}));
const apiKey = process.env.BINGAN_API_KEY;
const rpcUrl = args.rpc ?? process.env.SOLANA_RPC_URL;
if (!apiKey) throw new Error("Set BINGAN_API_KEY in your shell; never put it in source code or a CLI argument.");
if (!args.action || !["buy", "sell"].includes(args.action)) throw new Error("Use --action=buy or --action=sell.");
if (!args.amount || !/^\d+$/.test(args.amount)) throw new Error("Use --amount=<base-unit integer>.");
if (!args["min-out"] || !/^\d+$/.test(args["min-out"]) || args["min-out"] === "0") throw new Error("Use a non-zero --min-out=<base-unit integer> as external-pool slippage protection.");

const vault = await decryptVault();
const solana = Keypair.fromSeed(derivePath(vault.derivation.solana, mnemonicToSeedSync(vault.mnemonic).toString("hex")).key);
const headers = { "X-Api-Key": apiKey, "Content-Type": "application/json" };
const baseUrl = "https://api.bingan.app/public-api-v1";
let pool = args.pool;
if (!pool) {
  const status = await fetch(`${baseUrl}/token-launch/status/${mint}`, { headers });
  const body = await status.json();
  if (!status.ok || body.code !== 0 || !body.data?.pool) throw new Error(`Could not resolve the graduated token's DAMM v2 pool: ${body.msg ?? status.statusText}`);
  pool = body.data.pool;
}
const response = await fetch(`${baseUrl}/trade/create-pool-swap-transaction`, {
  method: "POST", headers,
  body: JSON.stringify({ publicKey: solana.publicKey.toBase58(), pool, action: args.action, amount: args.amount, minAmountOut: args["min-out"] }),
});
const body = await response.json();
if (!response.ok || body.code !== 0 || !body.data?.tx) throw new Error(`Bingan rejected swap construction: ${body.msg ?? response.statusText}`);
console.log(JSON.stringify({ mode: args.broadcast === "true" ? "broadcast-requested" : "unsigned-only", mint, pool, wallet: solana.publicKey.toBase58(), action: args.action, amount: args.amount, minAmountOut: args["min-out"], estimatedCost: body.data.estimatedCost }, null, 2));
if (args.broadcast !== "true") {
  console.log("No transaction was signed or broadcast. Re-run with --broadcast=true only after independently reviewing these values.");
  process.exit(0);
}
if (!rpcUrl) throw new Error("Broadcasting requires SOLANA_RPC_URL or --rpc=<your RPC URL>.");
const connection = new Connection(rpcUrl, "confirmed");
const tx = VersionedTransaction.deserialize(Buffer.from(body.data.tx, "base64"));
tx.sign([solana]);
const simulation = await connection.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\n${(simulation.value.logs ?? []).join("\n")}`);
const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
console.log(`Broadcast submitted: ${signature}`);
