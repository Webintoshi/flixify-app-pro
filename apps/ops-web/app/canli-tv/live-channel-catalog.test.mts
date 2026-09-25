import assert from "node:assert/strict";
import test from "node:test";
import * as catalog from "./live-channel-catalog.ts";

test("catalog fetches each page once and publishes only the first and completed lists", async () => {
  const requests: number[] = [];
  const progress: number[] = [];
  const loadedCounts: number[] = [];
  const load = (catalog as Record<string, unknown>).loadCatalogPages as Function;
  assert.equal(typeof load, "function");

  const result = await load({
    pageSize: 2,
    fetchPage: async ({ page }: { page: number }) => {
      requests.push(page);
      return page === 1
        ? { items: [{ id: "tr-1" }, { id: "tr-2" }], total: 3, groups: [{ title: "TR", count: 3 }] }
        : { items: [{ id: "tr-3" }], total: 3, groups: [] };
    },
    onPage: ({ items }: { items: Array<{ id: string }> }) => progress.push(items.length),
    onProgress: (loaded: number) => loadedCounts.push(loaded)
  });

  assert.deepEqual(requests, [1, 2]);
  assert.deepEqual(progress, [2, 3]);
  assert.deepEqual(loadedCounts, [2, 3]);
  assert.deepEqual(result.items.map((item: { id: string }) => item.id), ["tr-1", "tr-2", "tr-3"]);
  assert.deepEqual(result.groups, [{ title: "TR", count: 3 }]);
});

test("catalog cache reuses one account's fresh selection without exposing it to another", () => {
  let now = 1000;
  const createCache = (catalog as Record<string, unknown>).createCatalogMemoryCache as Function;
  assert.equal(typeof createCache, "function");
  const cache = createCache({ now: () => now, freshForMs: 100, maxAgeMs: 500, maxEntries: 2 });
  const snapshot = { items: [{ id: "tr-1" }], total: 1, groups: [] };

  cache.set("account-a", "tr", snapshot);
  assert.deepEqual(cache.get("account-a", "tr"), { snapshot, fresh: true });
  assert.equal(cache.get("account-b", "tr"), null);
  now = 1200;
  assert.deepEqual(cache.get("account-a", "tr"), { snapshot, fresh: false });
  now = 1600;
  assert.equal(cache.get("account-a", "tr"), null);
});

test("catalog cache keeps only the newest snapshot to bound browser memory", () => {
  const createCache = (catalog as Record<string, unknown>).createCatalogMemoryCache as Function;
  assert.equal(typeof createCache, "function");
  const cache = createCache({ maxEntries: 1 });
  const snapshot = { items: [{ id: "channel" }], total: 1, groups: [] };

  cache.set("account", "tr", snapshot);
  cache.set("account", "de", snapshot);
  assert.equal(cache.get("account", "tr"), null);
  assert.equal(cache.get("account", "de")?.fresh, true);
});

test("returning to live TV uses a fresh catalog without another network request", async () => {
  const createCache = (catalog as Record<string, unknown>).createCatalogMemoryCache as Function;
  const loadCached = (catalog as Record<string, unknown>).loadCatalogWithCache as Function;
  assert.equal(typeof loadCached, "function");
  const cache = createCache();
  let requests = 0;
  const fetchPage = async () => {
    requests += 1;
    return { items: [{ id: "one" }], total: 1, groups: [] };
  };
  const options = { cache, account: "account", scope: "live", pageSize: 200, fetchPage, onPage: () => {} };

  await loadCached(options);
  await loadCached(options);
  assert.equal(requests, 1);
});

test("a stale catalog appears immediately while it refreshes", async () => {
  const createCache = (catalog as Record<string, unknown>).createCatalogMemoryCache as Function;
  const loadCached = (catalog as Record<string, unknown>).loadCatalogWithCache as Function;
  assert.equal(typeof loadCached, "function");
  let now = 1000;
  const cache = createCache({ now: () => now, freshForMs: 100 });
  cache.set("account", "live", { items: [{ id: "old" }], total: 1, groups: [] });
  now = 1200;
  const published: string[][] = [];
  let releaseFetch: ((value: unknown) => void) | undefined;
  const fetchPage = () => new Promise((resolve) => { releaseFetch = resolve; });

  const pending = loadCached({
    cache, account: "account", scope: "live", pageSize: 200, fetchPage,
    onPage: ({ items }: { items: Array<{ id: string }> }) => published.push(items.map((item) => item.id))
  });
  assert.deepEqual(published, [["old"]]);
  releaseFetch?.({ items: [{ id: "new" }], total: 1, groups: [] });
  await pending;
  assert.deepEqual(published, [["old"], ["new"]]);
});

test("a failed refresh leaves the stale catalog available", async () => {
  const createCache = (catalog as Record<string, unknown>).createCatalogMemoryCache as Function;
  const loadCached = (catalog as Record<string, unknown>).loadCatalogWithCache as Function;
  let now = 1000;
  const cache = createCache({ now: () => now, freshForMs: 100 });
  const old = { items: [{ id: "old" }], total: 1, groups: [] };
  cache.set("account", "live", old);
  now = 1200;
  const published: string[][] = [];

  await assert.rejects(
    loadCached({
      cache, account: "account", scope: "live", pageSize: 200,
      fetchPage: async () => { throw new Error("network unavailable"); },
      onPage: ({ items }: { items: Array<{ id: string }> }) => published.push(items.map((item) => item.id))
    }),
    /network unavailable/
  );
  assert.deepEqual(published, [["old"]]);
  assert.deepEqual(cache.get("account", "live")?.snapshot, old);
});

test("an incomplete catalog is never cached", async () => {
  const createCache = (catalog as Record<string, unknown>).createCatalogMemoryCache as Function;
  const loadCached = (catalog as Record<string, unknown>).loadCatalogWithCache as Function;
  const cache = createCache();
  const requests: number[] = [];
  const load = () => loadCached({
    cache, account: "account", scope: "live", pageSize: 2,
    fetchPage: async ({ page }: { page: number }) => {
      requests.push(page);
      if (page === 2) throw new Error("second page failed");
      return { items: [{ id: "one" }, { id: "two" }], total: 4, groups: [] };
    },
    onPage: () => {}
  });

  await assert.rejects(load(), /second page failed/);
  assert.equal(cache.get("account", "live"), null);
  await assert.rejects(load(), /second page failed/);
  assert.deepEqual(requests, [1, 2, 1, 2]);
});

test("aborted catalog load does not continue to later pages", async () => {
  const load = (catalog as Record<string, unknown>).loadCatalogPages as Function;
  assert.equal(typeof load, "function");
  const controller = new AbortController();
  const requests: number[] = [];

  await assert.rejects(
    load({
      pageSize: 2,
      signal: controller.signal,
      fetchPage: async ({ page }: { page: number }) => {
        requests.push(page);
        return { items: [{ id: "1" }, { id: "2" }], total: 4, groups: [] };
      },
      onPage: () => controller.abort()
    }),
    { name: "AbortError" }
  );
  assert.deepEqual(requests, [1]);
});
