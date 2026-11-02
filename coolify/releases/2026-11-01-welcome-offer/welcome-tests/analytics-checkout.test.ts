import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerStripeBillingRoutes } from '../api-source/stripe-billing-routes.js';
import { legacyIds, saleIds } from '../../2026-11-01-packages/billing-tests/fixtures';
function fixture() {
 const app=Fastify(); const seen:unknown[]=[];
 const store={accountState:async()=>({customerId:'cus_fixture',activeSubscription:false,openCheckout:false}),pendingCheckout:async()=>null,salePackageAvailable:async()=>true,expireCheckout:async()=>{},beginCheckout:async()=> 'op_fixture',saveCustomer:async()=> 'cus_fixture',completeCheckout:async()=>{},failCheckout:async()=>{},billingStatus:async()=>({status:'none'}),customerFor:async()=> 'cus_fixture',saveAnalyticsAttribution:vi.fn(async(...args:unknown[])=>{seen.push(args);})};
 registerStripeBillingRoutes(app,{enabled:true,liveMode:false,allowedTestUserIds:new Set(['fixture-user']),priceIds:legacyIds,salePriceIds:saleIds,authenticate:async()=>({userId:'fixture-user'}),store,stripe:{verifyCheckoutPackage:async()=>{},createCustomer:async()=>({id:'cus_fixture'}),createCheckoutSession:async()=>({id:'cs_fixture',clientSecret:'fixture-private-secret'}),createPortalSession:async()=>({url:'https://billing.stripe.com/fixture'})},verifyProviderPackage:async()=>true});
 const buy=(analytics?:unknown)=>app.inject({method:'POST',url:'/me/billing/checkout-session',headers:{authorization:'Bearer fixture'},payload:{packageSlug:'1-ay',...(analytics?{analytics}:{})}});
 return{app,store,seen,buy};
}
it('binds consented attribution to the actual checkout operation without exposing payment data to analytics',async()=>{const f=fixture();const analytics={consentVersion:1,clientId:'12345.67890',sessionId:12345,clientPlatform:'web',sourcePlatform:'macos'};expect((await f.buy(analytics)).statusCode).toBe(200);expect(f.seen).toEqual([['op_fixture','fixture-user',analytics]]);await f.app.close();});
it('ignores absent or malformed analytics and retains checkout when analytics persistence fails',async()=>{const f=fixture();expect((await f.buy()).statusCode).toBe(200);expect((await f.buy({clientId:'private',raw:'invalid'})).statusCode).toBe(200);expect(f.seen).toEqual([]);f.store.saveAnalyticsAttribution.mockRejectedValue(Error('private-storage-detail'));expect((await f.buy({consentVersion:1,clientId:'12345.67890',sessionId:12345,clientPlatform:'pwa'})).statusCode).toBe(200);await f.app.close();});
