import { test } from "node:test";
import assert from "node:assert/strict";
import { requestIp } from "../lib/request-ip.mjs";
const req = (peer, forwarded) => ({socket: {remoteAddress: peer}, headers: {"x-forwarded-for": forwarded}});
test("proxy IP requires explicit trust, loopback peer and one valid address", () => {
  assert.equal(requestIp(req("127.0.0.1", "198.51.100.2")), "127.0.0.1");
  assert.equal(requestIp(req("127.0.0.1", "198.51.100.2"), true), "198.51.100.2");
  assert.equal(requestIp(req("198.51.100.1", "198.51.100.2"), true), "198.51.100.1");
  assert.equal(requestIp(req("::1", "198.51.100.2, 198.51.100.3"), true), "::1");
  assert.equal(requestIp(req("::1", "spoofed"), true), "::1");
  assert.equal(requestIp(req("::1", "2001:db8::1"), true), "2001:db8::1");
});
