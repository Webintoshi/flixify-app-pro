import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerStripeBillingRoutes } from '../api-source/stripe-billing-routes.js';
import { SALE_CATALOG_VERSION, STRIPE_PUBLISHABLE_KEY } from '../api-source/stripe-sales-catalog.js';
import { legacyIds, saleIds } from './fixtures';

function fixture() {
  const store = {
    accountState: vi.fn(async () => ({ customerId: 'cus_fixture', activeSubscription: false, openCheckout: false })),
    pendingCheckout: vi.fn(async (): Promise<any> => null),
    salePackageAvailable: vi.fn(async () => true),
    expireCheckout: vi.fn(async () => {}), beginCheckout: vi.fn(async () => 'op_new'),
    saveCustomer: vi.fn(async () => 'cus_fixture'), completeCheckout: vi.fn(async () => {}),
    failCheckout: vi.fn(async () => {}), billingStatus: vi.fn(async () => ({ status: 'none' })), customerFor: vi.fn(async () => 'cus_fixture')
  };
  const stripe = {
    verifyCheckoutPackage: vi.fn(async () => {}),
    createCustomer: vi.fn(async () => ({id:'cus_fixture'})),
    createCheckoutSession: vi.fn(async () => ({id:'cs_new',clientSecret:'cs_new_secret_fixture'})),
    retrieveCheckoutSession: vi.fn(async () => ({id:'cs_old',status:'open',paymentStatus:'unpaid',url:'https://checkout.stripe.com/c/pay/cs_old',liveMode:false,customerId:'cus_fixture',userId:'fixture-user',packageSlug:'1-ay',priceId:'price_old_one',quantity:1,mode:'subscription',uiMode:'hosted',clientSecret:null})),
    expireCheckoutSession: vi.fn(async () => {}), createPortalSession: vi.fn(async () => ({url:'https://billing.stripe.com/p/session_fixture'}))
  };
  const verifyProviderPackage = vi.fn(async () => true);
  const app = Fastify();
  registerStripeBillingRoutes(app, {enabled:true,liveMode:false,allowedTestUserIds:new Set(['fixture-user']),priceIds:legacyIds,salePriceIds:saleIds,authenticate:async()=>({userId:'fixture-user'}),store,stripe,verifyProviderPackage});
  const headers = {authorization:'Bearer fixture'};
  const buy = (slug='1-ay') => app.inject({method:'POST',url:'/me/billing/checkout-session',headers,payload:{packageSlug:slug,priceId:'price_attacker',amountMinor:1}});
  const pending = {operationId:'op_old',packageSlug:'1-ay',status:'open',sessionId:'cs_old',priceId:null,catalogVersion:null};
  return {app,store,stripe,verifyProviderPackage,buy,headers,pending};
}

