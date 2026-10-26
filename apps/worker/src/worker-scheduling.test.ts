import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as string[],
  hasSharedJob: true,
  trialFails: false,
  entitlementResolve: null as null | (() => void)
}));

vi.mock("./env.js", () => ({
  env: {
    APP_DEMO_MODE: false,
    RESELLER_API_BASE_URL: "https://provider.example/api",
    RESELLER_API_KEY: "test-key",
    WORKER_POLL_INTERVAL_MS: 300_000
  }
}));

vi.mock("./db.js", () => ({
  pool: {
    query: async () => ({ rows: [], rowCount: 1 }),
    connect: async () => ({
      query: async (sql: string) => ({
        rows: sql.includes("from public.shared_m3u_sync_jobs") && state.hasSharedJob
          ? [{ id: "shared-job" }]
          : [],
        rowCount: 1
      }),
      release: () => undefined
    }),
    end: async () => undefined
  }
}));

vi.mock("./auto-trial-db.js", () => ({
  createAutoTrialStore: () => ({
    claim: async () => ({ id: "trial-job" })
  })
}));

vi.mock("./auto-trial.js", () => ({
  runAutoTrialProvisioning: async () => {
    state.events.push("trial");
    if (state.trialFails) throw new Error("provider temporarily unavailable");
    return "complete";
  }
}));

vi.mock("./provider-entitlement.js", () => ({ createProviderEntitlementClient: () => ({}) }));
vi.mock("./provider-entitlement-store.js", () => ({ createProviderEntitlementStore: () => ({}) }));
vi.mock("./provider-entitlement-sync.js", () => ({
  runProviderEntitlementSyncBatch: () => new Promise<void>(resolve => { state.entitlementResolve = resolve; })
}));

vi.mock("./reseller.js", () => ({ createResellerClient: () => ({}) }));

vi.mock("./sync-job.js", () => ({
  processJob: async () => { state.events.push("shared-sync"); },
  loadSharedSourceConfig: async () => {
    state.events.push("health-sweep");
    return null;
  }
}));

describe("worker scheduling", () => {
  beforeEach(() => {
    vi.resetModules();
    state.events = [];
    state.hasSharedJob = true;
    state.trialFails = false;
    vi.spyOn(globalThis, "setInterval").mockImplementation(() => 0 as unknown as NodeJS.Timeout);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    state.entitlementResolve?.();
    vi.restoreAllMocks();
  });

  it("does not await provider entitlement network work before shared jobs", async () => {
    await import("./index.js");
    await vi.waitFor(() => expect(state.events).toContain("shared-sync"));
    expect(state.entitlementResolve).toBeTypeOf("function");
  });

  it("processes a shared M3U job in the same cycle as an automatic trial", async () => {
    await import("./index.js");

    await vi.waitFor(() => expect(state.events).toContain("shared-sync"));
    expect(state.events).toEqual(["trial", "shared-sync"]);
  });

  it("continues shared M3U work when automatic trial processing fails", async () => {
    state.trialFails = true;
    await import("./index.js");

    await vi.waitFor(() => expect(state.events).toContain("shared-sync"));
    expect(state.events).toEqual(["trial", "shared-sync"]);
  });

  it("runs the live health sweep after a trial when no shared M3U job is queued", async () => {
    state.hasSharedJob = false;
    await import("./index.js");

    await vi.waitFor(() => expect(state.events).toContain("health-sweep"));
    expect(state.events).toEqual(["trial", "health-sweep"]);
  });
});
