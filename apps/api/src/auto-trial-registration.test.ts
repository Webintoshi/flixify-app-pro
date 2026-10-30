import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const state = { users: [] as string[], jobs: [] as { userId: string; username: string; password: string }[], statements: [] as string[], quotaParameters: [] as unknown[], failJobInsert: false, quotaAllowed: true, hashedIp: "" };
  return {
    state,
    query: vi.fn(async (): Promise<{ rows: unknown[]; rowCount: number }> => ({ rows: [], rowCount: 0 })),
    withTransaction: vi.fn(async (handler: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
      const usersBefore = [...state.users];
      const jobsBefore = [...state.jobs];
      const client = {
        async query(sql: string, params: unknown[] = []) {
          state.statements.push(sql);
          if (sql.includes("insert into public.registration_trial_ip_quota")) {
            state.hashedIp = String(params[0]);
            state.quotaParameters = [...params];
            return { rows: state.quotaAllowed ? [{ count: 1 }] : [], rowCount: state.quotaAllowed ? 1 : 0 };
          }
          if (sql.includes("insert into public.users")) {
            state.users.push("user-1");
            return { rows: [{ id: "user-1" }], rowCount: 1 };
          }
          if (sql.includes("insert into public.auto_trial_provision_jobs")) {
            if (state.failJobInsert) throw new Error("job insert failed");
            state.jobs.push({ userId: String(params[0]), username: String(params[1]), password: String(params[2]) });
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
      };
      try {
        return await handler(client);
      } catch (error) {
        state.users = usersBefore;
        state.jobs = jobsBefore;
        throw error;
      }
    })
  };
});

vi.mock("./db.js", () => ({ query: db.query, withTransaction: db.withTransaction }));

import { AutoTrialRegistrationRateLimitError, createUser, getUserContext, updateAppSettings } from "./repository.js";
import { env } from "./env.js";

const originalDailyLimit = env.AUTO_TRIAL_DAILY_IP_LIMIT;

