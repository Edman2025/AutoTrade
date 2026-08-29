import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, publicConfig } from "../lib/config.mjs";

test("observe mode is the fail-safe default", () => {
  const config = loadConfig({});
  assert.equal(config.network, "mainnet-beta");
  assert.equal(config.mode, "observe");
  assert.equal(config.pools.bgAntfun.address, "AJJxmAV2C2WTHVHD4FEP71Vt8Rdu5day1v4Pr1FJPXEy");
  assert.equal(config.pools.antfunUsdt.address, "54Vp27uLaw4wNLo5n7r4fcC6zLamoQc28xBARjss4EUJ");
  assert.deepEqual(Object.keys(config.pools), ["bgAntfun", "antfunUsdt"]);
  assert.equal(publicConfig(config).mutationsEnabled, false);
});

test("USDT is the accounting denomination while SOL remains fee reserve only", () => {
  const config = loadConfig({});
  assert.equal(config.enablePositionIndex, false);
  assert.equal(config.risk.maxDailyNotionalUsdtRaw, 10_000_000_000n);
  assert.equal(config.risk.minSolReserveRaw, 100_000_000n);
  assert.equal("maxTradeSolRaw" in config.risk, false);
});

test("expensive position indexing is explicit", () => {
  assert.equal(loadConfig({ MAKER_ENABLE_POSITION_INDEX: "true" }).enablePositionIndex, true);
  assert.throws(() => loadConfig({ MAKER_ENABLE_POSITION_INDEX: "yes" }), /true or false/);
});

test("prepare mode requires an operator wallet and admin token", () => {
  assert.throws(() => loadConfig({ MAKER_MODE: "prepare" }), /MAKER_WALLET_ADDRESS/);
  assert.throws(() => loadConfig({
    MAKER_MODE: "prepare",
    MAKER_WALLET_ADDRESS: "11111111111111111111111111111111",
  }), /MAKER_ADMIN_TOKEN/);
  assert.throws(() => loadConfig({
    MAKER_MODE: "prepare",
    MAKER_WALLET_ADDRESS: "11111111111111111111111111111111",
    MAKER_ADMIN_TOKEN: "short",
  }), /at least 32 characters/);
});

test("CORS permits HTTPS and loopback HTTP origins only", () => {
  assert.doesNotThrow(() => loadConfig({ MAKER_ALLOWED_ORIGINS: "https://maker.example,http://127.0.0.1:4173" }));
  assert.throws(() => loadConfig({ MAKER_ALLOWED_ORIGINS: "http://maker.example" }), /HTTPS or a loopback/);
});

test("live mode requires an explicit mainnet acknowledgement", () => {
  assert.throws(() => loadConfig({
    MAKER_MODE: "live",
    MAKER_WALLET_ADDRESS: "11111111111111111111111111111111",
    MAKER_ADMIN_TOKEN: "0123456789abcdef0123456789abcdef",
  }), /MAKER_LIVE_ACK/);
});

test("public RPC live mode requires a separate explicit risk acceptance and remains visibly non-private", () => {
  const base = {
    MAKER_MODE: "live",
    MAKER_LIVE_ACK: "I_UNDERSTAND_MAINNET",
    MAKER_WALLET_ADDRESS: "11111111111111111111111111111111",
    MAKER_ADMIN_TOKEN: "0123456789abcdef0123456789abcdef",
    SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
  };
  const unaccepted = loadConfig(base);
  assert.equal(unaccepted.rpcPolicyVerified, false);
  const accepted = loadConfig({ ...base, MAKER_PUBLIC_RPC_LIVE_ACK: "I_ACCEPT_PUBLIC_RPC_LIVE_RISK" });
  assert.equal(accepted.privateRpcVerified, false);
  assert.equal(accepted.publicRpcRiskAccepted, true);
  assert.equal(accepted.rpcPolicyVerified, true);
  assert.equal(publicConfig(accepted).rpcPolicy.mode, "public-risk-accepted");
  const plaintext = loadConfig({ ...base, SOLANA_RPC_URL: "http://rpc.example", MAKER_PUBLIC_RPC_LIVE_ACK: "I_ACCEPT_PUBLIC_RPC_LIVE_RISK" });
  assert.equal(plaintext.rpcPolicyVerified, false);
});
