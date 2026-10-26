import { describe, expect, it } from "vitest";
import { createResellerClient } from "./reseller.js";
import { AutoTrialConflictError, computeTrialEndsAt, runAutoTrialProvisioning, type AutoTrialJob, type AutoTrialStore } from "./auto-trial.js";

const USERNAME = "PROV1234USER5678";
const PASSWORD = "PASS1234CODE5678";
const LOGIN_CODE = "ABCD1234EFGH5678";
const NOW = Date.UTC(2026, 9, 13, 8, 0, 0);
const EXPIRY = Math.floor((NOW + 3 * 60 * 60 * 1000) / 1000);

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: "421",
    username: USERNAME,
    password: PASSWORD,
    exp_date: String(EXPIRY),
    is_trial: "1",
    enabled: "1",
    admin_enabled: "1",
    private_cdn: "1",
    reseller_notes: "Flixify auto trial user:user-1",
    ...overrides
  };
}

function fakeResponse(data: unknown, status = "STATUS_SUCCESS") {
  return new Response(JSON.stringify({ status, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function fakeLookupResponse(value: unknown, init?: RequestInit) {
  return fakeResponse(new URLSearchParams(String(init?.body)).get("action") === "get_line" ? value : [value]);
}

describe("reseller three-hour trial", () => {
  it("finds only the exact username and accepts a verified three-hour trial line", async () => {
    const requests: URLSearchParams[] = [];
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        const request = new URLSearchParams(String(init?.body));
        requests.push(request);
        return fakeResponse(request.get("action") === "get_line" ? line() : [
          { id: "420", username: "OTHER1234USER5678" },
          { id: "421", username: USERNAME }
        ]);
      }
    });

    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).resolves.toEqual({
      id: "421",
      username: USERNAME,
      password: PASSWORD,
      expiresAt: new Date(EXPIRY * 1000).toISOString()
    });
    expect(requests[0]?.get("action")).toBe("get_lines");
    expect(requests[0]?.get("line_username")).toBe(USERNAME);
    expect(Object.fromEntries(requests[1] ?? new URLSearchParams())).toEqual({
      api_key: "test-only-key",
      action: "get_line",
      id: "421"
    });
  });

  it("refuses a detail response whose line ID differs from the exact listing match", async () => {
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => fakeResponse(
        new URLSearchParams(String(init?.body)).get("action") === "get_line" ? line({ id: "422" }) : [line()]
      )
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/id.*mismatch/i);
  });

  it.each(["invalid", ""])("refuses an exact listing match with invalid provider ID %s", async (id) => {
    const requests: string[] = [];
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        requests.push(new URLSearchParams(String(init?.body)).get("action") ?? "");
        return fakeResponse([line({ id })]);
      }
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/id.*invalid/i);
    expect(requests).toEqual(["get_lines"]);
  });

  it("refuses a mismatched password rather than granting another line", async () => {
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => fakeLookupResponse(line({ password: "different" }), init)
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/password/i);
  });

  it("refuses a line whose provider expiry exceeds three hours", async () => {
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => fakeLookupResponse(line({ exp_date: String(EXPIRY + 24 * 60 * 60) }), init)
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/expiry/i);
  });

  it("refuses a stale preexisting trial line with little time remaining", async () => {
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => fakeLookupResponse(line({ exp_date: String(Math.floor((NOW + 10 * 60 * 1000) / 1000)) }), init)
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/expiry/i);
  });

  it("refuses an existing line without the expected account ownership note", async () => {
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => fakeLookupResponse(line({ reseller_notes: "another account" }), init)
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/ownership/i);
  });

  it.each(["0", undefined, "true"])("refuses a trial whose Private CDN state is %s", async (privateCdn) => {
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => fakeLookupResponse(line({ private_cdn: privateCdn }), init)
    });
    await expect(client.findExactLine(USERNAME, PASSWORD, "user-1")).rejects.toThrow(/private cdn/i);
  });

  it("creates provider package 4 with Private CDN, EPG, and separate provider credentials", async () => {
    const requests: URLSearchParams[] = [];
    const client = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        requests.push(new URLSearchParams(String(init?.body)));
        return fakeResponse(line());
      }
    });

    await client.createThreeHourTrial({ userId: "user-1", username: USERNAME, password: PASSWORD });
    expect(Object.fromEntries(requests[0] ?? new URLSearchParams())).toMatchObject({
      action: "create_line",
      package: "4",
      trial: "1",
      private_cdn: "1",
      allow_epg: "1",
      username: USERNAME,
      password: PASSWORD,
      reseller_notes: "Flixify auto trial user:user-1"
    });
    expect(USERNAME).not.toBe(LOGIN_CODE);
    expect(PASSWORD).not.toBe(LOGIN_CODE);
  });
});

type StoreState = {
  eligible: boolean;
  attempted: boolean;
  verified: boolean;
  completed: boolean;
  deferred: boolean;
  review: boolean;
};

function makeStore(state: StoreState): AutoTrialStore {
  return {
    async isEligible() { return state.eligible; },
    async markCreateAttempted() { state.attempted = true; },
    async markVerified() { state.verified = true; },
    async complete() { state.completed = true; },
    async deferReconciliation() { state.deferred = true; },
    async requireReview() { state.review = true; }
  };
}

function job(overrides: Partial<AutoTrialJob> = {}): AutoTrialJob {
  return {
    id: "job-1",
    userId: "user-1",
    username: USERNAME,
    password: PASSWORD,
    createAttemptedAt: null,
    providerLineId: null,
    providerExpiresAt: null,
    ...overrides
  };
}