describe("new account automatic trial enqueue", () => {
  beforeEach(() => {
    db.state.users = [];
    db.state.jobs = [];
    db.state.statements = [];
    db.state.quotaParameters = [];
    db.state.failJobInsert = false;
    db.state.quotaAllowed = true;
    db.state.hashedIp = "";
    env.AUTO_TRIAL_DAILY_IP_LIMIT = 1000;
    db.withTransaction.mockClear();
  });

  afterEach(() => {
    env.AUTO_TRIAL_DAILY_IP_LIMIT = originalDailyLimit;
  });

  it("creates exactly one durable trial job with the new account in the same transaction", async () => {
    const userId = await createUser("lookup", "hash", "5678", "ABCD1234EFGH5678", "installation-1", "203.0.113.7");
    expect(userId).toBe("user-1");
    expect(db.state.users).toEqual(["user-1"]);
    expect(db.state.jobs).toHaveLength(1);
    expect(db.state.jobs[0]?.userId).toBe("user-1");
    expect(db.state.jobs[0]?.username).toMatch(/^[A-Z0-9]{16}$/);
    expect(db.state.jobs[0]?.password).toMatch(/^[A-Z0-9]{16}$/);
    expect(db.state.jobs[0]?.username).not.toBe("ABCD1234EFGH5678");
    expect(db.state.jobs[0]?.password).not.toBe("ABCD1234EFGH5678");
    expect(db.state.jobs[0]?.username).not.toBe(db.state.jobs[0]?.password);
    expect(db.state.hashedIp).toMatch(/^[0-9a-f]{64}$/);
    expect(db.state.hashedIp).not.toContain("203.0.113.7");
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not leave a registered account without a trial job if the queue insert fails", async () => {
    db.state.failJobInsert = true;
    await expect(createUser("lookup", "hash", "5678", "ABCD1234EFGH5678", "installation-1", "203.0.113.7"))
      .rejects.toThrow("job insert failed");
    expect(db.state.users).toEqual([]);
    expect(db.state.jobs).toEqual([]);
  });

  it("rejects a registration at the daily IP quota before creating the account", async () => {
    db.state.quotaAllowed = false;
    await expect(createUser("lookup", "hash", "5678", "ABCD1234EFGH5678", "installation-1", "203.0.113.7"))
      .rejects.toBeInstanceOf(AutoTrialRegistrationRateLimitError);
    expect(db.state.users).toEqual([]);
    expect(db.state.jobs).toEqual([]);
  });

  it.each([1000, 2500])("binds the configured %i registration cap to the atomic IP quota write", async (limit) => {
    env.AUTO_TRIAL_DAILY_IP_LIMIT = limit;
    await createUser("lookup", "hash", "5678", "ABCD1234EFGH5678", "installation-1", "203.0.113.7");

    expect(db.state.quotaParameters).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), limit]);
    const quotaWrites = db.state.statements.filter((sql) => sql.includes("insert into public.registration_trial_ip_quota"));
    expect(quotaWrites).toHaveLength(1);
    expect(quotaWrites[0]).toMatch(/on conflict\s*\(ip_hash\)\s*do update/i);
    expect(quotaWrites[0]).toMatch(/registration_trial_ip_quota\.count\s*<\s*\$2::integer/);
    expect(quotaWrites[0]).not.toMatch(/registration_trial_ip_quota\.count\s*<\s*\d/);
    expect(quotaWrites[0]).toMatch(/window_started_at\s*<=\s*now\(\)\s*-\s*interval '24 hours' then 1/);
    expect(quotaWrites[0]).toMatch(/else registration_trial_ip_quota\.count\s*\+\s*1/);
    expect(db.state.statements[0]).toBe(quotaWrites[0]);
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
  });

  it("preserves a live trial's personal IPTV credentials when shared settings change", async () => {
    await updateAppSettings({
      supportWhatsappUrl: "https://wa.me/905555555555",
      supportTelegramUrl: "https://t.me/flixify",
      salesPortalUrl: null,
      heroTitle: "Flixify",
      heroSubtitle: "",
      sharedPlaylistUrl: "http://provider.example/get.php?username=shared-user&password=shared-pass&type=m3u_plus&output=ts"
    }, "admin-1");
    const credentialUpdate = db.state.statements.find((sql) => sql.includes("insert into public.user_iptv_credentials"));
    expect(credentialUpdate).toMatch(/not exists\s*\(\s*select 1\s*from public\.subscriptions s_trial[\s\S]*s_trial\.end_reason = 'trial-3h'/i);
  });

  it("exposes the exact trial cutoff to playback authorization", async () => {
    const endsAt = "2026-10-13T11:00:00.000Z";
    db.query.mockResolvedValueOnce({
      rows: [{
        id: "user-1", status: "active", created_at: "2026-10-13T08:00:00.000Z",
        last_login_at: null, kryptonite_code: "ABCD1234EFGH5678", code_suffix: "5678",
        source_status: "ready", current_snapshot_version: 1,
        source_base_url: "https://provider.example", source_playlist_path: "get.php",
        source_playlist_suffix: "type=m3u_plus", source_reference_username: "reference",
        source_reference_password: "reference-password", iptv_username: "PROV1234USER5678",
        iptv_password: "PASS1234CODE5678", package_id: "package-1",
        package_title: "3 Saat Deneme", package_duration: "1m", ends_at: new Date(endsAt),
        subscription_end_reason: "trial-3h", has_used_trial: true,
        has_expired_subscription: false
      }], rowCount: 1
    });

    const context = await getUserContext("user-1");
    expect(context.canPlay).toBe(true);
    expect(context.accessUntil).toBe(endsAt);
    expect(context.isThreeHourTrial).toBe(true);
  });

  it("shows a newly registered user's automatic trial as pending while provisioning", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: "user-1", status: "new", created_at: "2026-10-13T08:00:00.000Z",
        last_login_at: null, kryptonite_code: "ABCD1234EFGH5678", code_suffix: "5678",
        source_status: "ready", current_snapshot_version: 1,
        source_base_url: "https://provider.example", source_playlist_path: "get.php",
        source_playlist_suffix: "type=m3u_plus", source_reference_username: "reference",
        source_reference_password: "reference-password", iptv_username: null,
        iptv_password: null, package_id: null, package_title: null,
        package_duration: null, ends_at: null, subscription_end_reason: null,
        trial_provision_status: "queued", has_used_trial: false, has_expired_subscription: false
      }], rowCount: 1
    });

    const context = await getUserContext("user-1");
    expect(context.summary.trialProvisionStatus).toBe("pending");
    expect(context.summary.popup).toBeNull();
  });
});
