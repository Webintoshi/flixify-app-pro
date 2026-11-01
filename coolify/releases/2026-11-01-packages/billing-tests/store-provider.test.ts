import { describe, expect, it, vi } from 'vitest';
import { StripeBillingStore } from '../api-source/stripe-billing-store.js';
import { ResellerProvider } from '../api-source/entitlement-provider.js';
import { ensureStripeBillingSchema } from '../api-source/stripe-billing-schema.js';
import { ensureStripePaymentSchema } from '../api-source/stripe-payment-store.js';

function database() {
  const calls: {sql:string;values:any[]}[]=[];
  const run=async(sql:string,values:any[]=[])=>{
    calls.push({sql,values});
    if(sql.startsWith('select stripe_invoice_id,livemode'))return{rows:[{stripe_invoice_id:'in_legacy',livemode:false}]};
    if(sql.startsWith('select id from public.users'))return{rows:[{id:'user_fixture'}]};
    if(sql.startsWith('select id,duration_months from public.packages'))return{rows:sql.includes('is_active=true')?[]:[{id:'pkg_three',duration_months:3}]};
    if(sql.startsWith('select id,ends_at'))return{rows:[{id:'sub_local',ends_at:new Date(Date.now()+86400000)}]};
    if(sql.startsWith('select duration_months,price_label'))return{rows:[{duration_months:6,price_label:'999 ₺'}]};
    if(sql.startsWith('select operation_id,package_slug'))return{rows:[{operation_id:'op_fixture',package_slug:'6-ay-2-kullanici',status:'creating',stripe_session_id:null,sale_price_id:'price_dual_six',sale_catalog_version:'2026-11-01'}]};
    return{rows:[],rowCount:1};
  };
  const client={query:vi.fn(run),release:vi.fn()};
  const pool:any={query:vi.fn(run),connect:vi.fn(async()=>client)};
  return{calls,pool,store:new StripeBillingStore(pool)};
}

describe('catalog persistence, historical invoices and paid provider allowlist',()=>{
  it('protects private payment credentials with RLS and explicit public/browser role revocation',async()=>{
    const f=database();await ensureStripePaymentSchema(f.pool);const sql=f.calls.map(x=>x.sql).join('\n');
    expect(sql).toContain('alter table public.stripe_payment_jobs enable row level security');
    expect(sql).toContain('revoke all on public.stripe_payment_jobs from public');
    expect(sql).toContain("array['anon', 'authenticated']::name[]");
    expect(sql).toContain('if exists (select 1 from pg_roles where rolname = role_name)');
    expect(sql).toContain("format('revoke all on public.stripe_payment_jobs from %I', role_name)");
    expect(sql).not.toContain('force row level security');
  });
  it('pins a newly reserved checkout price/version and reads those exact fields back',async()=>{
    const f=database();const op=await f.store.beginCheckout('user_fixture','6-ay-2-kullanici',false,'price_dual_six','2026-11-01');
    const insert=f.calls.find(row=>row.sql.startsWith('insert into public.stripe_checkout_sessions'))!;
    expect(insert.values).toEqual([op,'user_fixture','6-ay-2-kullanici',false,'price_dual_six','2026-11-01']);
    expect(await f.store.pendingCheckout('user_fixture',false)).toMatchObject({priceId:'price_dual_six',catalogVersion:'2026-11-01'});
  });
  it('validates the active DB catalog price rather than selling an old same-duration total',async()=>{const f=database();expect(await f.store.salePackageAvailable('6-ay-2-kullanici',6,99900)).toBe(true);expect(await f.store.salePackageAvailable('6-ay-2-kullanici',6,99000)).toBe(false);expect(await f.store.salePackageAvailable('6-ay-2-kullanici',1,99900)).toBe(false);});
  it('completes a verified legacy three-month invoice even though its sales row is inactive',async()=>{
    const f=database();const after=new Date(Date.now()+90*86400000);
    await expect(f.store.complete('in_legacy',{userId:'user_fixture',packageSlug:'3-ay',subscriptionId:'sub_stripe_legacy',providerLineId:'4242',periodEnd:after,providerExpiryBefore:null,providerExpiryAfter:after,newCredentials:null})).resolves.toBeUndefined();
    expect(f.calls.find(row=>row.sql.startsWith('update public.subscriptions'))?.values[2]).toBe('pkg_three');
    expect(f.calls.some(row=>row.sql.includes('greatest(ends_at,$2)'))).toBe(true);
    expect(f.calls.at(-1)?.sql).toBe('commit');
  });
  it('adds nullable checkout pins without modifying historical customer/subscription rows',async()=>{
    const f=database();await ensureStripeBillingSchema(f.pool);const sql=f.calls.map(x=>x.sql).join('\n');
    expect(sql).toContain('add column if not exists sale_price_id text');expect(sql).toContain('add column if not exists sale_catalog_version text');
    expect(sql).not.toMatch(/\b(?:update|delete|truncate|drop)\b/i);
  });
  it.each([13,15,16])('allows exact verified dual provider package%s for create and extension',async(packageId)=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({status:'STATUS_SUCCESS',data:{}})));
    const provider=new ResellerProvider({baseUrl:'https://provider.fixture.invalid/api',apiKey:'fixture_key',fetcher:fetcher as any});
    await provider.extendLine({lineId:'4242',packageId});await provider.createPaidLine({username:'fixture',password:'private_fixture',packageId,operationId:'in_fixture'});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams((fetcher.mock.calls[0] as any)[1].body).get('package')).toBe(String(packageId));
    const paid=new URLSearchParams((fetcher.mock.calls[1] as any)[1].body);expect(paid.get('private_cdn')).toBe('1');expect(paid.get('allow_epg')).toBe('1');
  });
  it('rejects unrelated provider package IDs without a network write',async()=>{const fetcher=vi.fn();const provider=new ResellerProvider({baseUrl:'https://provider.fixture.invalid/api',apiKey:'fixture_key',fetcher});await expect(provider.extendLine({lineId:'4242',packageId:14})).rejects.toThrow('invalid_provider_request');expect(fetcher).not.toHaveBeenCalled();});
});