describe("automatic trial provisioning", () => {
  it("holds a provider trial for review before granting access when Private CDN is disabled", async () => {
    const state = { eligible: true, attempted: false, verified: false, completed: false, deferred: false, review: false };
    let lineExists = false;
    const provider = createResellerClient({
      url: "https://provider.example/reseller/index.php",
      apiKey: "test-only-key",
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        const action = new URLSearchParams(String(init?.body)).get("action");
        if (action === "create_line") {
          lineExists = true;
          return fakeResponse(line({ private_cdn: "0" }));
        }
        if (action === "get_line") return fakeResponse(line({ private_cdn: "0" }));
        return fakeResponse(lineExists ? [{ id: "421", username: USERNAME }] : []);
      }
    });

    await expect(runAutoTrialProvisioning(job(), makeStore(state), provider)).resolves.toBe("review");
    expect(state).toEqual({ eligible: true, attempted: true, verified: false, completed: false, deferred: false, review: true });
  });

  it("marks create attempted before contacting the provider and completes only after exact lookup", async () => {
    const state = { eligible: true, attempted: false, verified: false, completed: false, deferred: false, review: false };
    let lineExists = false;
    const result = await runAutoTrialProvisioning(job(), makeStore(state), {
      async findExactLine(username, password, userId) {
        expect({ username, password, userId }).toEqual({ username: USERNAME, password: PASSWORD, userId: "user-1" });
        return lineExists ? { id: "421", username: USERNAME, password: PASSWORD, expiresAt: new Date(EXPIRY * 1000).toISOString() } : null;
      },
      async createThreeHourTrial(input) {
        expect(state.attempted).toBe(true);
        expect(input).toEqual({ userId: "user-1", username: USERNAME, password: PASSWORD });
        lineExists = true;
      }
    });
    expect(result).toBe("complete");
    expect(state).toEqual({ eligible: true, attempted: true, verified: true, completed: true, deferred: false, review: false });
  });

  it("never issues a second create after an ambiguous first attempt", async () => {
    const state = { eligible: true, attempted: false, verified: false, completed: false, deferred: false, review: false };
    let createCalls = 0;
    const result = await runAutoTrialProvisioning(
      job({ createAttemptedAt: new Date(NOW - 60_000).toISOString() }),
      makeStore(state),
      {
        async findExactLine() { return null; },
        async createThreeHourTrial() { createCalls += 1; }
      }
    );
    expect(result).toBe("reconcile");
    expect(createCalls).toBe(0);
    expect(state.deferred).toBe(true);
  });

  it("reconciles an already created line after a database verification failure without a second create", async () => {
    const state = { eligible: true, attempted: false, verified: false, completed: false, deferred: false, review: false };
    let lineExists = false;
    let createCalls = 0;
    let verifyCalls = 0;
    const store = makeStore(state);
    store.markVerified = async () => {
      verifyCalls += 1;
      if (verifyCalls === 1) throw new Error("database temporarily unavailable");
      state.verified = true;
    };
    const provider = {
      async findExactLine() {
        return lineExists ? { id: "421", username: USERNAME, password: PASSWORD, expiresAt: new Date(EXPIRY * 1000).toISOString() } : null;
      },
      async createThreeHourTrial() { createCalls += 1; lineExists = true; }
    };
    expect(await runAutoTrialProvisioning(job(), store, provider)).toBe("reconcile");
    expect(await runAutoTrialProvisioning(job({ createAttemptedAt: new Date(NOW).toISOString() }), store, provider))
      .toBe("complete");
    expect(createCalls).toBe(1);
    expect(state.completed).toBe(true);
  });

  it("never creates a line when exact existing credentials are found", async () => {
    const state = { eligible: true, attempted: false, verified: false, completed: false, deferred: false, review: false };
    let createCalls = 0;
    const result = await runAutoTrialProvisioning(job(), makeStore(state), {
      async findExactLine() { return { id: "421", username: USERNAME, password: PASSWORD, expiresAt: new Date(EXPIRY * 1000).toISOString() }; },
      async createThreeHourTrial() { createCalls += 1; }
    });
    expect(result).toBe("complete");
    expect(createCalls).toBe(0);
    expect(state.completed).toBe(true);
  });

  it("skips a user already assigned by an administrator before contacting the provider", async () => {
    const state = { eligible: false, attempted: false, verified: false, completed: false, deferred: false, review: false };
    let contactedProvider = false;
    const result = await runAutoTrialProvisioning(job(), makeStore(state), {
      async findExactLine() { contactedProvider = true; return null; },
      async createThreeHourTrial() { contactedProvider = true; }
    });
    expect(result).toBe("review");
    expect(contactedProvider).toBe(false);
    expect(state.review).toBe(true);
  });

  it("caps Flixify expiry at the earlier of provider expiry and three hours", () => {
    expect(computeTrialEndsAt(new Date(NOW + 2 * 60 * 60 * 1000).toISOString(), NOW))
      .toBe(new Date(NOW + 2 * 60 * 60 * 1000).toISOString());
    expect(computeTrialEndsAt(new Date(NOW + 4 * 60 * 60 * 1000).toISOString(), NOW))
      .toBe(new Date(NOW + 3 * 60 * 60 * 1000).toISOString());
  });

  it("holds a created provider line for review when an admin assigns access during provisioning", async () => {
    const state = { eligible: true, attempted: false, verified: false, completed: false, deferred: false, review: false };
    const store = makeStore(state);
    store.complete = async () => { throw new AutoTrialConflictError("User already assigned"); };
    const result = await runAutoTrialProvisioning(job(), store, {
      async findExactLine() { return { id: "421", username: USERNAME, password: PASSWORD, expiresAt: new Date(EXPIRY * 1000).toISOString() }; },
      async createThreeHourTrial() { throw new Error("must not create"); }
    });
    expect(result).toBe("review");
    expect(state.review).toBe(true);
    expect(state.deferred).toBe(false);
  });
});
