import type { Pool, PoolClient } from 'pg';
import { WELCOME_CAMPAIGN, welcomeStatus, type WelcomeStatus } from './welcome-offer.js';
type Db = Pick<Pool, 'query'>;
const paidHistory = `exists(select 1 from public.subscriptions s where s.user_id=u.id and coalesce(s.end_reason,'') not ilike '%trial%')
  or exists(select 1 from public.stripe_payment_jobs j where j.user_id=u.id and j.status='fulfilled')
  or exists(select 1 from public.stripe_invoice_jobs j where j.user_id=u.id and j.status='fulfilled')
  or exists(select 1 from public.payment_requests p where p.user_id=u.id and p.status='approved')`;
export async function welcomeOfferEligible(db: Db, userId: string): Promise<boolean> {
  return (await db.query(`select 1 from public.welcome_offer_accounts w join public.users u on u.id=w.user_id
    where w.user_id=$1 and w.campaign=$2 and w.redeemed_at is null and u.status<>'blocked' and u.deleted_at is null
      and not (${paidHistory})`, [userId, WELCOME_CAMPAIGN])).rows.length === 1;
}
export async function reserveWelcomeOffer(client: PoolClient, userId: string, operationId: string): Promise<void> {
  if (!await welcomeOfferEligible(client, userId)) throw new Error('welcome_offer_unavailable');
  const result = await client.query(`update public.welcome_offer_accounts w set reserved_operation_id=$3,updated_at=now()
    where user_id=$1 and campaign=$2 and redeemed_at is null and (reserved_operation_id is null or reserved_operation_id=$3 or not exists(
      select 1 from public.stripe_checkout_sessions c where c.operation_id=w.reserved_operation_id and c.status in ('creating','open','completed') and c.fulfilled_at is null)) returning user_id`, [userId, WELCOME_CAMPAIGN, operationId]);
  if (result.rows.length !== 1) throw new Error('welcome_offer_reserved');
}
export async function validateWelcomePayment(db: Db, sessionId: string, userId: string, checkPriorPayment=true): Promise<boolean> {
  if (checkPriorPayment && !await welcomeOfferEligible(db,userId)) return false;
  return (await db.query(`select 1 from public.welcome_offer_accounts w join public.stripe_checkout_sessions c
    on c.operation_id=w.reserved_operation_id and c.user_id=w.user_id
    where w.user_id=$1 and w.campaign=$2 and c.stripe_session_id=$3 and c.welcome_offer_id=w.campaign and w.redeemed_at is null`, [userId,WELCOME_CAMPAIGN,sessionId])).rows.length === 1;
}
export class WelcomeOfferStore {
  constructor(private readonly pool: Pool) {}
  async status(userId: string): Promise<WelcomeStatus> {
    const result=await this.pool.query<{dismissed_at:unknown;redeemed_at:unknown;paid:boolean}>(`select w.dismissed_at,w.redeemed_at,(${paidHistory}) as paid
      from public.welcome_offer_accounts w join public.users u on u.id=w.user_id
      where w.user_id=$1 and w.campaign=$2 and u.status<>'blocked' and u.deleted_at is null`,[userId,WELCOME_CAMPAIGN]);
    return welcomeStatus(result.rows[0]??null);
  }
  async choose(userId: string, choice: 'trial'|'monthly'): Promise<WelcomeStatus> {
    await this.pool.query(`update public.welcome_offer_accounts w set dismissed_at=coalesce(w.dismissed_at,now()),choice=coalesce(w.choice,$3),updated_at=now()
      from public.users u where w.user_id=$1 and w.campaign=$2 and u.id=w.user_id and u.status<>'blocked' and u.deleted_at is null`,[userId,WELCOME_CAMPAIGN,choice]);
    return this.status(userId);
  }
}
