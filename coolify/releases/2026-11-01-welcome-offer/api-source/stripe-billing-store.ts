import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PackageSlug } from './stripe-billing-policy.js';
import { ensureStripeBillingSchema } from './stripe-billing-schema.js';
import type { StripeBillingRouteStore } from './stripe-billing-routes.js';
import type { StripeWebhookEvent } from './stripe-webhook.js';
import type { StripeEntitlementCompletion } from './stripe-entitlement.js';
import { ReferralStore } from './referral-store.js';
import { welcomeOfferEligible, reserveWelcomeOffer } from './welcome-offer-store.js';
import type { WelcomeCheckoutPin } from './welcome-offer.js';
import { catalogPriceMatches } from './stripe-sales-catalog.js';
import { analyticsStore } from './analytics-store.js';
import type { AnalyticsAttribution } from './analytics-policy.js';

export class StripeBillingStore implements StripeBillingRouteStore {
  async saveAnalyticsAttribution(operationId: string, userId: string, attribution: AnalyticsAttribution): Promise<void> {
    await analyticsStore(this.pool).saveCheckoutAttribution(operationId, userId, attribution);
  }
  private readonly referrals: ReferralStore;

  constructor(private readonly pool: Pool) {
    this.referrals = new ReferralStore(pool);
  }

  private async ready(): Promise<void> {
    await ensureStripeBillingSchema(this.pool);
  }

