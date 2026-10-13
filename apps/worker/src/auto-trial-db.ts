import type { Pool, PoolClient } from "pg";
import {
  AutoTrialConflictError,
  computeTrialEndsAt,
  type AutoTrialJob,
  type AutoTrialStore
} from "./auto-trial.js";
import type { VerifiedProviderLine } from "./reseller.js";

type ClaimedRow = {
  id: string;
  user_id: string;
  provider_username: string;
  provider_password: string;
  create_attempted_at: string | null;
  provider_line_id: string | null;
  provider_expires_at: string | null;
};

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function createAutoTrialStore(pool: Pool, now: () => number = Date.now): AutoTrialStore & {
  claim(): Promise<AutoTrialJob | null>;
} {
  return {
    async claim() {
      return withTransaction(pool, async (client) => {
        const result = await client.query<ClaimedRow>(`
          select j.id, j.user_id, j.provider_username, j.provider_password, j.create_attempted_at,
                 j.provider_line_id, j.provider_expires_at
          from public.auto_trial_provision_jobs j
          where j.status in ('queued', 'reconcile', 'verified')
            and j.next_attempt_at <= timezone('utc', now())
            and (j.lease_until is null or j.lease_until < timezone('utc', now()))
          order by j.created_at asc
          limit 1
          for update of j skip locked
        `);
        const row = result.rows[0];
        if (!row) return null;
        await client.query(`
          update public.auto_trial_provision_jobs
          set lease_until = timezone('utc', now()) + interval '90 seconds',
              attempt_count = attempt_count + 1,
              updated_at = timezone('utc', now())
          where id = $1
        `, [row.id]);
        return {
          id: row.id,
          userId: row.user_id,
          username: row.provider_username,
          password: row.provider_password,
          createAttemptedAt: row.create_attempted_at,
          providerLineId: row.provider_line_id,
          providerExpiresAt: row.provider_expires_at
        };
      });
    },

    async isEligible(_jobId, userId) {
      const result = await pool.query<{
        status: string;
        deleted_at: string | null;
        has_credentials: boolean;
        has_subscription: boolean;
      }>(`
        select u.status, u.deleted_at,
          exists(select 1 from public.user_iptv_credentials c where c.user_id = u.id) as has_credentials,
          exists(select 1 from public.subscriptions s where s.user_id = u.id) as has_subscription
        from public.users u
        where u.id = $1
        limit 1
      `, [userId]);
      const row = result.rows[0];
      return Boolean(row && row.status === "new" && !row.deleted_at && !row.has_credentials && !row.has_subscription);
    },

    async markCreateAttempted(jobId) {
      const result = await pool.query(`
        update public.auto_trial_provision_jobs
        set create_attempted_at = timezone('utc', now()),
            status = 'reconcile',
            updated_at = timezone('utc', now())
        where id = $1 and create_attempted_at is null
      `, [jobId]);
      if (result.rowCount !== 1) {
        throw new AutoTrialConflictError("Provider creation already attempted.");
      }
    },

    async markVerified(jobId, line) {
      await pool.query(`
        update public.auto_trial_provision_jobs
        set provider_line_id = $2,
            provider_expires_at = $3,
            status = 'verified',
            updated_at = timezone('utc', now())
        where id = $1 and status in ('queued', 'reconcile', 'verified')
      `, [jobId, line.id, line.expiresAt]);
    },

    async complete(jobId, line: VerifiedProviderLine) {
      await withTransaction(pool, async (client) => {
        const jobResult = await client.query<{
          id: string;
          user_id: string;
          status: string;
          provider_line_id: string | null;
        }>(`
          select id, user_id, status, provider_line_id
          from public.auto_trial_provision_jobs
          where id = $1
          for update
        `, [jobId]);
        const job = jobResult.rows[0];
        if (!job || job.provider_line_id !== line.id || job.status !== "verified") {
          throw new AutoTrialConflictError("Trial job state changed before completion.");
        }
        const userResult = await client.query<{ status: string; deleted_at: string | null }>(`
          select status, deleted_at from public.users where id = $1 for update
        `, [job.user_id]);
        const user = userResult.rows[0];
        if (!user || user.status !== "new" || user.deleted_at) {
          throw new AutoTrialConflictError("User no longer eligible for automatic trial.");
        }
        const credentials = await client.query(`
          select user_id from public.user_iptv_credentials where user_id = $1 limit 1
        `, [job.user_id]);
        const subscriptions = await client.query(`
          select id from public.subscriptions where user_id = $1 limit 1
        `, [job.user_id]);
        if (credentials.rows.length || subscriptions.rows.length) {
          throw new AutoTrialConflictError("User received access before automatic trial completion.");
        }
        const packageResult = await client.query<{ id: string }>(`
          select id from public.packages where slug = '1-ay' and is_active = true limit 1
        `);
        const packageId = packageResult.rows[0]?.id;
        if (!packageId) throw new Error("Active base package is missing.");

        const startsAt = new Date(now()).toISOString();
        const endsAt = computeTrialEndsAt(line.expiresAt, now());
        await client.query(`
          insert into public.user_iptv_credentials (user_id, username, password)
          values ($1, $2, $3)
        `, [job.user_id, line.username, line.password]);
        await client.query(`
          insert into public.subscriptions (
            user_id, package_id, status, starts_at, ends_at,
            activated_by_admin_id, end_reason
          ) values ($1, $2, 'active', $3, $4, 'auto-trial', 'trial-3h')
        `, [job.user_id, packageId, startsAt, endsAt]);
        await client.query(`
          update public.users set status = 'active', updated_at = timezone('utc', now())
          where id = $1 and status = 'new' and deleted_at is null
        `, [job.user_id]);
        await client.query(`
          insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
          values ('auto-trial', 'activate-auto-trial-3h', 'user', $1,
                  jsonb_build_object('providerLineId', $2::text, 'durationHours', 3))
        `, [job.user_id, line.id]);
        await client.query(`
          update public.auto_trial_provision_jobs
          set status = 'completed', completed_at = timezone('utc', now()),
              lease_until = null, last_error = null,
              updated_at = timezone('utc', now())
          where id = $1
        `, [jobId]);
      });
    },

    async deferReconciliation(jobId, reason) {
      await pool.query(`
        update public.auto_trial_provision_jobs
        set status = case when reconcile_attempt_count >= 20 then 'review' else 'reconcile' end,
            reconcile_attempt_count = reconcile_attempt_count + 1,
            next_attempt_at = timezone('utc', now()) + interval '30 seconds',
            lease_until = null,
            last_error = $2,
            updated_at = timezone('utc', now())
        where id = $1 and status <> 'completed'
      `, [jobId, reason]);
    },

    async requireReview(jobId, reason) {
      await pool.query(`
        update public.auto_trial_provision_jobs
        set status = 'review', lease_until = null, last_error = $2,
            updated_at = timezone('utc', now())
        where id = $1 and status <> 'completed'
      `, [jobId, reason]);
    }
  };
}
