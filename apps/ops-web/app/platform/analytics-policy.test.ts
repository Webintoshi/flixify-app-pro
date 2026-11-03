import { describe, expect, it, vi } from "vitest";
import { createAnalyticsRuntime, sanitizeAnalyticsEvent, analyticsPage, type AnalyticsDependencies, type AnalyticsTag } from "./analytics-policy";

function fixture(stored: string | null = null) {
  const calls: unknown[][] = [];
  const memory = new Map<string, string>(stored ? [["flixify-analytics-consent-v1", stored]] : []);
  const loadTag = vi.fn(async () => (...args: unknown[]) => { calls.push(args); });
  const deps: AnalyticsDependencies = {
    storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } },
    loadConfig: vi.fn(async () => ({ schema: 1, consentVersion: 1, web: { enabled: true, measurementId: "G-TEST123456" } })),
    loadTag, disableTag: vi.fn(), clearIdentity: vi.fn(), relayConsent: vi.fn(async () => {}),
    platform: () => "web", now: () => 1000
  };
  return { calls, memory, deps, runtime: createAnalyticsRuntime(deps) };
}

describe("forced analytics acceptance and safe delivery", () => {
  it("migrates missing and rejected storage to accepted without a prompt", async () => {
    for (const stored of [null, JSON.stringify({ version: 1, choice: "rejected" })]) {
      const f = fixture(stored);
      expect(f.runtime.consent()).toBe("accepted");
      expect(f.memory.get("flixify-analytics-consent-v1")).toBe('{"version":1,"choice":"accepted"}');
      f.runtime.page("/filmler");
      await f.runtime.start();
      expect(f.deps.loadTag).toHaveBeenCalledTimes(1);
      f.memory.set("flixify-analytics-consent-v1", JSON.stringify({ version: 1, choice: "rejected" }));
      await f.runtime.syncStoredConsent();
      expect(f.runtime.consent()).toBe("accepted");
      expect(f.memory.get("flixify-analytics-consent-v1")).toBe('{"version":1,"choice":"accepted"}');
    }
  });
  it("keeps the internal rejection safety gate even though no rejection control is exposed", async () => {
    const f = fixture();
    await f.runtime.setConsent("rejected");
    f.runtime.page("/filmler?q=PRIVATE&ref=secret#HVZN");
    f.runtime.track("login", { method: "code" });
    expect(f.deps.loadTag).not.toHaveBeenCalled();
    expect(f.deps.loadConfig).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
    expect(f.runtime.attribution()).toBeUndefined();
  });
  it("drops unsafe URLs, titles and all undeclared event parameters", () => {
    expect(sanitizeAnalyticsEvent("select_content", {
      content_type: "movie", content_id: "0123456789abcdef01234567", accountCode: "PRIVATE", page_location: "https://evil.invalid/?secret=1", title: "PRIVATE", url: "https://stream.invalid/pass", reason: "https://bad.invalid"
    })).toEqual({ name: "select_content", params: { content_type: "movie", content_id: "0123456789abcdef01234567" } });
    expect(sanitizeAnalyticsEvent("purchase", { value: 999 })).toBeNull();
    expect(sanitizeAnalyticsEvent("search", { query_length: 999999, result_count: -1, search_term: "user@example.invalid" })).toEqual({ name: "search", params: { query_length: 512 } });
  });
  it("only permits known public routes and static titles", () => {
    expect(analyticsPage("/odeme-sonucu?session_id=cs_private#token")).toEqual({ path: "/odeme-sonucu", title: "Ödeme sonucu" });
    expect(analyticsPage("/admin/kullanicilar?code=private")).toBeNull();
    expect(analyticsPage("/unknown/PRIVATE")).toBeNull();
  });
  it("keeps readable public catalogue names while rejecting secret-bearing provider labels", () => {
    expect(sanitizeAnalyticsEvent("select_content", { content_name: "  Şebeke (2023)  ", category_name: "TR: Yerli Diziler" })?.params).toEqual({ content_name: "Şebeke (2023)", category_name: "TR: Yerli Diziler" });
    for (const value of ["https://private.invalid/pass", "https:private", "ftp:private", "file:/private", "data:private", "javascript:private", "www.private.invalid", "user@example.invalid", "username=private", "password:private", "token=private", "secret=private", "session_id=cs_private", "%73ecret", "Film\nözel", "Film\u202esaklı", "Film\u2028özel", "Film\u2029özel", "Kod ABCD1234EFGH5678"]) {
      expect(sanitizeAnalyticsEvent("select_content", { content_name: value, category_name: value, content_type: "movie" })?.params).toEqual({ content_type: "movie" });
    }
    expect(sanitizeAnalyticsEvent("select_content", { content_name: "Secret Window", category_name: "Session 9" })?.params).toEqual({ content_name: "Secret Window", category_name: "Session 9" });
    expect(Array.from(sanitizeAnalyticsEvent("select_content", { content_name: "Ö".repeat(120), category_name: "Ç".repeat(120) })?.params.content_name as string)).toHaveLength(100);
    expect(Array.from(sanitizeAnalyticsEvent("select_content", { category_name: "Ç".repeat(120) })?.params.category_name as string)).toHaveLength(80);
  });
  it("loads once, deduplicates initial route replay and never replays rejected actions", async () => {
    const f = fixture();
    f.runtime.track("login");
    f.runtime.page("/filmler?q=private");
    await Promise.all([f.runtime.setConsent("accepted"), f.runtime.setConsent("accepted")]);
    f.runtime.page("/filmler?q=another#private");
    f.runtime.page("/diziler");
    f.runtime.track("search", { query_length: 8, result_count: 5, search_term: "PRIVATE" });
    expect(f.deps.loadTag).toHaveBeenCalledTimes(1);
    const events = f.calls.filter(call => call[0] === "event");
    expect(events.map(call => call[1])).toEqual(["page_view", "page_view", "search"]);
    expect(JSON.stringify(f.calls)).not.toContain("private");
    expect(JSON.stringify(f.calls)).not.toContain("PRIVATE");
    expect(f.calls.find(call => call[0] === "config")?.[2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    expect(events[0][2]).toMatchObject({ page_location: "https://flixify.vip/filmler", page_referrer: "", page_title: "Filmler", screen_name: "movies", client_platform: "web" });
  });
  it("does not let a late script/configuration response reactivate withdrawn consent", async () => {
    const f = fixture();
    let resolve!: (tag: (...args: unknown[]) => void) => void;
    f.deps.loadTag = vi.fn(() => new Promise<AnalyticsTag>(done => { resolve = done; }));
    const runtime = createAnalyticsRuntime(f.deps);
    runtime.page("/");
    const loading = runtime.setConsent("accepted");
    await Promise.resolve(); await Promise.resolve();
    await runtime.setConsent("rejected");
    resolve((...args: unknown[]) => { f.calls.push(args); });
    await loading;
    runtime.track("login");
    expect(f.calls.filter(call => call[0] === "event")).toEqual([]);
    expect(runtime.attribution()).toBeUndefined();
    expect(f.deps.clearIdentity).toHaveBeenCalled();
  });
  it("revokes the cached consented checkout attribution and pending events", async () => {
    const f = fixture(); f.runtime.page("/"); await f.runtime.setConsent("accepted");
    f.runtime.setAttribution("123456.789012", 1700000000);
    expect(f.runtime.attribution()).toEqual({ consentVersion: 1, clientId: "123456.789012", sessionId: 1700000000, clientPlatform: "web" });
    await f.runtime.setConsent("rejected");
    f.runtime.track("login");
    expect(f.runtime.attribution()).toBeUndefined();
    expect(f.deps.relayConsent).toHaveBeenCalledWith("123456.789012", "rejected");
    expect(f.calls.filter(call => call[0] === "event").map(call => call[1])).toEqual(["page_view"]);
  });
  it("fails disabled and never makes checkout wait for unavailable Google", async () => {
    const f = fixture(); f.deps.loadConfig = vi.fn(async () => { throw new Error("offline"); });
    const runtime = createAnalyticsRuntime(f.deps);
    await runtime.setConsent("accepted");
    expect(runtime.attribution()).toBeUndefined();
    expect(f.deps.loadTag).not.toHaveBeenCalled();
    runtime.track("login");
    expect(f.calls).toEqual([]);
  });
  it("only admits bounded safe checkout IDs and restores a versioned choice", async () => {
    const f = fixture(JSON.stringify({ version: 1, choice: "accepted" }));
    f.runtime.page("/");
    await f.runtime.start();
    f.runtime.setAttribution("cs_private?secret=1", 42);
    expect(f.runtime.attribution()).toBeUndefined();
    f.runtime.setAttribution("123.456", Number.MAX_SAFE_INTEGER + 1);
    expect(f.runtime.attribution()).toBeUndefined();
    expect(f.runtime.consent()).toBe("accepted");
  });
  it("does not let a withdrawn old load disable a newer consented session", async () => {
    const f = fixture();
    const pending: ((tag: AnalyticsTag) => void)[] = [];
    f.deps.loadTag = vi.fn(() => new Promise<AnalyticsTag>(resolve => { pending.push(resolve); }));
    const runtime = createAnalyticsRuntime(f.deps); runtime.page("/filmler");
    const old = runtime.setConsent("accepted"); await Promise.resolve(); await Promise.resolve();
    await runtime.setConsent("rejected");
    const fresh = runtime.setConsent("accepted"); await Promise.resolve(); await Promise.resolve();
    pending[1]((...args) => { f.calls.push(args); }); await fresh;
    pending[0]((...args) => { f.calls.push(args); }); await old;
    expect(f.deps.disableTag).toHaveBeenLastCalledWith("G-TEST123456", false);
    expect(f.calls.filter(call => call[0] === "event" && call[1] === "page_view")).toHaveLength(1);
  });
  it("disables the existing tag on private/admin/unknown routes", async () => {
    const f = fixture(); f.runtime.page("/filmler"); await f.runtime.setConsent("accepted");
    f.runtime.page("/admin/kullanicilar?secret=1"); f.runtime.track("login");
    expect(f.deps.disableTag).toHaveBeenLastCalledWith("G-TEST123456", true);
    f.runtime.page("/filmler");
    expect(f.deps.disableTag).toHaveBeenLastCalledWith("G-TEST123456", false);
    expect(f.calls.filter(call => call[0] === "event")).toHaveLength(2);
  });
  it("overrides a rejected value saved by another tab", async () => {
    const f = fixture(); f.runtime.page("/"); await f.runtime.setConsent("accepted");
    f.memory.set("flixify-analytics-consent-v1", JSON.stringify({ version: 1, choice: "rejected" }));
    await f.runtime.syncStoredConsent(); f.runtime.track("login");
    expect(f.runtime.consent()).toBe("accepted");
    expect(f.memory.get("flixify-analytics-consent-v1")).toBe('{"version":1,"choice":"accepted"}');
    expect(f.calls.filter(call => call[0] === "event").map(call => call[1])).toEqual(["page_view", "login"]);
  });
  it("keeps queued event route context while the script is still loading", async () => {
    const f = fixture();
    let resolve!: (tag: AnalyticsTag) => void;
    f.deps.loadTag = vi.fn(() => new Promise<AnalyticsTag>(done => { resolve = done; }));
    const runtime = createAnalyticsRuntime(f.deps); runtime.page("/kayit-ol");
    const loading = runtime.setConsent("accepted"); await Promise.resolve(); await Promise.resolve();
    runtime.track("sign_up", { method: "account_code" }); runtime.page("/");
    resolve((...args) => { f.calls.push(args); }); await loading;
    expect(f.calls.find(call => call[0] === "event" && call[1] === "sign_up")?.[2]).toMatchObject({ page_location: "https://flixify.vip/kayit-ol", page_title: "Hesap oluştur" });
  });
  it("never uses an old SDK session snapshot to attribute a later checkout", async () => {
    const f = fixture(); let now = 1000; f.deps.now = () => now;
    const runtime = createAnalyticsRuntime(f.deps); runtime.page("/paketler"); await runtime.setConsent("accepted");
    runtime.setAttribution("123.456", 1700000000); expect(runtime.attribution()).toBeDefined();
    now += 26 * 60_000;
    expect(runtime.attribution()).toBeUndefined();
    runtime.setAttribution("123.456", 1700001800);
    expect(runtime.attribution()?.sessionId).toBe(1700001800);
  });
});
