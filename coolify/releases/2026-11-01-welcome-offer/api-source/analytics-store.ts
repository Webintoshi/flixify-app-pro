import { createHmac, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { analyticsConfiguration, type AnalyticsConfiguration, type AnalyticsOutboxEvent, type AnalyticsStream } from './analytics-delivery.js';
import { AnalyticsCapacityError } from './analytics-routes.js';
import { validateAnalyticsAttribution, type AnalyticsAttribution, type WindowsAnalyticsBatch } from './analytics-policy.js';

export type VerifiedAnalyticsSale = { userId: string; sessionId: string; paymentIntentId: string; liveMode: boolean; packageSlug: string; amountMinor: number; packageMonths: number; packageUsers: number; offerId?: string | null; eventTimestampMs?: number };
export type ClaimedAnalyticsEvent = AnalyticsOutboxEvent & { leaseToken: string };
const hmac = (key: string, value: string) => createHmac('sha256', key).update(value).digest('hex');
const packages: Record<string, { months: number; users: number; amount: number }> = { '1-ay': { months: 1, users: 1, amount: 25000 }, '6-ay': { months: 6, users: 1, amount: 69900 }, '12-ay': { months: 12, users: 1, amount: 99900 }, '1-ay-2-kullanici': { months: 1, users: 2, amount: 39900 }, '6-ay-2-kullanici': { months: 6, users: 2, amount: 99900 }, '12-ay-2-kullanici': { months: 12, users: 2, amount: 139900 } };

export function verifiedSaleEvent(configuration: AnalyticsConfiguration, name: 'purchase' | 'package_activated', sale: VerifiedAnalyticsSale, attribution: AnalyticsAttribution, now = Date.now()): AnalyticsOutboxEvent | null {
  const pkg = packages[sale.packageSlug];
  const welcome = sale.offerId === 'welcome-monthly-50-v1';
  if (!configuration.web || !configuration.hashSecret || !sale.liveMode || !pkg || pkg.months !== sale.packageMonths || pkg.users !== sale.packageUsers || !/^pi_[A-Za-z0-9_]+$/.test(sale.paymentIntentId) ||
      sale.offerId && !welcome || welcome && pkg.months !== 1 || !Number.isSafeInteger(sale.amountMinor) || sale.amountMinor !== (welcome ? pkg.amount / 2 : pkg.amount) || !validateAnalyticsAttribution(attribution)) return null;
  const transaction = `fx_${hmac(configuration.hashSecret, `transaction:${sale.paymentIntentId}`).slice(0,48)}`;
  const common = { client_platform: attribution.clientPlatform, package_id: sale.packageSlug, package_months: pkg.months, package_users: pkg.users, ...(attribution.sourcePlatform ? { source_platform: attribution.sourcePlatform } : {}), ...(sale.offerId ? { offer_id: sale.offerId } : {}) };
  return { id: hmac(configuration.hashSecret, `${name}:${sale.paymentIntentId}`), stream: 'web', clientId: attribution.clientId, sessionId: attribution.sessionId, eventTimestampMs: now, name,
    params: name === 'purchase' ? { ...common, transaction_id: transaction, value: sale.amountMinor / 100, currency: 'TRY', items: [{ item_id: sale.packageSlug, item_name: `${pkg.months} ay / ${pkg.users} kullanıcı`, price: sale.amountMinor / 100, quantity: 1 }] } : common };
}

export class PostgresAnalyticsStore {
  readonly configuration: AnalyticsConfiguration;
  constructor(private readonly pool: Pool, configuration = analyticsConfiguration(process.env)) { this.configuration = configuration; }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('begin'); await client.query("set local statement_timeout='2500ms'; set local lock_timeout='1000ms'"); const result = await work(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }
  private async initialConsent(client: PoolClient, userId: string, clientId: string): Promise<boolean> {
    await client.query('insert into public.analytics_consents(user_id,client_id,consent_version,accepted) values($1,$2,1,true) on conflict(user_id,client_id) do nothing', [userId,clientId]);
    return (await client.query<{accepted:boolean}>('select accepted from public.analytics_consents where user_id=$1 and client_id=$2 and consent_version=1 for update',[userId,clientId])).rows[0]?.accepted === true;
  }
  async setConsent(userId: string, clientId: string, accepted: boolean): Promise<void> {
    await this.transaction(async client => {
      await client.query('insert into public.analytics_consents(user_id,client_id,consent_version,accepted) values($1,$2,1,$3) on conflict(user_id,client_id) do update set accepted=public.analytics_consents.accepted and excluded.accepted,updated_at=now()', [userId,clientId,accepted]);
      if (!accepted) {
        await client.query('update public.analytics_checkout_attribution set revoked_at=now(),updated_at=now() where user_id=$1 and client_id=$2 and revoked_at is null',[userId,clientId]);
        await client.query("delete from public.analytics_outbox where user_id=$1 and client_id=$2 and state in ('pending','sending')",[userId,clientId]);
      }
    });
  }
  async saveCheckoutAttribution(operationId: string, userId: string, value: unknown): Promise<void> {
    const attribution = validateAnalyticsAttribution(value);
    if (!this.configuration.web || !attribution) return;
    await this.transaction(async client => {
      if (!await this.initialConsent(client,userId,attribution.clientId)) return;
      await client.query(`insert into public.analytics_checkout_attribution(operation_id,user_id,client_id,session_id,client_platform,source_platform,consent_version)
        select operation_id,user_id,$3,$4,$5,$6,1 from public.stripe_checkout_sessions where operation_id=$1 and user_id=$2 and status in ('creating','open') and fulfilled_at is null
        on conflict(operation_id) do update set client_id=excluded.client_id,session_id=excluded.session_id,client_platform=excluded.client_platform,source_platform=excluded.source_platform,updated_at=now()
        where public.analytics_checkout_attribution.revoked_at is null`,[operationId,userId,attribution.clientId,attribution.sessionId,attribution.clientPlatform,attribution.sourcePlatform??null]);
    });
  }
  async acceptWindowsBatch(userId: string, batch: WindowsAnalyticsBatch): Promise<number> {
    if (!this.configuration.windows || !this.configuration.hashSecret) return 0;
    return this.transaction(async client => {
      await client.query("select pg_advisory_xact_lock(hashtextextended('flixify-analytics-capacity',0))");
      if (!await this.initialConsent(client,userId,batch.clientId)) return 0;
      const perUser=Number((await client.query("select count(*) as n from (select 1 from public.analytics_outbox where user_id=$1 and state in ('pending','sending') limit 200) limited",[userId])).rows[0].n);
      const total=Number((await client.query("select count(*) as n from (select 1 from public.analytics_outbox where state in ('pending','sending') limit 10000) limited")).rows[0].n);
      if (perUser+batch.events.length>200 || total+batch.events.length>10000) throw new AnalyticsCapacityError();
      let count=0;
      for (const event of batch.events) {
        const key=hmac(this.configuration.hashSecret!,`windows:${userId}:${batch.clientId}:${event.id}`);
        const row=await client.query(`insert into public.analytics_outbox(event_key,user_id,client_id,session_id,stream,event_name,event_timestamp_ms,params)
          values($1,$2,$3,$4,'windows',$5,$6,$7::jsonb) on conflict(event_key) do nothing returning event_key`,[key,userId,batch.clientId,batch.sessionId,event.name,event.eventTimestampMs,JSON.stringify({...event.params,client_platform:'windows'})]);
        count+=row.rows.length;
      }
      return count;
    });
  }
  async recordVerifiedSale(name: 'purchase' | 'package_activated', sale: VerifiedAnalyticsSale): Promise<void> {
    if (!this.configuration.web || !this.configuration.hashSecret || !sale.liveMode) return;
    await this.transaction(async client => {
      const attribution=(await client.query<{client_id:string;session_id:string;client_platform:'web'|'pwa';source_platform:'android_tv'|'macos'|'windows'|null}>(`select a.client_id,a.session_id,a.client_platform,a.source_platform from public.analytics_checkout_attribution a
        join public.stripe_checkout_sessions c on c.operation_id=a.operation_id join public.stripe_payment_jobs j on j.stripe_session_id=c.stripe_session_id and j.user_id=c.user_id
        join public.analytics_consents consent on consent.user_id=a.user_id and consent.client_id=a.client_id
        where c.stripe_session_id=$1 and c.user_id=$2 and c.livemode=true and j.livemode=true and j.payment_intent_id=$3 and c.package_slug=$5 and ($4<>'package_activated' or j.status='fulfilled')
          and a.user_id=$2 and a.consent_version=1 and a.revoked_at is null and consent.accepted=true
          and ($4<>'purchase' or a.purchase_recorded_at is null) and ($4<>'package_activated' or a.activation_recorded_at is null)
        for update of consent`,[sale.sessionId,sale.userId,sale.paymentIntentId,name,sale.packageSlug])).rows[0];
      if (!attribution) return;
      const event=verifiedSaleEvent(this.configuration,name,sale,{consentVersion:1,clientId:attribution.client_id,sessionId:Number(attribution.session_id),clientPlatform:attribution.client_platform,...(attribution.source_platform?{sourcePlatform:attribution.source_platform}:{})},sale.eventTimestampMs??Date.now());
      if (!event) return;
      await client.query(`insert into public.analytics_outbox(event_key,user_id,client_id,session_id,stream,event_name,event_timestamp_ms,params)
        values($1,$2,$3,$4,'web',$5,$6,$7::jsonb) on conflict(event_key) do nothing`,[event.id,sale.userId,event.clientId,event.sessionId,event.name,event.eventTimestampMs,JSON.stringify(event.params)]);
      const checkpoint=name==='purchase'?'purchase_recorded_at':'activation_recorded_at';
      await client.query(`update public.analytics_checkout_attribution a set ${checkpoint}=coalesce(a.${checkpoint},now()) from public.stripe_checkout_sessions c where c.operation_id=a.operation_id and c.stripe_session_id=$1 and a.user_id=$2`,[sale.sessionId,sale.userId]);
    });
  }
  async reconcileVerifiedSales(): Promise<void> {
    if(!this.configuration.web)return;
    const rows=(await this.pool.query<{stripe_session_id:string;payment_intent_id:string;user_id:string;package_slug:string;welcome_offer_id:string|null;expected_amount_minor:number|null;status:string;event_timestamp_ms:string;purchase_recorded_at:Date|null;activation_recorded_at:Date|null}>(`select j.stripe_session_id,j.payment_intent_id,j.user_id,c.package_slug,c.welcome_offer_id,c.expected_amount_minor,j.status,
      floor(extract(epoch from j.created_at)*1000)::bigint as event_timestamp_ms,a.purchase_recorded_at,a.activation_recorded_at
      from public.stripe_payment_jobs j join public.stripe_checkout_sessions c on c.stripe_session_id=j.stripe_session_id and c.user_id=j.user_id
      join public.analytics_checkout_attribution a on a.operation_id=c.operation_id join public.analytics_consents consent on consent.user_id=a.user_id and consent.client_id=a.client_id
      where j.livemode=true and c.livemode=true and j.payment_intent_id is not null and a.revoked_at is null and consent.accepted=true
        and j.created_at>now()-interval '72 hours' and (a.purchase_recorded_at is null or j.status='fulfilled' and a.activation_recorded_at is null)
      order by j.created_at limit 20`)).rows;
    for(const row of rows) {
      const pkg=packages[row.package_slug]; if(!pkg)continue;
      const sale:VerifiedAnalyticsSale={userId:row.user_id,sessionId:row.stripe_session_id,paymentIntentId:row.payment_intent_id,liveMode:true,packageSlug:row.package_slug,packageMonths:pkg.months,packageUsers:pkg.users,amountMinor:row.expected_amount_minor??pkg.amount,offerId:row.welcome_offer_id,eventTimestampMs:Number(row.event_timestamp_ms)};
      if(!row.purchase_recorded_at)await this.recordVerifiedSale('purchase',sale);
      if(row.status==='fulfilled'&&!row.activation_recorded_at)await this.recordVerifiedSale('package_activated',sale);
    }
  }
  async claim(limit: number, streams: AnalyticsStream[]): Promise<ClaimedAnalyticsEvent[]> {
    const leaseToken=randomUUID();
    const result=await this.pool.query<{event_key:string;lease_token:string;stream:AnalyticsStream;client_id:string;session_id:string;event_timestamp_ms:string;event_name:string;params:Record<string,unknown>}>(`with selected as (
      select o.event_key from public.analytics_outbox o join public.analytics_consents c on c.user_id=o.user_id and c.client_id=o.client_id
      where o.stream=any($1::text[]) and c.accepted=true and o.event_timestamp_ms>extract(epoch from now()-interval '72 hours')*1000
        and o.attempts<5 and (o.state='pending' or o.state='sending' and o.lease_until<now()) and o.next_attempt_at<=now()
      order by case when o.stream='web' then 0 else 1 end,o.created_at for update of o skip locked limit $2)
      update public.analytics_outbox o set state='sending',attempts=attempts+1,lease_until=now()+interval '90 seconds',lease_token=$3
      from selected where o.event_key=selected.event_key returning o.*`,[streams,Math.max(1,Math.min(limit,10)),leaseToken]);
    return result.rows.map(row=>({id:row.event_key,leaseToken:row.lease_token,stream:row.stream,clientId:row.client_id,sessionId:Number(row.session_id),eventTimestampMs:Number(row.event_timestamp_ms),name:row.event_name,params:row.params}));
  }
  async consentActive(event: ClaimedAnalyticsEvent): Promise<boolean> {
    return (await this.pool.query(`select 1 from public.analytics_outbox o join public.analytics_consents c on c.user_id=o.user_id and c.client_id=o.client_id
      where o.event_key=$1 and o.lease_token=$2 and o.state='sending' and c.accepted=true`,[event.id,event.leaseToken])).rows.length===1;
  }
  async finish(eventId: string, leaseToken: string, outcome: {delivered:boolean;retryable:boolean}): Promise<void> {
    await this.pool.query(`update public.analytics_outbox set state=case when $3 then 'delivered' when $4 and attempts<5 then 'pending' else 'dead' end,
      delivered_at=case when $3 then now() else null end,next_attempt_at=now()+(least(3600,30*power(2,attempts-1))*interval '1 second'),lease_until=null,lease_token=null
      where event_key=$1 and lease_token=$2 and state='sending'`,[eventId,leaseToken,outcome.delivered,outcome.retryable]);
  }
  async prune(): Promise<void> {
    await this.pool.query(`update public.analytics_outbox set state='dead',lease_until=null,lease_token=null where state in ('pending','sending') and
      (event_timestamp_ms<extract(epoch from now()-interval '72 hours')*1000 or attempts>=5 and (state='pending' or lease_until<now()))`);
    await this.pool.query(`delete from public.analytics_outbox where event_key in (select event_key from public.analytics_outbox where state in ('dead','delivered') and created_at<now()-interval '4 days' limit 1000)`);
  }
}
const stores = new WeakMap<Pool,PostgresAnalyticsStore>();
export function analyticsStore(pool: Pool, configuration?:AnalyticsConfiguration): PostgresAnalyticsStore {
  let store=stores.get(pool); if (!store) { store=new PostgresAnalyticsStore(pool,configuration); stores.set(pool,store); } return store;
}
