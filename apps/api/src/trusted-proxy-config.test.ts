import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parseTrustedProxyCidrs } from "./trusted-proxy.js";

const require = createRequire(import.meta.url);
const proxyAddress = require("@fastify/proxy-addr") as { compile: (ranges: string[]) => (address: string) => boolean };
const compileTrust = (value: string) => proxyAddress.compile(parseTrustedProxyCidrs(value));

describe("explicit proxy trust configuration", () => {
  it("defaults only to exact IPv4 and IPv6 loopback addresses", () => {
    expect(parseTrustedProxyCidrs(undefined)).toEqual(["127.0.0.1/32", "::1/128"]);
    const first = parseTrustedProxyCidrs(undefined); first.push("203.0.113.1/32");
    expect(parseTrustedProxyCidrs(undefined)).toEqual(["127.0.0.1/32", "::1/128"]);
  });
  it("normalizes individual addresses and deduplicates the explicitly allowed ingress", () => {
    expect(parseTrustedProxyCidrs(" 10.0.2.4, 10.0.2.4/32, ::1 ")).toEqual(["10.0.2.4/32", "::1/128"]);
  });
  it("supports bounded IPv4 and IPv6 proxy networks and mapped addresses", () => {
    expect(parseTrustedProxyCidrs("10.0.2.0/24,2001:db8:1::/64,::ffff:10.0.2.4/128")).toEqual(["10.0.2.0/24", "2001:db8:1::/64", "::ffff:10.0.2.4/128"]);
  });
  it.each([
    "::ffff:0.0.0.0/64", "::ffff:0:0/96", "::ffff:10.0.2.0/119",
    "0:0:0:0:0:ffff:a00:200/119", "::/64", "::1/64", "::fffe:ffff:ffff/95"
  ])("rejects IPv6 ranges that compile into broad IPv4 trust: %s", (value) => {
    expect(() => compileTrust(value)).toThrow("narrow proxy address ranges");
  });
  it.each(["::ffff:10.0.2.0/120", "::ffff:a00:200/120"])("limits compiled IPv4-mapped /120 trust to its IPv4 /24: %s", (value) => {
    const trust = compileTrust(value);
    expect(trust("10.0.2.4")).toBe(true);
    expect(trust("::ffff:10.0.2.254")).toBe(true);
    expect(trust("10.0.3.4")).toBe(false);
    expect(trust("203.0.113.44")).toBe(false);
  });
  it("limits compiled mapped /128 trust to one IPv4 peer", () => {
    const trust = compileTrust("::ffff:a00:204/128");
    expect(trust("10.0.2.4")).toBe(true);
    expect(trust("10.0.2.5")).toBe(false);
  });
  it("preserves compiled native IPv6 networks and exact loopback trust", () => {
    const trust = compileTrust("2001:db8:1::/64,::1/128");
    expect(trust("2001:db8:1::abcd")).toBe(true);
    expect(trust("2001:db8:2::abcd")).toBe(false);
    expect(trust("::1")).toBe(true);
    expect(trust("203.0.113.44")).toBe(false);
  });
  it.each(["", " ", "true", "1", "loopback", "uniquelocal", "localhost", "http://10.0.2.4", "0.0.0.0/0", "::/0", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "10.0.2.4/33", "::1/129", "127.0.0.1/024", "127.0.0.1/-1", "127.0.0.1//32", "127.0.0.1,,::1", "fe80::1%eth0"])("rejects an empty, broad or malformed trust declaration: %s", (value) => {
    expect(() => parseTrustedProxyCidrs(value)).toThrow();
  });
  it("rejects an accidentally unbounded configuration list", () => {
    expect(() => parseTrustedProxyCidrs(Array.from({ length: 33 }, () => "127.0.0.1").join(","))).toThrow();
  });
});
