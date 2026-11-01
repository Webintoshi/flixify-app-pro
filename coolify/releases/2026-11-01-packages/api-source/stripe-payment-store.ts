import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ensureStripeBillingSchema } from './stripe-billing-schema.js';
import { SALE_CATALOG_VERSION } from './stripe-sales-catalog.js';
import type { PaymentCompletion, CheckoutPin } from './stripe-payment.js';
import { ReferralStore } from './referral-store.js';

const ready = new WeakMap<Pool, Promise<void>>();
export async function ensureStripePaymentSchema(pool: Pool): Promise<void> {
  if (ready.has(pool)) return ready.get(pool)!;
  const pending = (async () => {
    await ensureStripeBillingSchema(pool);
    await pool.query(`create table if not exists public.stripe_payment_jobs (
      stripe_session_id text primary key,
      payment_intent_id text unique,
      user_id uuid not null references public.users(id),
      livemode boolean not null,
      status text not null check(status in ('pending','fulfilling','fulfilled','review-required','expired')),
      provider_line_id text,
      provider_expiry_before timestamptz,
      provider_expiry_after timestamptz,
      reserved_username text,
      reserved_password text,
      ends_at timestamptz,
      fulfilled_at timestamptz,
      error_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
    await pool.query('create index if not exists stripe_payment_jobs_status on public.stripe_payment_jobs(status,created_at)');
    await pool.query(`alter table public.stripe_payment_jobs enable row level security;
revoke all on public.stripe_payment_jobs from public;
do $payment_privacy$
declare role_name name;
begin
  foreach role_name in array array['anon', 'authenticated']::name[] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.stripe_payment_jobs from %I', role_name);
    end if;
  end loop;
end
$payment_privacy$;`);
  })().catch(error => { ready.delete(pool); throw error; });
  ready.set(pool, pending); return pending;
}

export class StripePaymentStore {
  private readonly lockClient = new AsyncLocalStorage<PoolClient>();
  constructor(private readonly pool: Pool) {}
  private get db() { return this.lockClient.getStore() ?? this.pool; }
  private ready() { return ensureStripePaymentSchema(this.pool); }

  async enqueue(sessionId: string, liveMode: boolean): Promise<boolean> {
    await this.ready();
    const result = await this.db.query(`insert into public.stripe_payment_jobs(stripe_session_id,user_id,livemode,status)
      select stripe_session_id,user_id,livemode,'pending' from public.stripe_checkout_sessions
      where stripe_session_id=$1 and livemode=$2 and sale_catalog_version=$3 and sale_price_id is not null
        and status in ('open','completed') and fulfilled_at is null
      on conflict(stripe_session_id) do nothing returning stripe_session_id`, [sessionId, liveMode, SALE_CATALOG_VERSION]);
    return result.rows.length > 0;
  }
  async checkout(sessionId: string): Promise<CheckoutPin | null> {
    await this.ready();
    const result = await this.db.query<{stripe_session_id:string;user_id:string;package_slug:string;sale_price_id:string|null;sale_catalog_version:string|null;livemode:boolean}>(
      'select stripe_session_id,user_id,package_slug,sale_price_id,sale_catalog_version,livemode from public.stripe_checkout_sessions where stripe_session_id=$1', [sessionId]);
    const row=result.rows[0];
    return row ? {sessionId:row.stripe_session_id,userId:row.user_id,packageSlug:row.package_slug,priceId:row.sale_price_id,catalogVersion:row.sale_catalog_version,liveMode:row.livemode} : null;
  }
  async jobOwner(sessionId: string): Promise<string | null> {
    await this.ready();
    return (await this.db.query<{user_id:string}>('select user_id from public.stripe_payment_jobs where stripe_session_id=$1',[sessionId])).rows[0]?.user_id ?? null;
  }
  async withUserLock<T>(userId:string, work:()=>Promise<T>):Promise<T|null> {
    const client=await this.pool.connect();let locked=false;
    try {
      locked=(await client.query<{locked:boolean}>('select pg_try_advisory_lock(hashtextextended($1,0)) as locked',[`flixify-provider:${userId}`])).rows[0]?.locked===true;
      return locked ? await this.lockClient.run(client, work) : null;
    } finally { let unlocked=!locked;try{if(locked)await client.query('select pg_advisory_unlock(hashtextextended($1,0))',[`flixify-provider:${userId}`]);unlocked=true;}finally{client.release(!unlocked);} }
  }
  async claim(sessionId:string):Promise<{userId:string;livemode:boolean}|null> {
    await this.ready();
    const result=await this.db.query<{user_id:string;livemode:boolean}>("update public.stripe_payment_jobs set status='fulfilling',updated_at=now() where stripe_session_id=$1 and status='pending' returning user_id,livemode",[sessionId]);
    const row=result.rows[0];return row?{userId:row.user_id,livemode:row.livemode}:null;
  }
  async bindPaymentIntent(sessionId:string,paymentIntentId:string):Promise<void> {
    const result=await this.db.query("update public.stripe_payment_jobs set payment_intent_id=$2,updated_at=now() where stripe_session_id=$1 and status='fulfilling' and (payment_intent_id is null or payment_intent_id=$2) returning stripe_session_id",[sessionId,paymentIntentId]);
    if(result.rows.length!==1)throw new Error('payment_intent_conflict');
  }
  async ownerForCustomer(customerId:string,liveMode:boolean):Promise<string|null>{return(await this.db.query<{user_id:string}>('select user_id from public.stripe_customers where stripe_customer_id=$1 and livemode=$2',[customerId,liveMode])).rows[0]?.user_id??null;}
  async userEligible(userId:string):Promise<boolean>{return(await this.db.query("select id from public.users where id=$1 and status<>'blocked' and deleted_at is null",[userId])).rows.length>0;}
  async credentialsForUser(userId:string):Promise<{username:string;password:string}|null> {
    return (await this.db.query<{username:string;password:string}>('select username,password from public.user_iptv_credentials where user_id=$1',[userId])).rows[0]??null;
  }
  async reserveNewLine(sessionId:string,userId:string):Promise<{username:string;password:string}> {
    const row=(await this.db.query<{reserved_username:string|null;reserved_password:string|null}>("select reserved_username,reserved_password from public.stripe_payment_jobs where stripe_session_id=$1 and user_id=$2 and status='fulfilling'",[sessionId,userId])).rows[0];
    if(!row)throw new Error('payment_job_not_claimed');
    if(row.reserved_username&&row.reserved_password)return{username:row.reserved_username,password:row.reserved_password};
    const value=(await this.db.query<{reserved_username:string;reserved_password:string}>("update public.stripe_payment_jobs set reserved_username=$3,reserved_password=$4,updated_at=now() where stripe_session_id=$1 and user_id=$2 and status='fulfilling' and reserved_username is null returning reserved_username,reserved_password",[sessionId,userId,`fx${userId.replaceAll('-','')}`,randomBytes(18).toString('base64url')])).rows[0];
    if(!value)throw new Error('payment_reservation_conflict');return{username:value.reserved_username,password:value.reserved_password};
  }
  async complete(sessionId:string,c:PaymentCompletion):Promise<void> {
    const existingClient=this.lockClient.getStore();
    const client=existingClient??await this.pool.connect();
    try {
      await client.query('begin');
      const job=(await client.query<{user_id:string;payment_intent_id:string;livemode:boolean}>("select user_id,payment_intent_id,livemode from public.stripe_payment_jobs where stripe_session_id=$1 and status='fulfilling' for update",[sessionId])).rows[0];
      if(!job||job.user_id!==c.userId||job.payment_intent_id!==c.paymentIntentId)throw new Error('payment_job_mismatch');
      if(!(await client.query("select id from public.users where id=$1 and status<>'blocked' and deleted_at is null for update",[c.userId])).rows[0])throw new Error('billing_user_unavailable');
      const current=(await client.query<{username:string;password:string}>('select username,password from public.user_iptv_credentials where user_id=$1 for update',[c.userId])).rows[0]??null;
      if(Boolean(current)!==Boolean(c.credentialsBefore)||current&&(current.username!==c.credentialsBefore?.username||current.password!==c.credentialsBefore?.password))throw new Error('billing_credentials_conflict');
      if(!current)await client.query('insert into public.user_iptv_credentials(user_id,username,password) values($1,$2,$3) on conflict(user_id) do nothing',[c.userId,c.credentialsAfter.username,c.credentialsAfter.password]);
      const saved=(await client.query<{username:string;password:string}>('select username,password from public.user_iptv_credentials where user_id=$1 for update',[c.userId])).rows[0];
      if(saved?.username!==c.credentialsAfter.username||saved?.password!==c.credentialsAfter.password)throw new Error('billing_credentials_conflict');
      const pkg=(await client.query<{id:string}>('select id from public.packages where slug=$1',[c.packageSlug])).rows[0];
      if(!pkg||!Number.isFinite(c.providerExpiryAfter.getTime())||c.providerExpiryAfter.getTime()<=Date.now())throw new Error('billing_package_unavailable');
      const active=(await client.query<{id:string;end_reason:string|null}>("select id,end_reason from public.subscriptions where user_id=$1 and status='active' order by ends_at desc limit 1 for update",[c.userId])).rows[0];
      const wasTrial=active?.end_reason?.includes('trial')===true;
      if(active&&wasTrial)await client.query("update public.subscriptions set status='cancelled' where id=$1",[active.id]);
      if(active&&!wasTrial)await client.query('update public.subscriptions set ends_at=$2,package_id=$3 where id=$1',[active.id,c.providerExpiryAfter,pkg.id]);
      else await client.query("insert into public.subscriptions(id,user_id,package_id,status,starts_at,ends_at,activated_by_admin_id) values($1,$2,$3,'active',now(),$4,'stripe-payment')",[randomUUID(),c.userId,pkg.id,c.providerExpiryAfter]);
      await client.query("update public.users set status='active' where id=$1 and status<>'blocked' and deleted_at is null",[c.userId]);
      await client.query("update public.stripe_payment_jobs set status='fulfilled',provider_line_id=$2,provider_expiry_before=$3,provider_expiry_after=$4,ends_at=$4,fulfilled_at=now(),error_code=null,updated_at=now() where stripe_session_id=$1 and status='fulfilling'",[sessionId,c.providerLineId,c.providerExpiryBefore,c.providerExpiryAfter]);
      await client.query("update public.stripe_checkout_sessions set status='expired',fulfilled_at=now(),updated_at=now() where stripe_session_id=$1 and user_id=$2 and livemode=$3",[sessionId,c.userId,job.livemode]);
      await client.query('commit');
    } catch(error){await client.query('rollback');throw error;}finally{if(!existingClient)client.release();}
  }
  async qualifyReferrals(sessionId:string):Promise<void>{
    const row=(await this.pool.query<{user_id:string}>("select user_id from public.stripe_payment_jobs where stripe_session_id=$1 and livemode=true and status='fulfilled'",[sessionId])).rows[0];
    if(!row)return;
    const referrals=new ReferralStore(this.pool);
    await referrals.qualifyFulfilledStripePayment(row.user_id,sessionId);
    await referrals.applyPendingRewardsForInvitee(row.user_id);
  }
  async review(sessionId:string,code:string):Promise<void>{await this.db.query("update public.stripe_payment_jobs set status='review-required',error_code=$2,updated_at=now() where stripe_session_id=$1 and status='fulfilling'",[sessionId,/^[a-z_]{1,64}$/.test(code)?code:'payment_review_required']);}
  async defer(sessionId:string):Promise<void>{await this.db.query("update public.stripe_payment_jobs set status='pending',updated_at=now() where stripe_session_id=$1 and status='fulfilling'",[sessionId]);}
  async expire(sessionId:string,userId:string,liveMode:boolean):Promise<void>{await this.db.query("update public.stripe_checkout_sessions set status='expired',updated_at=now() where stripe_session_id=$1 and user_id=$2 and livemode=$3 and fulfilled_at is null and status in ('open','completed')",[sessionId,userId,liveMode]);await this.db.query("update public.stripe_payment_jobs set status='expired',updated_at=now() where stripe_session_id=$1 and user_id=$2 and livemode=$3 and status='pending'",[sessionId,userId,liveMode]);}
  async pendingSessionIds(limit=20):Promise<string[]>{await this.ready();return(await this.db.query<{stripe_session_id:string}>("select stripe_session_id from public.stripe_payment_jobs where status='pending' order by created_at limit $1",[limit])).rows.map(x=>x.stripe_session_id);}
  async markStaleClaimsForReview():Promise<void>{await this.ready();await this.db.query("update public.stripe_payment_jobs set status='review-required',error_code='interrupted_provider_operation',updated_at=now() where status='fulfilling' and updated_at<now()-interval '10 minutes'");}
  async status(sessionId:string,userId:string,liveMode:boolean):Promise<{status:'awaiting_payment'|'processing'|'active'|'review_required'|'expired';packageSlug:string;endsAt?:string}|null>{
    await this.ready();
    const row=(await this.db.query<{package_slug:string;status:string;job_status:string|null;ends_at:Date|null}>(`select c.package_slug,c.status,j.status as job_status,j.ends_at from public.stripe_checkout_sessions c left join public.stripe_payment_jobs j on j.stripe_session_id=c.stripe_session_id where c.stripe_session_id=$1 and c.user_id=$2 and c.livemode=$3 and c.sale_catalog_version=$4`,[sessionId,userId,liveMode,SALE_CATALOG_VERSION])).rows[0];
    if(!row)return null;
    if(row.job_status==='fulfilled'){const end=new Date(row.ends_at!);return{status:end.getTime()>Date.now()?'active':'expired',packageSlug:row.package_slug,endsAt:end.toISOString()};}
    return{status:row.job_status==='review-required'?'review_required':row.status==='expired'?'expired':row.job_status?'processing':'awaiting_payment',packageSlug:row.package_slug};
  }
}
