import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE } = require("../../../vendor/bigint-buffer");

test("vendored bigint-buffer compatibility layer performs bounded pure-JS conversions", () => {
  assert.equal(toBigIntBE(Buffer.from("010203", "hex")), 0x010203n);
  assert.equal(toBigIntLE(Buffer.from("030201", "hex")), 0x010203n);
  assert.equal(toBufferBE(0x010203n, 3).toString("hex"), "010203");
  assert.equal(toBufferLE(0x010203n, 3).toString("hex"), "030201");
  assert.equal(toBufferBE(0x010203n, 2).toString("hex"), "0203");
  assert.throws(() => toBufferBE(-1n, 8), /non-negative/);
  assert.throws(() => toBufferBE(1n, -1), /width/);
});