describe('new checkout catalog and reservation version pins', () => {
  it('publishes exact six verified sale options, not legacy prices', async () => {
    const {app,headers}=fixture();
    const response=await app.inject({method:'GET',url:'/me/billing/status',headers});
    expect(response.json()).toEqual({status:'none',checkoutEnabled:true,checkoutPackages:[
      {packageSlug:'1-ay',amountTry:250,users:1,durationMonths:1}, {packageSlug:'6-ay',amountTry:699,users:1,durationMonths:6}, {packageSlug:'12-ay',amountTry:999,users:1,durationMonths:12},
      {packageSlug:'1-ay-2-kullanici',amountTry:399,users:2,durationMonths:1}, {packageSlug:'6-ay-2-kullanici',amountTry:999,users:2,durationMonths:6}, {packageSlug:'12-ay-2-kullanici',amountTry:1399,users:2,durationMonths:12}
    ]}); await app.close();
  });
  it('pins the new dual price on reservation and validates provider capacity two before checkout',async()=>{
    const f=fixture();expect((await f.buy('12-ay-2-kullanici')).statusCode).toBe(200);
    expect(f.verifyProviderPackage).toHaveBeenCalledWith(16,12,2);
    expect(f.store.beginCheckout).toHaveBeenCalledWith('fixture-user','12-ay-2-kullanici',false,'price_dual_twelve',SALE_CATALOG_VERSION);
    expect(f.stripe.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({mode:'payment',ui_mode:'embedded_page',line_items:[{price:'price_dual_twelve',quantity:1}],metadata:expect.objectContaining({package_slug:'12-ay-2-kullanici',catalog_version:SALE_CATALOG_VERSION,package_users:'2',sale_price_id:'price_dual_twelve'})}),'op_new');await f.app.close();
  });
  it('rejects a new three-month purchase without creating any checkout',async()=>{const f=fixture();expect((await f.buy('3-ay')).statusCode).toBe(400);expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();});
  it('holds old ambiguous creating reservations instead of replaying an old idempotency key at a new price',async()=>{
    const f=fixture();f.store.pendingCheckout.mockResolvedValue({...f.pending,status:'creating',sessionId:null});
    expect((await f.buy()).statusCode).toBe(409);expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();expect(f.store.beginCheckout).not.toHaveBeenCalled();await f.app.close();
  });
  it('expires the verified old unpaid open checkout before starting the new price on the same slug',async()=>{
    const f=fixture();f.store.pendingCheckout.mockResolvedValue(f.pending);expect((await f.buy()).statusCode).toBe(200);
    expect(f.stripe.expireCheckoutSession).toHaveBeenCalledWith('cs_old');expect(f.store.expireCheckout).toHaveBeenCalledWith('op_old','cs_old');
    expect(f.stripe.createCheckoutSession).toHaveBeenCalledTimes(1);expect(f.stripe.createCheckoutSession.mock.calls[0][0].line_items[0].price).toBe('price_new_one');await f.app.close();
  });
  it('reuses only a matching new open checkout with exact price and quantity',async()=>{
    const f=fixture();f.store.pendingCheckout.mockResolvedValue({...f.pending,priceId:'price_new_one',catalogVersion:SALE_CATALOG_VERSION});
    f.stripe.retrieveCheckoutSession.mockResolvedValue({...await f.stripe.retrieveCheckoutSession(),priceId:'price_new_one',mode:'payment',uiMode:'embedded_page',clientSecret:'cs_old_secret_fixture'});
    expect((await f.buy()).json()).toEqual({clientSecret:'cs_old_secret_fixture',sessionId:'cs_old',publishableKey:STRIPE_PUBLISHABLE_KEY});expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();
  });
  it('retries an exact new creating reservation with its original pinned operation key',async()=>{
    const f=fixture();f.store.pendingCheckout.mockResolvedValue({...f.pending,status:'creating',sessionId:null,priceId:'price_new_one',catalogVersion:SALE_CATALOG_VERSION});
    expect((await f.buy()).statusCode).toBe(200);expect(f.stripe.createCheckoutSession).toHaveBeenCalledWith(expect.anything(),'op_old');await f.app.close();
  });
  it('never creates another checkout for paid, active, unverified provider, unavailable DB package or invalid Stripe price states',async()=>{
    const active=fixture();active.store.accountState.mockResolvedValue({customerId:'cus_fixture',activeSubscription:true,openCheckout:false});expect((await active.buy()).statusCode).toBe(409);expect(active.stripe.createCheckoutSession).not.toHaveBeenCalled();await active.app.close();
    const paid=fixture();paid.store.pendingCheckout.mockResolvedValue({...paid.pending,status:'completed'});expect((await paid.buy()).statusCode).toBe(409);expect(paid.stripe.createCheckoutSession).not.toHaveBeenCalled();await paid.app.close();
    for(const failure of ['provider','catalog','price']){const f=fixture();if(failure==='provider')f.verifyProviderPackage.mockResolvedValue(false);if(failure==='catalog')f.store.salePackageAvailable.mockResolvedValue(false);if(failure==='price')f.stripe.verifyCheckoutPackage.mockRejectedValue(new Error('stripe_price_mismatch'));expect((await f.buy()).statusCode).toBe(503);expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();}
  });
});
