#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const uuidVersion = require("uuid/package.json").version;
const [uuidMajor, uuidMinor, uuidPatch] = uuidVersion.split(".").map(Number);
const uuidPatched = uuidMajor > 11 || (uuidMajor === 11 && (uuidMinor > 1 || (uuidMinor === 1 && uuidPatch >= 1)));
if (!uuidPatched) throw new Error(`uuid ${uuidVersion} is below the audited 11.1.1 floor.`);

const solanaRequire = createRequire(require.resolve("@solana/buffer-layout-utils"));
const bigintVersion = solanaRequire("bigint-buffer/package.json").version;
const bigintImplementation = solanaRequire.resolve("bigint-buffer");
if (bigintVersion !== "1.1.6" || !bigintImplementation.endsWith("vendor/bigint-buffer/index.cjs")) {
  throw new Error(`Expected the reviewed pure-JS bigint-buffer 1.1.6 compatibility module, received ${bigintVersion} at ${bigintImplementation}.`);
}

let nativeBigintBinding = false;
try {
  require.resolve("bigint-buffer/build/Release/bigint_buffer.node");
  nativeBigintBinding = true;
} catch {
  // Expected: production installs dependencies with --ignore-scripts, forcing the bounded pure-JS implementation.
}
if (nativeBigintBinding) throw new Error("The vulnerable bigint-buffer native binding is present; reinstall with npm ci --ignore-scripts.");

console.log(JSON.stringify({ status: "passed", uuidVersion, bigintBufferVersion: bigintVersion, bigintBufferImplementation: "pure-js" }));
