"use strict";

function toBigIntLE(value) {
  return toBigIntBE(Buffer.from(value).reverse());
}

function toBigIntBE(value) {
  const hex = Buffer.from(value).toString("hex");
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

function toBufferLE(value, width) {
  return toBufferBE(value, width).reverse();
}

function toBufferBE(value, width) {
  assertWidth(width);
  const number = BigInt(value);
  if (number < 0n) throw new RangeError("value must be non-negative");
  const modulus = 1n << BigInt(width * 8);
  const normalized = number % modulus;
  const hex = normalized.toString(16).padStart(width * 2, "0");
  return Buffer.from(hex, "hex");
}

function assertWidth(width) {
  if (!Number.isSafeInteger(width) || width < 0) throw new RangeError("width must be a non-negative safe integer");
}

module.exports = { toBigIntLE, toBigIntBE, toBufferLE, toBufferBE };
