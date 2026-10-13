import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createAutoTrialStore } from "./auto-trial-db.js";
import { AutoTrialConflictError } from "./auto-trial.js";

const startedAt = Date.UTC(2026, 9, 13, 8, 0, 0);
const providerExpiry = new Date(startedAt + 2 * 60 * 60 * 1000).toISOString();
const providerLine = {
  id: "421",
  username: "PROV1234USER5678",
  password: "PASS1234CODE5678",
  expiresAt: providerExpiry
};

function fakePool(existingCredentials = false) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes("from public.auto_trial_provision_jobs") && sql.includes("for update")) {
        return { rows: [{ id: "job-1", user_id: "user-1", status: "verified", provider_line_id: "421", provider_username: providerLine.username, provider_password: providerLine.password }], rowCount: 1 };
      }
      if (sql.includes("from public.users") && sql.includes("for update")) {
        return { rows: [{ id: "user-1", status: "new", deleted_at: null }], rowCount: 1 };
      }
      if (sql.includes("from public.user_iptv_credentials")) {
        return { rows: existingCredentials ? [{ user_id: "user-1" }] : [], rowCount: existingCredentials ? 1 : 0 };
      }
      if (sql.includes("from public.subscriptions") && sql.includes("limit 1")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from public.packages")) {
        return { rows: [{ id: "package-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  return {
    statements,
    pool: { connect: async () => client, query: client.query.bind(client) } as unknown as Pool
  };
}

describe("auto trial database finalization", () => {
  it("claims only the persisted provider credentials and never the application login code", async () => {
    const { pool, statements } = fakePool();
    const claimed = await createAutoTrialStore(pool).claim();
    expect(claimed?.username).toBe(providerLine.username);
    expect(claimed?.password).toBe(providerLine.password);
    expect(statements.find((item) => item.sql.includes("from public.auto_trial_provision_jobs j"))?.sql)
      .not.toContain("kryptonite_code");
  });

  it("atomically grants unique credentials and caps the trial subscription at provider expiry", async () => {
    const { pool, statements } = fakePool();
    await createAutoTrialStore(pool, () => startedAt).complete("job-1", providerLine);

    const credentialInsert = statements.find((item) => item.sql.includes("insert into public.user_iptv_credentials"));
    expect(credentialInsert?.params).toEqual(["user-1", providerLine.username, providerLine.password]);
    const subscriptionInsert = statements.find((item) => item.sql.includes("insert into public.subscriptions"));
    expect(subscriptionInsert?.sql).toContain("trial-3h");
    expect(subscriptionInsert?.params).toContain(providerExpiry);
    expect(statements.some((item) => item.sql.toLowerCase() === "commit")).toBe(true);
  });

  it("rolls back if an administrator assigned credentials during provider creation", async () => {
    const { pool, statements } = fakePool(true);
    await expect(createAutoTrialStore(pool, () => startedAt).complete("job-1", providerLine))
      .rejects.toBeInstanceOf(AutoTrialConflictError);
    expect(statements.some((item) => item.sql.toLowerCase() === "rollback")).toBe(true);
    expect(statements.some((item) => item.sql.includes("insert into public.subscriptions"))).toBe(false);
  });
});
