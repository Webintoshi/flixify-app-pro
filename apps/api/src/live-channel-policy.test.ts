import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db.js", () => ({ query: database.query }));
import { buildLiveChannelPolicy, loadLiveChannelPolicy } from "./live-channel-policy.js";

describe("origin-scoped live channel exclusions", () => {
  beforeEach(() => { database.query.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("builds a deterministic sorted, deduplicated policy independent of account identity", () => {
    const policy = buildLiveChannelPolicy("https://provider.example", ["20", "3", "20", "100"]);
    expect(policy.excludedIds).toEqual(["3", "20", "100"]);
    expect(policy.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(buildLiveChannelPolicy("https://provider.example", ["100", "20", "3"])).toEqual(policy);
    expect(buildLiveChannelPolicy("https://other.example", ["3", "20", "100"]).revision).not.toBe(policy.revision);
    expect(buildLiveChannelPolicy("https://provider.example", ["3"]).revision).not.toBe(policy.revision);
  });

  it.each(["http://provider.example", "https://name:secret@provider.example", "https://provider.example/", "https://provider.example/path", "https://provider.example?x=1", "https://provider.example#x", "https://PROVIDER.example", "https://provider.example:443", "bad", ""])("rejects a noncanonical origin %s", (origin) => {
    expect(() => buildLiveChannelPolicy(origin, ["3"])).toThrow();
  });

  it.each(["0", "03", "-3", "3.0", "1e3", "3?x=1", "1000000000000000", "", " 3", 3, null])("rejects an invalid provider stream identifier %j", (value) => {
    expect(() => buildLiveChannelPolicy("https://provider.example", [value] as string[])).toThrow();
  });

  it("rejects unbounded row counts without publishing a truncated exclusion policy", () => {
    expect(() => buildLiveChannelPolicy("https://provider.example", Array(50001).fill("1"))).toThrow();
    expect(buildLiveChannelPolicy("https://provider.example", []).excludedIds).toEqual([]);
  });

  it("reads only the authorized canonical provider origin with a bounded parameterized query", async () => {
    database.query.mockResolvedValue({ rows: [{ stream_id: "20" }, { stream_id: "3" }] });
    const result = await loadLiveChannelPolicy("https://provider.example");
    expect(result).toEqual(buildLiveChannelPolicy("https://provider.example", ["3", "20"]));
    const [sql, values] = database.query.mock.calls[0];
    expect(sql).toMatch(/from public\.live_channel_exclusions/);
    expect(sql).toMatch(/provider_origin = \$1/);
    expect(sql).toMatch(/limit 50001/i);
    expect(values).toEqual(["https://provider.example"]);
  });

  it("does not query invalid origins and never logs secrets from database exceptions", async () => {
    const warn = vi.fn();
    expect(await loadLiveChannelPolicy("http://provider.example", { warn })).toBeUndefined();
    expect(database.query).not.toHaveBeenCalled();
    database.query.mockRejectedValue(new Error("password=secret-private-provider"));
    expect(await loadLiveChannelPolicy("https://provider.example", { warn })).toBeUndefined();
    expect(warn).toHaveBeenLastCalledWith({ code: "LIVE_POLICY_UNAVAILABLE" }, "Live channel exclusions unavailable");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-private-provider");
  });

  it("does not publish malformed database policy rows", async () => {
    const warn = vi.fn();
    database.query.mockResolvedValue({ rows: [{ stream_id: "not-a-stream" }] });
    expect(await loadLiveChannelPolicy("https://provider.example", { warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
