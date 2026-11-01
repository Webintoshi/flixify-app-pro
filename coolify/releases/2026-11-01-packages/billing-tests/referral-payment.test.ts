import { describe, expect, it, vi } from 'vitest';
import { ReferralStore } from '../api-source/referral-store.js';
import { SALE_CATALOG_VERSION } from '../api-source/stripe-sales-catalog.js';

function fixture({proof=true,existing=false,referrer=true}={}){
  let qualified=existing;const calls:{sql:string;values:any[]}[]=[];
  const query=vi.fn(async(sql:string,values:any[]=[])=>{
    calls.push({sql,values});
    if(sql.includes("to_regclass('public.stripe_payment_jobs')"))return{rows:[{present:'stripe_payment_jobs'}]};
    if(sql.startsWith('select referrer_user_id'))return{rows:referrer?[{referrer_user_id:'referrer_fixture'}]:[]};
    if(sql.startsWith('select id from public.users'))return{rows:[{id:'referrer_fixture'}]};
    if(sql.startsWith('select invitee_user_id'))return{rows:qualified?[{invitee_user_id:'invitee_fixture'}]:[]};
    if(sql.includes('select j.stripe_session_id'))return{rows:proof?[{stripe_session_id:'cs_first_paid'}]:[]};
    if(sql.includes('insert into public.referral_qualifications(')&&!sql.includes('create table')){qualified=true;return{rows:[{invitee_user_id:'invitee_fixture'}]};}
    if(sql.startsWith('select count(*)'))return{rows:[{total:'3'}]};
    return{rows:[]};
  });
  const client={query,release:vi.fn()};const pool:any={query,connect:vi.fn(async()=>client)};
  return{store:new ReferralStore(pool),calls};
}

describe('referral eligibility from genuine fulfilled one-time proof',()=>{
  it('qualifies a verified live paid session once and preserves the existing third-invite milestone',async()=>{
    const f=fixture();expect(await f.store.qualifyFulfilledStripePayment('invitee_fixture','cs_first_paid')).toBe(true);expect(await f.store.qualifyFulfilledStripePayment('invitee_fixture','cs_first_paid')).toBe(false);
    const proof=f.calls.find(x=>x.sql.includes('select j.stripe_session_id'))!;
    expect(proof.values).toEqual(['invitee_fixture',SALE_CATALOG_VERSION]);expect(proof.sql).toContain("j.livemode=true and j.status='fulfilled'");expect(proof.sql).toContain('j.payment_intent_id is not null');expect(proof.sql).toContain('c.fulfilled_at is not null');
    const insert=f.calls.filter(x=>x.sql.includes('insert into public.referral_qualifications('));expect(insert).toHaveLength(1);expect(insert[0].sql).toContain('stripe_payment_session_id');expect(insert[0].sql).not.toContain('stripe_invoice_id');expect(insert[0].values[2]).toBe('cs_first_paid');
    expect(f.calls.filter(x=>x.sql.includes('insert into public.referral_rewards('))).toHaveLength(1);
  });
  it.each([{proof:false},{existing:true},{referrer:false}])('does not qualify an unpaid, already-qualified or unattributed account%j',async(options)=>{const f=fixture(options);expect(await f.store.qualifyFulfilledStripePayment('invitee_fixture','cs_first_paid')).toBe(false);expect(f.calls.some(x=>x.sql.includes('insert into public.referral_qualifications('))).toBe(false);});
  it('rejects a later purchase as the first-paid referral proof',async()=>{const f=fixture();expect(await f.store.qualifyFulfilledStripePayment('invitee_fixture','cs_second_paid')).toBe(false);expect(f.calls.some(x=>x.sql.includes('insert into public.referral_qualifications('))).toBe(false);});
});
