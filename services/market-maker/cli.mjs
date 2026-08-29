#!/usr/bin/env node
import { loadConfig, publicConfig } from "./lib/config.mjs";
import { MarketDataService } from "./lib/market-data.mjs";
import { MakerStore } from "./lib/store.mjs";

const command = process.argv[2] ?? "check";
const config = loadConfig();
const marketData = new MarketDataService(config);

if (command === "probe") {
  const result = await marketData.probeConfiguredTopology();
  console.log(JSON.stringify(result, null, 2));
} else if (command === "check") {
  const store = new MakerStore(config.databasePath);
  try {
    const snapshot = await marketData.capture();
    store.saveSnapshot(snapshot);
    console.log(JSON.stringify({ config: publicConfig(config), snapshot }, null, 2));
    if (!snapshot.topologyReady) process.exitCode = 2;
  } finally { store.close(); }
} else {
  throw new Error("Usage: maker:probe or maker:check");
}
