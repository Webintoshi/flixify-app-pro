import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerStripeBillingRoutes } from '../api-source/stripe-billing-routes.js';
import { legacyIds, saleIds } from '../../2026-11-01-packages/billing-tests/fixtures';
const campaign='welcome-monthly-50-v1';
function fixture(eligible=true){
 const store={accountState:vi.fn(async()=>({customerId:'cus_fixture',activeSubscription:false,openCheckout:false})),pendingCheckout:vi.fn(async():Promise<any>=>null),salePackageAvailable:vi.fn(async()=>true),welcomeOfferEligible:vi.fn(async()=>eligible),expireCheckout:vi.fn(async()=>{}),beginCheckout:vi.fn(async()=> 'op_new'),saveCustomer:vi.fn(async()=> 'cus_fixture'),completeCheckout:vi.fn(async()=>{}),failCheckout:vi.fn(async()=>{}),billingStatus:vi.fn(async()=>({status:'none'})),customerFor:vi.fn(async()=> 'cus_fixture')};
 const stripe={verifyCheckoutPackage:vi.fn(async()=>{}),verifyWelcomeCoupon:vi.fn(async()=>{}),createCustomer:vi.fn(async()=>({id:'cus_fixture'})),createCheckoutSession:vi.fn(async()=>({id:'cs_new',clientSecret:'cs_new_secret_fixture'})),createPortalSession:vi.fn(async()=>({url:'https://billing.stripe.com/p/fixture'})),retrieveCheckoutSession:vi.fn(async():Promise<any>=>null),expireCheckoutSession:vi.fn(async()=>{})};
 const app=Fastify();registerStripeBillingRoutes(app,{enabled:true,liveMode:false,allowedTestUserIds:new Set(['fixture-user']),priceIds:legacyIds,salePriceIds:saleIds,authenticate:async()=>({userId:'fixture-user'}),store,stripe,verifyProviderPackage:async()=>true} as any);
 const buy=(slug='1-ay',offerId:unknown=campaign)=>app.inject({method:'POST',url:'/me/billing/checkout-session',payload:{packageSlug:slug,...(offerId===undefined?{}:{offerId}),amountMinor:1,coupon:'attacker'}});
 return{app,store,stripe,buy};
}
describe('account-bound welcome Checkout',()=>{
 it.each([['1-ay',12500],['1-ay-2-kullanici',19950]])('pins exactly half of the monthly base price for %s',async(slug,amount)=>{
  const f=fixture();expect((await f.buy(slug as string)).statusCode).toBe(200);
  const params=f.stripe.createCheckoutSession.mock.calls[0][0] as any;
  expect(params.discounts).toEqual([{coupon:'flixify_welcome_monthly_50_v1'}]);
  expect(params.metadata).toMatchObject({welcome_offer_id:campaign,welcome_amount_minor:String(amount),welcome_coupon_id:'flixify_welcome_monthly_50_v1'});
  expect(f.store.beginCheckout.mock.calls[0][5]).toEqual({offerId:campaign,couponId:'flixify_welcome_monthly_50_v1',amountMinor:amount});await f.app.close();
 });
 it('refuses an old account that forges an offer id',async()=>{const f=fixture(false);expect((await f.buy()).statusCode).toBe(403);expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();});
 it.each(['6-ay','12-ay','6-ay-2-kullanici','12-ay-2-kullanici'])('does not discount a nonmonthly plan%s',async(slug)=>{const f=fixture();expect((await f.buy(slug)).statusCode).toBe(400);expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();});
 it.each(['wrong',123,null])('rejects a malformed or unknown offer%j',async(value)=>{const f=fixture();expect((await f.buy('1-ay',value)).statusCode).toBe(400);await f.app.close();});
 it('retains normal pricing when no offer is requested',async()=>{const f=fixture();await f.app.inject({method:'POST',url:'/me/billing/checkout-session',payload:{packageSlug:'1-ay'}});expect((f.stripe.createCheckoutSession.mock.calls[0][0] as any).discounts).toBeUndefined();await f.app.close();});
 it('advertises only owned monthly quotes at the exact discounted amounts',async()=>{for(const eligible of[true,false]){const f=fixture(eligible);const res=await f.app.inject({method:'GET',url:'/me/billing/status'});expect(res.headers['cache-control']).toBe('private, no-store');expect(res.json().checkoutPackages[0]).toEqual({packageSlug:'1-ay',amountTry:eligible?125:250,users:1,durationMonths:1,...(eligible?{offerId:campaign}:{})});expect(res.json().checkoutPackages[3].amountTry).toBe(eligible?199.5:399);expect(res.json().checkoutPackages[1].amountTry).toBe(699);await f.app.close();}});
 it('resumes only its exact unpaid owned offered session without creating a second charge',async()=>{const f=fixture();const pending={operationId:'op_old',packageSlug:'1-ay',status:'open',sessionId:'cs_old',priceId:saleIds['1-ay'],catalogVersion:'2026-11-01-one-time',offerId:campaign,couponId:'flixify_welcome_monthly_50_v1',expectedAmountMinor:12500};f.store.pendingCheckout.mockResolvedValue(pending);f.stripe.retrieveCheckoutSession.mockResolvedValue({id:'cs_old',status:'open',paymentStatus:'unpaid',liveMode:false,customerId:'cus_fixture',userId:'fixture-user',packageSlug:'1-ay',priceId:saleIds['1-ay'],quantity:1,mode:'payment',uiMode:'embedded_page',clientSecret:'cs_old_secret',offerId:campaign,couponId:'flixify_welcome_monthly_50_v1',expectedAmountMinor:12500,couponIds:['flixify_welcome_monthly_50_v1'],amountTotal:12500,amountSubtotal:25000,amountDiscount:12500});expect((await f.buy()).json().sessionId).toBe('cs_old');expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();});
 it('does not reuse an ambiguous full-price creating operation for the discounted request',async()=>{const f=fixture();f.store.pendingCheckout.mockResolvedValue({operationId:'op_old',packageSlug:'1-ay',status:'creating',sessionId:null,priceId:saleIds['1-ay'],catalogVersion:'2026-11-01-one-time'});expect((await f.buy()).statusCode).toBe(409);expect(f.stripe.createCheckoutSession).not.toHaveBeenCalled();await f.app.close();});
 it('retains its reservation after an uncertain Stripe create instead of admitting a second charge',async()=>{const f=fixture();f.stripe.createCheckoutSession.mockRejectedValue(new Error('timeout'));expect((await f.buy()).statusCode).toBe(503);expect(f.store.failCheckout).not.toHaveBeenCalled();await f.app.close();});

});