  async acceptEvent(event: StripeWebhookEvent): Promise<{ invoiceId: string | null }> {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(
        'insert into public.stripe_events(stripe_event_id,event_type,livemode) values($1,$2,$3) on conflict (stripe_event_id) do nothing returning stripe_event_id',
        [event.id, event.type, event.livemode]
      );
      if (!inserted.rows.length) {
        await client.query('commit');
        return { invoiceId: null };
      }
      let invoiceId: string | null = null;
      if (event.type === 'invoice.paid') {
        const existingJob = await client.query('select 1 from public.stripe_invoice_jobs where stripe_invoice_id=$1', [event.data.object.id]);
        if (!existingJob.rows.length) {
        const job = await client.query<{ stripe_invoice_id: string }>(
          "insert into public.stripe_invoice_jobs(stripe_invoice_id,livemode,status) values($1,$2,'pending') on conflict (stripe_invoice_id) do nothing returning stripe_invoice_id",
          [event.data.object.id, event.livemode]
        );
        invoiceId = job.rows[0]?.stripe_invoice_id ?? null;
        }
      } else if (event.type === 'checkout.session.completed') {
        await client.query("update public.stripe_checkout_sessions set status='completed',updated_at=now() where stripe_session_id=$1 and livemode=$2 and status='open'", [event.data.object.id, event.livemode]);
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(event.data.object.status ?? 'unknown');
        const cancelAtPeriodEnd = event.data.object.cancel_at_period_end === true;
        await client.query('update public.stripe_subscriptions set status=$3,cancel_at_period_end=$4,updated_at=now() where stripe_subscription_id=$1 and livemode=$2', [event.data.object.id, event.livemode, status, cancelAtPeriodEnd]);
      }
      await client.query('commit');
      return { invoiceId };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(invoiceId: string): Promise<{ livemode: boolean } | null> {
    await this.ready();
    const result = await this.pool.query<{ livemode: boolean }>(
      "update public.stripe_invoice_jobs set status='fulfilling',updated_at=now() where stripe_invoice_id=$1 and status='pending' returning livemode", [invoiceId]
    );
    return result.rows[0] ?? null;
  }

  async pendingInvoiceIds(limit = 20): Promise<string[]> {
    await this.ready();
    const result = await this.pool.query<{ stripe_invoice_id: string }>(
      "select stripe_invoice_id from public.stripe_invoice_jobs where status='pending' order by created_at asc limit $1", [limit]
    );
    return result.rows.map(row => row.stripe_invoice_id);
  }

  async markStaleClaimsForReview(): Promise<void> {
    await this.ready();
    await this.pool.query(
      "update public.stripe_invoice_jobs set status='review-required',error_code='interrupted_provider_operation',updated_at=now() where status='fulfilling' and updated_at < now() - interval '10 minutes'"
    );
  }

  async ownerForCustomer(customerId: string, liveMode: boolean): Promise<string | null> {
    await this.ready();
    const result = await this.pool.query<{ user_id: string }>('select user_id from public.stripe_customers where stripe_customer_id=$1 and livemode=$2', [customerId, liveMode]);
    return result.rows[0]?.user_id ?? null;
  }

  async userEligible(userId: string): Promise<boolean> {
    const result = await this.pool.query("select 1 from public.users where id=$1 and status <> 'blocked' and deleted_at is null", [userId]);
    return result.rows.length > 0;
  }

  async credentialsForUser(userId: string): Promise<{ username: string; password: string } | null> {
    const result = await this.pool.query<{ username: string; password: string }>('select username,password from public.user_iptv_credentials where user_id=$1', [userId]);
    return result.rows[0] ?? null;
  }

  async reserveNewLine(invoiceId: string, userId: string): Promise<{ username: string; password: string }> {
    await this.ready();
    const existing = await this.pool.query<{ reserved_username: string | null; reserved_password: string | null }>(
      "select reserved_username,reserved_password from public.stripe_invoice_jobs where stripe_invoice_id=$1 and status='fulfilling' and user_id is null", [invoiceId]
    );
    // A provider line is created only when no local credentials exist. The job
    // retains the chosen secret so a timeout can be investigated without retry.
    if (existing.rows[0]?.reserved_username && existing.rows[0]?.reserved_password) {
      return { username: existing.rows[0].reserved_username, password: existing.rows[0].reserved_password };
    }
    const username = `fx${userId.replaceAll('-', '')}`;
    const password = randomBytes(18).toString('base64url');
    const updated = await this.pool.query<{ reserved_username: string; reserved_password: string }>(
      "update public.stripe_invoice_jobs set reserved_username=$2,reserved_password=$3,updated_at=now() where stripe_invoice_id=$1 and status='fulfilling' and reserved_username is null returning reserved_username,reserved_password",
      [invoiceId, username, password]
    );
    if (!updated.rows[0]) throw new Error('stripe_invoice_job_not_claimed');
    return { username: updated.rows[0].reserved_username, password: updated.rows[0].reserved_password };
  }

  async complete(invoiceId: string, completion: StripeEntitlementCompletion): Promise<void> {
    await this.ready();
    const client = await this.pool.connect();
    let livemode = false;
    try {
      await client.query('begin');
      const job = await client.query<{ stripe_invoice_id: string; livemode: boolean }>("select stripe_invoice_id,livemode from public.stripe_invoice_jobs where stripe_invoice_id=$1 and status='fulfilling' for update", [invoiceId]);
      if (!job.rows[0]) throw new Error('stripe_invoice_job_not_claimed');
      const user = await client.query("select id from public.users where id=$1 and status <> 'blocked' and deleted_at is null for update", [completion.userId]);
      if (!user.rows[0]) throw new Error('billing_user_unavailable');
      const selectedPackage = await client.query<{ id: string; duration_months: number }>(
        'select id,duration_months from public.packages where slug=$1 limit 1', [completion.packageSlug]
      );
      if (!selectedPackage.rows[0]) throw new Error('billing_package_unavailable');
      if (completion.newCredentials) {
        await client.query(
          'insert into public.user_iptv_credentials(user_id,username,password) values($1,$2,$3) on conflict (user_id) do nothing',
          [completion.userId, completion.newCredentials.username, completion.newCredentials.password]
        );
        const saved = await client.query<{ username: string; password: string }>('select username,password from public.user_iptv_credentials where user_id=$1', [completion.userId]);
        if (saved.rows[0]?.username !== completion.newCredentials.username || saved.rows[0]?.password !== completion.newCredentials.password) throw new Error('billing_credentials_conflict');
      }
      const active = await client.query<{ id: string; ends_at: Date; end_reason: string | null }>(
        "select id,ends_at,end_reason from public.subscriptions where user_id=$1 and status='active' order by ends_at desc limit 1 for update", [completion.userId]
      );
      const entitlementEnd = new Date(Math.max(completion.periodEnd.getTime(), completion.providerExpiryAfter.getTime()));
      const wasTrial = active.rows[0]?.end_reason?.includes('trial') === true;
      if (active.rows[0] && wasTrial) await client.query("update public.subscriptions set status='cancelled' where id=$1", [active.rows[0].id]);
      if (active.rows[0] && !wasTrial) {
        await client.query('update public.subscriptions set ends_at=greatest(ends_at,$2),package_id=$3 where id=$1', [active.rows[0].id, entitlementEnd, selectedPackage.rows[0].id]);
      } else {
        await client.query(
          "insert into public.subscriptions(id,user_id,package_id,status,starts_at,ends_at,activated_by_admin_id) values($1,$2,$3,'active',$4,$5,'stripe-billing')",
          [randomUUID(), completion.userId, selectedPackage.rows[0].id, new Date(), entitlementEnd]
        );
      }
      await client.query("update public.users set status='active' where id=$1 and status <> 'blocked' and deleted_at is null", [completion.userId]);
      await client.query(
        "insert into public.stripe_subscriptions(stripe_subscription_id,user_id,package_slug,livemode,status,current_period_end) select $1,$2,$3,livemode,'active',$4::timestamptz from public.stripe_invoice_jobs where stripe_invoice_id=$5 on conflict (stripe_subscription_id) do update set status='active',current_period_end=excluded.current_period_end,updated_at=now()",
        [completion.subscriptionId, completion.userId, completion.packageSlug, completion.periodEnd, invoiceId]
      );
      await client.query(
        "update public.stripe_invoice_jobs set user_id=$2,package_slug=$3,stripe_subscription_id=$4,status='fulfilled',provider_line_id=$5,provider_expiry_before=$6,provider_expiry_after=$7,error_code=null,updated_at=now() where stripe_invoice_id=$1 and status='fulfilling'",
        [invoiceId, completion.userId, completion.packageSlug, completion.subscriptionId, completion.providerLineId, completion.providerExpiryBefore, completion.providerExpiryAfter]
      );
      await client.query("update public.stripe_checkout_sessions set status='expired',fulfilled_at=now(),updated_at=now() where user_id=$1 and package_slug=$2 and livemode=$3 and sale_catalog_version is null and status in ('open','completed') and fulfilled_at is null", [completion.userId, completion.packageSlug, job.rows[0].livemode]);
      livemode = job.rows[0].livemode;
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    if (livemode) {
      try {
        await this.referrals.qualifyFulfilledStripeInvoice(completion.userId, invoiceId);
        await this.referrals.applyPendingRewardsForInvitee(completion.userId);
      } catch (error) {
        // Billing has already committed; the inviter's summary can reconcile
        // this verified invoice without repeating the provider operation.
        console.warn('[referrals] Stripe qualification deferred', error);
      }
    }
  }

  async review(invoiceId: string, code: string): Promise<void> {
    await this.ready();
    await this.pool.query(
      "update public.stripe_invoice_jobs set status='review-required',error_code=$2,updated_at=now() where stripe_invoice_id=$1 and status='fulfilling'",
      [invoiceId, /^[a-z_]{1,64}$/.test(code) ? code : 'billing_review_required']
    );
  }

  async customerFor(userId: string, liveMode: boolean): Promise<string | null> {
    await this.ready();
    const result = await this.pool.query<{ stripe_customer_id: string }>(
      'select stripe_customer_id from public.stripe_customers where user_id = $1 and livemode = $2', [userId, liveMode]
    );
    return result.rows[0]?.stripe_customer_id ?? null;
  }

  async accountState(userId: string, liveMode: boolean) {
    await this.ready();
    const [customerId, subscription, checkout] = await Promise.all([
      this.customerFor(userId, liveMode),
      this.pool.query('select 1 from public.stripe_subscriptions where user_id = $1 and livemode = $2 and status not in ($3, $4) limit 1', [userId, liveMode, 'canceled', 'incomplete_expired']),
      this.pool.query("select 1 from public.stripe_checkout_sessions where user_id = $1 and livemode = $2 and status in ('creating','open','completed') and fulfilled_at is null limit 1", [userId, liveMode])
    ]);
    return { customerId, activeSubscription: subscription.rows.length > 0, openCheckout: checkout.rows.length > 0 };
  }

  async welcomeOfferEligible(userId:string):Promise<boolean>{return welcomeOfferEligible(this.pool,userId);}

  async salePackageAvailable(slug: string, months: number, amountMinor: number): Promise<boolean> {
    const result = await this.pool.query<{ duration_months: number; price_label: string | null }>('select duration_months,price_label from public.packages where slug=$1 and is_active=true limit 1', [slug]);
    return result.rows[0]?.duration_months === months && catalogPriceMatches(result.rows[0].price_label, amountMinor);
  }

  async pendingCheckout(userId: string, liveMode: boolean): Promise<{ operationId: string; packageSlug: PackageSlug; status: 'creating' | 'open' | 'completed'; sessionId: string | null; priceId: string | null; catalogVersion: string | null;offerId?:string|null;couponId?:string|null;expectedAmountMinor?:number|null } | null> {
    await this.ready();
    const result = await this.pool.query<{ operation_id: string; package_slug: PackageSlug; status: 'creating' | 'open' | 'completed'; stripe_session_id: string | null; sale_price_id: string | null; sale_catalog_version: string | null;welcome_offer_id:string|null;welcome_coupon_id:string|null;expected_amount_minor:number|null }>(
      "select operation_id,package_slug,status,stripe_session_id,sale_price_id,sale_catalog_version,welcome_offer_id,welcome_coupon_id,expected_amount_minor from public.stripe_checkout_sessions where user_id=$1 and livemode=$2 and status in ('creating','open','completed') and fulfilled_at is null order by created_at desc limit 1",
      [userId, liveMode]
    );
    const row = result.rows[0];
    return row ? { operationId: row.operation_id, packageSlug: row.package_slug, status: row.status, sessionId: row.stripe_session_id, priceId: row.sale_price_id, catalogVersion: row.sale_catalog_version,offerId:row.welcome_offer_id,couponId:row.welcome_coupon_id,expectedAmountMinor:row.expected_amount_minor } : null;
  }

  async expireCheckout(operationId: string, sessionId: string): Promise<void> {
    await this.ready();
    const result = await this.pool.query(
      "update public.stripe_checkout_sessions set status='expired',updated_at=now() where operation_id=$1 and stripe_session_id=$2 and status='open'",
      [operationId, sessionId]
    );
    if (result.rowCount !== 1) throw new Error('checkout_state_changed');
  }

  async saveCustomer(userId: string, customerId: string, liveMode: boolean): Promise<string> {
    await this.ready();
    await this.pool.query(
      'insert into public.stripe_customers(user_id,stripe_customer_id,livemode) values($1,$2,$3) on conflict (user_id,livemode) do nothing',
      [userId, customerId, liveMode]
    );
    const saved = await this.customerFor(userId, liveMode);
    if (!saved) throw new Error('stripe_customer_persistence_failed');
    return saved;
  }

  async beginCheckout(userId: string, packageSlug: PackageSlug, liveMode: boolean, priceId: string, catalogVersion: string, offer?:WelcomeCheckoutPin): Promise<string> {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const user = await client.query("select id from public.users where id = $1 and status <> 'blocked' and deleted_at is null for update", [userId]);
      if (!user.rows[0]) throw new Error('billing_user_unavailable');
      const existingSubscription = await client.query("select 1 from public.stripe_subscriptions where user_id = $1 and livemode = $2 and status not in ('canceled','incomplete_expired') limit 1", [userId, liveMode]);
      const openCheckout = await client.query("select 1 from public.stripe_checkout_sessions where user_id = $1 and livemode = $2 and status in ('creating','open','completed') and fulfilled_at is null limit 1", [userId, liveMode]);
      if (existingSubscription.rows.length || openCheckout.rows.length) throw new Error('billing_checkout_already_open');
      const operationId = randomUUID();
      if(offer)await reserveWelcomeOffer(client,userId,operationId);
      if(offer)await client.query(
        "insert into public.stripe_checkout_sessions(operation_id,user_id,package_slug,livemode,status,sale_price_id,sale_catalog_version,welcome_offer_id,welcome_coupon_id,expected_amount_minor) values($1,$2,$3,$4,'creating',$5,$6,$7,$8,$9)",
        [operationId, userId, packageSlug, liveMode, priceId, catalogVersion,offer.offerId,offer.couponId,offer.amountMinor]
      );
      else await client.query(
        "insert into public.stripe_checkout_sessions(operation_id,user_id,package_slug,livemode,status,sale_price_id,sale_catalog_version) values($1,$2,$3,$4,'creating',$5,$6)",
        [operationId, userId, packageSlug, liveMode, priceId, catalogVersion]
      );
      await client.query('commit');
      return operationId;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeCheckout(operationId: string, sessionId: string): Promise<void> {
    await this.pool.query("update public.stripe_checkout_sessions set stripe_session_id=$2,status='open',updated_at=now() where operation_id=$1 and status='creating'", [operationId, sessionId]);
  }

  async failCheckout(operationId: string): Promise<void> {
    await this.pool.query("update public.stripe_checkout_sessions set status='failed',updated_at=now() where operation_id=$1 and status='creating'", [operationId]);
  }

  async billingStatus(userId: string, liveMode: boolean): Promise<{ status: string; periodEnd?: string | null; cancelAtPeriodEnd?: boolean }> {
    await this.ready();
    const review = await this.pool.query("select 1 from public.stripe_invoice_jobs where user_id=$1 and livemode=$2 and status='review-required' limit 1", [userId, liveMode]);
    if (review.rows.length) return { status: 'review_required' };
    const subscription = await this.pool.query<{ status: string; current_period_end: Date | null; cancel_at_period_end: boolean }>(
      'select status,current_period_end,cancel_at_period_end from public.stripe_subscriptions where user_id=$1 and livemode=$2 order by updated_at desc limit 1', [userId, liveMode]
    );
    if (subscription.rows[0]) {
      const row = subscription.rows[0];
      return { status: row.status, periodEnd: row.current_period_end?.toISOString() ?? null, cancelAtPeriodEnd: row.cancel_at_period_end };
    }
    const checkout = await this.pool.query("select 1 from public.stripe_checkout_sessions where user_id=$1 and livemode=$2 and status in ('creating','open','completed') and fulfilled_at is null order by created_at desc limit 1", [userId, liveMode]);
    return { status: checkout.rows.length ? 'pending' : 'none' };
  }
}
