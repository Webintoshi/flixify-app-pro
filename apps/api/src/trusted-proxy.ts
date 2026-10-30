import { BlockList, isIP } from "node:net";

const LOOPBACK_PROXIES = ["127.0.0.1/32", "::1/128"];
const IPV4_MAPPED_SPACE = new BlockList();
IPV4_MAPPED_SPACE.addSubnet("::ffff:0:0", 96, "ipv6");

/** Trust addresses, never a hop count or the entire private-address space. */
export function parseTrustedProxyCidrs(value: string | undefined): string[] {
  if (value === undefined) return [...LOOPBACK_PROXIES];
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length === 0 || entries.length > 32) throw new Error("TRUSTED_PROXY_CIDRS requires a bounded list of narrow IP ranges.");
  const normalized = entries.map((entry) => {
    const parts = entry.split("/");
    const address = parts[0] ?? "";
    const family = isIP(address);
    if (!family || address.includes("%") || parts.length > 2) throw new Error("TRUSTED_PROXY_CIDRS contains an invalid IP address.");
    const maximum = family === 4 ? 32 : 128;
    const minimum = family === 4 ? 24 : 64;
    const mask = parts[1];
    if (mask !== undefined && !/^[1-9]\d{0,2}$/.test(mask)) throw new Error("TRUSTED_PROXY_CIDRS contains an invalid prefix.");
    const prefix = mask === undefined ? maximum : Number(mask);
    if (prefix < minimum || prefix > maximum) throw new Error("TRUSTED_PROXY_CIDRS must use narrow proxy address ranges.");
    if (family === 6 && prefix < 120) {
      const network = new BlockList();
      network.addSubnet(address, prefix, "ipv6");
      // proxy-addr converts overlapping mapped IPv6 space into IPv4 trust.
      if (IPV4_MAPPED_SPACE.check(address, "ipv6") || network.check("::ffff:0:0", "ipv6")) {
        throw new Error("TRUSTED_PROXY_CIDRS must use narrow proxy address ranges.");
      }
    }
    return `${address}/${prefix}`;
  });
  return [...new Set(normalized)];
}
