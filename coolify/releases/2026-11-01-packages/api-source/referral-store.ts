import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { referralProgress, rewardPeriod } from './referral-policy.js';
import { ensureStripeBillingSchema } from './stripe-billing-schema.js';
import { SALE_CATALOG_VERSION } from './stripe-sales-catalog.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z2-9]{12}$/;
const migrations = new WeakMap<Pool, Promise<void>>();

function newCode() {
  return Array.from(randomBytes(12), byte => ALPHABET[byte % ALPHABET.length]).join('');
}

type Summary = ReturnType<typeof referralProgress> & {
  code: string;
  invited: number;
  pendingRewards: number;
  history: Array<{ status: 'joined' | 'qualified'; joinedAt: string; qualifiedAt: string | null }>;
};

export class ReferralStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    let migration = migrations.get(this.pool);
    if (!migration) {
      migration = (async () => {
        await this.pool.query(`
          create table if not exists public.referral_codes (
            user_id uuid primary key references public.users(id),
            code text not null unique,
            created_at timestamptz not null default now()
          )
        `);
        await this.pool.query(`
          create table if not exists public.referral_attributions (
            invitee_user_id uuid primary key references public.users(id),
            referrer_user_id uuid not null references public.users(id),
            created_at timestamptz not null default now()
          )
        `);
        await this.pool.query(`
          create table if not exists public.referral_qualifications (
            invitee_user_id uuid primary key references public.users(id),
            referrer_user_id uuid not null references public.users(id),
            payment_request_id uuid unique references public.payment_requests(id),
            stripe_invoice_id text,
            qualified_at timestamptz not null default now()
          )
        `);
        await this.pool.query('alter table public.referral_qualifications alter column payment_request_id drop not null');
        await this.pool.query('alter table public.referral_qualifications add column if not exists stripe_invoice_id text');
        await this.pool.query('create unique index if not exists referral_qualifications_stripe_invoice on public.referral_qualifications(stripe_invoice_id)');
        await this.pool.query('alter table public.referral_qualifications add column if not exists stripe_payment_session_id text');
        await this.pool.query('create unique index if not exists referral_qualifications_stripe_payment on public.referral_qualifications(stripe_payment_session_id)');
        await this.pool.query(`
          create table if not exists public.referral_rewards (
            referrer_user_id uuid not null references public.users(id),
            milestone integer not null check (milestone > 0),
            status text not null default 'pending' check (status in ('pending', 'applied', 'review')),
            earned_at timestamptz not null default now(),
            applied_at timestamptz,
            primary key (referrer_user_id, milestone)
          )
        `);
        await this.pool.query('create index if not exists referral_qualifications_referrer on public.referral_qualifications(referrer_user_id)');
      })().catch(error => {
        migrations.delete(this.pool);
        throw error;
      });
      migrations.set(this.pool, migration);
    }
    await migration;
  }

  async codeFor(userId: string): Promise<string> {
    await this.migrate();
    const existing = await this.pool.query<{ code: string }>('select code from public.referral_codes where user_id = $1', [userId]);
    if (existing.rows[0]) return existing.rows[0].code;
    const user = await this.pool.query('select id from public.users where id = $1 and status <> $2 and deleted_at is null', [userId, 'blocked']);
    if (!user.rows[0]) throw new Error('referrer_unavailable');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.pool.query('insert into public.referral_codes(user_id, code) values($1, $2) on conflict (user_id) do nothing', [userId, newCode()]);
        const result = await this.pool.query<{ code: string }>('select code from public.referral_codes where user_id = $1', [userId]);
        if (result.rows[0]) return result.rows[0].code;
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
      }
    }
    throw new Error('referral_code_unavailable');
  }

  async attribute(inviteeId: string, code: string, client: PoolClient | Pool = this.pool): Promise<boolean> {
    await this.migrate();
    if (!CODE_PATTERN.test(code)) return false;
    const result = await client.query<{ user_id: string }>(`
      select rc.user_id from public.referral_codes rc
      join public.users u on u.id = rc.user_id
      where rc.code = $1 and u.status <> 'blocked' and u.deleted_at is null
    `, [code]);
    const referrerId = result.rows[0]?.user_id;
    if (!referrerId || referrerId === inviteeId) return false;
    const existing = await client.query('select invitee_user_id from public.referral_attributions where invitee_user_id = $1', [inviteeId]);
    if (existing.rows.length) return false;
    const inserted = await client.query(`
      insert into public.referral_attributions(invitee_user_id, referrer_user_id)
      values($1, $2) on conflict (invitee_user_id) do nothing returning invitee_user_id
    `, [inviteeId, referrerId]);
    return inserted.rows.length === 1;
  }

  async qualifyApprovedPayment(inviteeId: string, paymentId: string, client?: PoolClient): Promise<boolean> {
    await this.migrate();
    if (client) return this.qualifyInTransaction(client, inviteeId, paymentId);
    const ownClient = await this.pool.connect();
    try {
      await ownClient.query('begin');
      const result = await this.qualifyInTransaction(ownClient, inviteeId, paymentId);
      await ownClient.query('commit');
      return result;
    } catch (error) {
      await ownClient.query('rollback');
      throw error;
    } finally {
      ownClient.release();
    }
  }

  private async qualifyInTransaction(client: PoolClient, inviteeId: string, paymentId: string): Promise<boolean> {
    const attribution = await client.query<{ referrer_user_id: string }>(
      'select referrer_user_id from public.referral_attributions where invitee_user_id = $1', [inviteeId]
    );
    const referrerId = attribution.rows[0]?.referrer_user_id;
    if (!referrerId) return false;
    const existing = await client.query('select invitee_user_id from public.referral_qualifications where invitee_user_id = $1', [inviteeId]);
    if (existing.rows.length) return false;
    const referrer = await client.query('select id from public.users where id = $1 and status <> $2 and deleted_at is null for update', [referrerId, 'blocked']);
    if (!referrer.rows[0]) return false;
    const firstPayment = await client.query<{ id: string }>(
      "select id from public.payment_requests where user_id = $1 and status = 'approved' order by reviewed_at asc, id asc limit 1", [inviteeId]
    );
    if (firstPayment.rows[0]?.id !== paymentId) return false;
    const inserted = await client.query(`
      insert into public.referral_qualifications(invitee_user_id, referrer_user_id, payment_request_id)
      values($1, $2, $3) on conflict (invitee_user_id) do nothing returning invitee_user_id
    `, [inviteeId, referrerId, paymentId]);
    if (inserted.rows.length !== 1) return false;
    await this.addMilestoneIfEarned(client, referrerId);
    return true;
  }

  async qualifyFulfilledStripeInvoice(inviteeId: string, invoiceId: string): Promise<boolean> {
    await this.migrate();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const attribution = await client.query<{ referrer_user_id: string }>(
        'select referrer_user_id from public.referral_attributions where invitee_user_id = $1', [inviteeId]
      );
      const referrerId = attribution.rows[0]?.referrer_user_id;
      if (!referrerId) {
        await client.query('commit');
        return false;
      }
      const referrer = await client.query('select id from public.users where id = $1 and status <> $2 and deleted_at is null for update', [referrerId, 'blocked']);
      if (!referrer.rows[0]) {
        await client.query('commit');
        return false;
      }
      const existing = await client.query('select invitee_user_id from public.referral_qualifications where invitee_user_id = $1', [inviteeId]);
      if (existing.rows.length) {
        await client.query('commit');
        return false;
      }
      const firstInvoice = await client.query<{ stripe_invoice_id: string }>(`
        select j.stripe_invoice_id from public.stripe_invoice_jobs j
        join public.referral_attributions a on a.invitee_user_id = j.user_id
        where j.user_id = $1 and j.livemode = true and j.status = 'fulfilled'
          and j.package_slug in ('1-ay', '3-ay', '6-ay', '12-ay')
          and j.created_at >= a.created_at
        order by j.created_at asc, j.stripe_invoice_id asc limit 1
      `, [inviteeId]);
      if (firstInvoice.rows[0]?.stripe_invoice_id !== invoiceId) {
        await client.query('commit');
        return false;
      }
      const inserted = await client.query(`
        insert into public.referral_qualifications(invitee_user_id, referrer_user_id, stripe_invoice_id)
        values($1, $2, $3) on conflict (invitee_user_id) do nothing returning invitee_user_id
      `, [inviteeId, referrerId, invoiceId]);
      if (!inserted.rows.length) {
        await client.query('commit');
        return false;
      }
      await this.addMilestoneIfEarned(client, referrerId);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async qualifyFulfilledStripePayment(inviteeId: string, sessionId: string): Promise<boolean> {
    await this.migrate();
    if (!(await this.pool.query<{present:string|null}>("select to_regclass('public.stripe_payment_jobs') as present")).rows[0]?.present) return false;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const attribution = await client.query<{referrer_user_id:string}>('select referrer_user_id from public.referral_attributions where invitee_user_id=$1',[inviteeId]);
      const referrerId = attribution.rows[0]?.referrer_user_id;
      if (!referrerId || !(await client.query("select id from public.users where id=$1 and status<>'blocked' and deleted_at is null for update",[referrerId])).rows[0] ||
          (await client.query('select invitee_user_id from public.referral_qualifications where invitee_user_id=$1',[inviteeId])).rows.length) {
        await client.query('commit'); return false;
      }
      const first = await client.query<{stripe_session_id:string}>(`
        select j.stripe_session_id from public.stripe_payment_jobs j
        join public.referral_attributions a on a.invitee_user_id=j.user_id
        join public.stripe_checkout_sessions c on c.stripe_session_id=j.stripe_session_id and c.user_id=j.user_id and c.livemode=j.livemode
        where j.user_id=$1 and j.livemode=true and j.status='fulfilled' and j.payment_intent_id is not null and j.fulfilled_at is not null
          and c.sale_catalog_version=$2 and c.sale_price_id is not null and c.fulfilled_at is not null
          and c.package_slug in ('1-ay','6-ay','12-ay','1-ay-2-kullanici','6-ay-2-kullanici','12-ay-2-kullanici')
          and j.created_at>=a.created_at
        order by j.created_at,j.stripe_session_id limit 1`,[inviteeId,SALE_CATALOG_VERSION]);
      if (first.rows[0]?.stripe_session_id !== sessionId) { await client.query('commit'); return false; }
      const inserted = await client.query(`insert into public.referral_qualifications(invitee_user_id,referrer_user_id,stripe_payment_session_id)
        values($1,$2,$3) on conflict(invitee_user_id) do nothing returning invitee_user_id`,[inviteeId,referrerId,sessionId]);
      if (inserted.rows.length) await this.addMilestoneIfEarned(client,referrerId);
      await client.query('commit'); return inserted.rows.length===1;
    } catch(error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }

  private async addMilestoneIfEarned(client: PoolClient, referrerId: string): Promise<void> {
    const count = await client.query<{ total: string }>(
      'select count(*)::text as total from public.referral_qualifications where referrer_user_id = $1', [referrerId]
    );
    const qualified = Number(count.rows[0]?.total);
    if (qualified > 0 && qualified % 3 === 0) {
      await client.query(`
        insert into public.referral_rewards(referrer_user_id, milestone)
        values($1, $2) on conflict (referrer_user_id, milestone) do nothing
      `, [referrerId, qualified / 3]);
    }
  }

  async applyPendingRewards(userId: string): Promise<number> {
    await this.migrate();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const user = await client.query("select id from public.users where id = $1 and status <> 'blocked' and deleted_at is null for update", [userId]);
      if (!user.rows.length) {
        await client.query('commit');
        return 0;
      }
      const credentials = await client.query('select user_id from public.user_iptv_credentials where user_id = $1', [userId]);
      const pack = await client.query<{ id: string }>("select id from public.packages where slug = '1-ay' and is_active = true limit 1");
      if (!credentials.rows.length || !pack.rows.length) {
        await client.query('commit');
        return 0;
      }
      const rewards = await client.query<{ milestone: number }>(
        "select milestone from public.referral_rewards where referrer_user_id = $1 and status = 'pending' order by milestone asc for update", [userId]
      );
      for (const reward of rewards.rows) {
        const subscription = await client.query<{ id: string; ends_at: Date }>(
          "select id, ends_at from public.subscriptions where user_id = $1 and status = 'active' and ends_at > now() order by ends_at desc limit 1 for update", [userId]
        );
        const now = new Date();
        const period = rewardPeriod(now, subscription.rows[0]?.ends_at ? new Date(subscription.rows[0].ends_at) : null);
        if (subscription.rows[0]) {
          await client.query('update public.subscriptions set ends_at = $2 where id = $1', [subscription.rows[0].id, period.endsAt]);
        } else {
          await client.query(
            "insert into public.subscriptions(id,user_id,package_id,status,starts_at,ends_at,activated_by_admin_id) values($1,$2,$3,'active',$4,$5,'referral-reward')",
            [randomUUID(), userId, pack.rows[0].id, period.startsAt, period.endsAt]
          );
        }
        await client.query(
          "update public.referral_rewards set status = 'applied', applied_at = now() where referrer_user_id = $1 and milestone = $2 and status = 'pending'",
          [userId, reward.milestone]
        );
      }
      await client.query('commit');
      return rewards.rows.length;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async applyPendingRewardsForInvitee(inviteeId: string): Promise<number> {
    await this.migrate();
    const attribution = await this.pool.query<{ referrer_user_id: string }>(
      'select referrer_user_id from public.referral_attributions where invitee_user_id = $1', [inviteeId]
    );
    return attribution.rows[0] ? this.applyPendingRewards(attribution.rows[0].referrer_user_id) : 0;
  }

  async summary(userId: string): Promise<Summary> {
    const code = await this.codeFor(userId);
    await ensureStripeBillingSchema(this.pool);
    const missed = await this.pool.query<{ invitee_user_id: string; payment_id: string }>(`
      select a.invitee_user_id, pr.id as payment_id
      from public.referral_attributions a
      join public.payment_requests pr on pr.user_id = a.invitee_user_id and pr.status = 'approved'
      left join public.referral_qualifications q on q.invitee_user_id = a.invitee_user_id
      where a.referrer_user_id = $1 and q.invitee_user_id is null
      order by a.invitee_user_id, pr.reviewed_at asc, pr.id asc
    `, [userId]);
    const seen = new Set<string>();
    for (const row of missed.rows) {
      if (seen.has(row.invitee_user_id)) continue;
      seen.add(row.invitee_user_id);
      await this.qualifyApprovedPayment(row.invitee_user_id, row.payment_id);
    }
    const missedStripe = await this.pool.query<{ invitee_user_id: string; stripe_invoice_id: string }>(`
      select a.invitee_user_id, j.stripe_invoice_id
      from public.referral_attributions a
      join public.stripe_invoice_jobs j on j.user_id = a.invitee_user_id
        and j.livemode = true and j.status = 'fulfilled'
        and j.package_slug in ('1-ay', '3-ay', '6-ay', '12-ay')
      left join public.referral_qualifications q on q.invitee_user_id = a.invitee_user_id
      where a.referrer_user_id = $1 and q.invitee_user_id is null
        and j.created_at >= a.created_at
      order by a.invitee_user_id, j.created_at asc, j.stripe_invoice_id asc
    `, [userId]);
    const seenStripe = new Set<string>();
    for (const row of missedStripe.rows) {
      if (seenStripe.has(row.invitee_user_id)) continue;
      seenStripe.add(row.invitee_user_id);
      await this.qualifyFulfilledStripeInvoice(row.invitee_user_id, row.stripe_invoice_id);
    }
    if ((await this.pool.query<{present:string|null}>("select to_regclass('public.stripe_payment_jobs') as present")).rows[0]?.present) {
      const missedPayments = await this.pool.query<{invitee_user_id:string;stripe_session_id:string}>(`
        select a.invitee_user_id,j.stripe_session_id from public.referral_attributions a
        join public.stripe_payment_jobs j on j.user_id=a.invitee_user_id and j.livemode=true and j.status='fulfilled'
        left join public.referral_qualifications q on q.invitee_user_id=a.invitee_user_id
        where a.referrer_user_id=$1 and q.invitee_user_id is null and j.created_at>=a.created_at
        order by a.invitee_user_id,j.created_at,j.stripe_session_id`,[userId]);
      const seenPayments = new Set<string>();
      for (const row of missedPayments.rows) {
        if (seenPayments.has(row.invitee_user_id)) continue;
        seenPayments.add(row.invitee_user_id);
        await this.qualifyFulfilledStripePayment(row.invitee_user_id,row.stripe_session_id);
      }
    }
    await this.applyPendingRewards(userId);
    const counts = await this.pool.query<{ invited: string; qualified: string; pending: string }>(`
      select
        (select count(*)::text from public.referral_attributions where referrer_user_id = $1) as invited,
        (select count(*)::text from public.referral_qualifications where referrer_user_id = $1) as qualified,
        (select count(*)::text from public.referral_rewards where referrer_user_id = $1 and status = 'pending') as pending
    `, [userId]);
    const history = await this.pool.query<{ joined_at: Date; qualified_at: Date | null }>(`
      select a.created_at as joined_at, q.qualified_at
      from public.referral_attributions a
      left join public.referral_qualifications q on q.invitee_user_id = a.invitee_user_id
      where a.referrer_user_id = $1
      order by a.created_at desc, a.invitee_user_id desc
      limit 50
    `, [userId]);
    return {
      code,
      invited: Number(counts.rows[0]?.invited ?? 0),
      ...referralProgress(Number(counts.rows[0]?.qualified ?? 0)),
      pendingRewards: Number(counts.rows[0]?.pending ?? 0),
      history: history.rows.map(row => ({
        status: row.qualified_at ? 'qualified' : 'joined',
        joinedAt: new Date(row.joined_at).toISOString(),
        qualifiedAt: row.qualified_at ? new Date(row.qualified_at).toISOString() : null
      }))
    };
  }
}
