import { describe, expect, it, vi } from "vitest";
import { createLegacyLiveCatalogLoader, type LegacyLiveItem } from "./legacy-live-catalog";

const channel = (id: string, title: string, groupTitle = "TR | Ulusal"): LegacyLiveItem => ({
  id, title, kind: "live", groupTitle, logoUrl: `/${id}.png`, transport: "hls", healthStatus: "healthy", variantGroupKey: "raw-variant"
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe("complete legacy live catalog projection", () => {
  it("selects a later-page FHD globally before publishing and preserves the raw DTO", async () => {
    const rows = [channel("41", "TR | ATV HD"), channel("44", "TR | TRT1"), channel("42", "TR | Atv FHD")];
    const saved = JSON.stringify(rows), later = deferred<{ items: LegacyLiveItem[]; total: number }>();
    const request = vi.fn(async (path: string) => new URL(path, "https://fixture.invalid").searchParams.get("page") === "1" ? { items: rows.slice(0, 2), total: 3 } : later.promise);
    const load = createLegacyLiveCatalogLoader({ request, pageSize: 2 });
    const onPage = vi.fn();
    const pending = load({ accountId: "owner", accessToken: "captured", onPage });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(onPage).not.toHaveBeenCalled();
    later.resolve({ items: rows.slice(2), total: 3 });
    const result = await pending;
    expect(result.items.map(item => [item.id, item.title])).toEqual([["42", "ATV"], ["44", "TRT1"]]);
    expect(Object.fromEntries(result.canonicalById)).toEqual({ "41": "42", "42": "42", "44": "44" });
    expect(result.groups).toEqual([{ title: "TR | Ulusal", count: 2 }]);
    expect(result.total).toBe(2); expect(onPage).toHaveBeenCalledExactlyOnceWith(result);
    expect(result.items[0]).toMatchObject({ sourceTitle: rows[2].title, logoUrl: "/42.png", transport: "hls", healthStatus: "healthy", variantGroupKey: "raw-variant" });
    expect(result.rawItems).toEqual(rows);
    expect(result.rawItems.map(item => item.id)).toEqual(["41", "44", "42"]);
    expect(JSON.stringify(rows)).toBe(saved);
  });

  it("reuses raw full pools while applying current exclusions to warm projections", async () => {
    const rows = [channel("41", "TR | ATV HD"), channel("42", "TR | ATV FHD")];
    const request = vi.fn(async () => ({ items: rows, total: 2 }));
    const load = createLegacyLiveCatalogLoader({ request });
    expect((await load({ accountId: "owner", accessToken: "a" })).items[0].id).toBe("42");
    const result = await load({ accountId: "owner", accessToken: "a", excludedIds: new Set(["42"]) });
    expect(result.items.map(item => [item.id, item.title])).toEqual([["41", "ATV"]]);
    expect(Object.fromEntries(result.canonicalById)).toEqual({ "41": "41" });
    expect(result.rawItems.map(item => item.id)).toEqual(["41"]);
    expect((await load({ accountId: "owner", accessToken: "a" })).rawItems.map(item => item.id)).toEqual(["41", "42"]);
    expect(request).toHaveBeenCalledOnce(); expect(rows[0].title).toBe("TR | ATV HD");
  });

  it("binds every page to its captured token and keeps accounts and sources separate", async () => {
    const request = vi.fn(async (_path: string, options: { accessToken: string }) => ({ items: [channel(options.accessToken, "TR | TRT1")], total: 1 }));
    const load = createLegacyLiveCatalogLoader({ request });
    const a = await load({ accountId: "a", accessToken: "token-a", sourceScope: "source-1" });
    const b = await load({ accountId: "b", accessToken: "token-b", sourceScope: "source-1" });
    const c = await load({ accountId: "a", accessToken: "token-c", sourceScope: "source-2" });
    expect([a.items[0].id, b.items[0].id, c.items[0].id]).toEqual(["token-a", "token-b", "token-c"]);
    expect(request).toHaveBeenCalledTimes(3);
    for (const [, options] of request.mock.calls) expect(options).toMatchObject({ skipAuthRefresh: true, signal: expect.any(AbortSignal) });
    expect(request.mock.calls.map(([, options]) => options.accessToken)).toEqual(["token-a", "token-b", "token-c"]);
  });

  it("does not cache or publish a cancelled response even when transport ignores abort", async () => {
    const late = deferred<{ items: LegacyLiveItem[]; total: number }>();
    const request = vi.fn().mockReturnValueOnce(late.promise).mockResolvedValue({ items: [channel("new", "TR | TRT1")], total: 1 });
    const load = createLegacyLiveCatalogLoader({ request });
    const controller = new AbortController(), onPage = vi.fn();
    const pending = load({ accountId: "owner", accessToken: "old", signal: controller.signal, onPage });
    const rejection = expect(pending).rejects.toThrow();
    controller.abort(); late.resolve({ items: [channel("old", "TR | TRT1")], total: 1 });
    await rejection; expect(onPage).not.toHaveBeenCalled();
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    expect((await load({ accountId: "owner", accessToken: "new" })).items[0].id).toBe("new");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("checks an aborted owner before serving a complete warm cache", async () => {
    const request = vi.fn(async () => ({ items: [channel("44", "TR | TRT1")], total: 1 }));
    const load = createLegacyLiveCatalogLoader({ request });
    await load({ accountId: "owner", accessToken: "a" });
    const controller = new AbortController(); controller.abort(); const onPage = vi.fn();
    await expect(load({ accountId: "owner", accessToken: "a", signal: controller.signal, onPage })).rejects.toThrow();
    expect(onPage).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledOnce();
  });
});
