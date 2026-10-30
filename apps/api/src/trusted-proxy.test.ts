import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_CIDRS = "10.0.2.4/32,127.0.0.1/32,::1/128";
});

import { buildServer } from "./server.js";

describe("client address behind the explicitly trusted ingress", () => {
  const app = buildServer();
  app.get("/__test/client-address", (request) => ({ ip: request.ip }));
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  const address = async (remoteAddress: string, headers: Record<string, string>) => {
    const response = await app.inject({ url: "/__test/client-address", remoteAddress, headers });
    expect(response.statusCode).toBe(200);
    return response.json().ip;
  };

  it("uses the real adjacent visitor forwarded by the trusted proxy", async () => {
    expect(await address("10.0.2.4", { "x-forwarded-for": "203.0.113.44" })).toBe("203.0.113.44");
  });
  it("does not trust a direct client's invented forwarding header", async () => {
    expect(await address("198.51.100.9", { "x-forwarded-for": "203.0.113.44" })).toBe("198.51.100.9");
  });
  it("stops at the adjacent untrusted client instead of its invented earlier hop", async () => {
    expect(await address("10.0.2.4", { "x-forwarded-for": "203.0.113.44, 198.51.100.9" })).toBe("198.51.100.9");
  });
  it("cannot make a direct client trusted by appending the allowed proxy to a header", async () => {
    expect(await address("198.51.100.9", { "x-forwarded-for": "203.0.113.44, 10.0.2.4" })).toBe("198.51.100.9");
  });
  it("recognizes the IPv4-mapped form of the same trusted ingress", async () => {
    expect(await address("::ffff:10.0.2.4", { "x-forwarded-for": "203.0.113.44" })).toBe("203.0.113.44");
  });
  it("keeps the explicitly configured IPv6 loopback proxy compatible", async () => {
    expect(await address("::1", { "x-forwarded-for": "2001:db8::44" })).toBe("2001:db8::44");
  });
  it("does not substitute an unverified Cloudflare header for the trusted chain", async () => {
    expect(await address("10.0.2.4", { "cf-connecting-ip": "203.0.113.44" })).toBe("10.0.2.4");
  });
});
