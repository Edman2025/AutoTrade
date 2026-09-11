import { isIP } from "node:net";

// Trust one header only when our explicitly configured, local reverse proxy
// overwrites it. Never accept forwarded addresses from direct remote clients.
export function requestIp(request, trustLoopback = false) {
  const peer = request.socket.remoteAddress ?? "unknown";
  const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  const forwarded = request.headers["x-forwarded-for"];
  if (trustLoopback && loopback && typeof forwarded === "string" && isIP(forwarded)) return forwarded;
  return peer;
}
