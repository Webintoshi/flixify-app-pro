import { describe, expect, it, vi } from 'vitest';
import { fulfillPaidCheckout, type CheckoutPaymentView } from '../api-source/stripe-payment.js';
import { SALE_CATALOG_VERSION } from '../api-source/stripe-sales-catalog.js';
import { saleIds } from './fixtures';

function fixture(create=false){
  const now=Date.now();let claimed=false;
  const before={id:'4242',username:'fixture',password:'fixture_private',expiresAt:now+86400000,isTrial:true,enabled:true,maxConnections:1};
  const after={...before,expiresAt:(create?now:before.expiresAt)+30*86400000,isTrial:false,maxConnections:2};
  const paid:CheckoutPaymentView={sessionId:'cs_fixture',liveMode:false,mode:'payment',status:'complete',paymentStatus:'paid',customerId:'cus_fixture',userId:'user_fixture',packageSlug:'1-ay-2-kullanici',catalogVersion:SALE_CATALOG_VERSION,users:2,priceId:'price_dual_one',quantity:1,amountTotal:39900,currency:'try',paymentIntent:{id:'pi_fixture',status:'succeeded',liveMode:false,amount:39900,amountReceived:39900,currency:'try',customerId:'cus_fixture',userId:'user_fixture',packageSlug:'1-ay-2-kullanici',catalogVersion:SALE_CATALOG_VERSION,users:2,priceId:'price_dual_one'}};
  const store={jobOwner:vi.fn(async()=> 'user_fixture'),withUserLock:vi.fn(async(_u:string,fn:()=>Promise<any>)=>fn()),claim:vi.fn(async()=>claimed?null:(claimed=true,{userId:'user_fixture',livemode:false})),checkout:vi.fn(async()=>({sessionId:'cs_fixture',userId:'user_fixture',packageSlug:'1-ay-2-kullanici',priceId:'price_dual_one',catalogVersion:SALE_CATALOG_VERSION,liveMode:false})),bindPaymentIntent:vi.fn(async()=>{}),credentialsForUser:vi.fn(async()=>create?null:{username:before.username,password:before.password}),reserveNewLine:vi.fn(async()=>({username:before.username,password:before.password})),complete:vi.fn(async()=>{}),review:vi.fn(async()=>{}),defer:vi.fn(async()=>{claimed=false;})};
  const provider={listPackages:vi.fn(async()=>[{id:13,name:'Dual',isTrial:false,duration:1,unit:'months',credits:1,maxConnections:2}]),findLine:vi.fn().mockResolvedValueOnce(create?null:before).mockResolvedValue(after),extendLine:vi.fn(async()=>{}),createPaidLine:vi.fn(async()=>{})};
  const billing={fetchCheckoutPayment:vi.fn(async()=>paid)};
  const customerStore={ownerForCustomer:vi.fn(async()=> 'user_fixture'),userEligible:vi.fn(async()=>true)};
  const deps:any={liveMode:false,allowedTestUserIds:new Set(['user_fixture']),salePriceIds:saleIds,billing,store,provider,customerStore};
  return{deps,store,provider,billing,customerStore,paid,after};
}

describe('verified one-time payment provider activation',()=>{
  it.each([false,true])('fulfills an exact paid session once with authoritative provider expiry (new=%s)',async(create)=>{
    const f=fixture(create);expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('fulfilled');expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('already-fulfilled');
    expect(f.store.bindPaymentIntent).toHaveBeenCalledWith('cs_fixture','pi_fixture');
    expect(create?f.provider.createPaidLine:f.provider.extendLine).toHaveBeenCalledTimes(1);
    expect(f.store.complete).toHaveBeenCalledWith('cs_fixture',expect.objectContaining({paymentIntentId:'pi_fixture',providerExpiryAfter:new Date(f.after.expiresAt),credentialsBefore:create?null:{username:'fixture',password:'fixture_private'}}));
  });
  it.each([{paymentStatus:'unpaid'},{status:'open'},{paymentIntent:null}])('never grants access from an unconfirmed browser/session state%j',async(change)=>{const f=fixture();Object.assign(f.paid,change);expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('awaiting-payment');expect(f.store.defer).toHaveBeenCalledOnce();expect(f.provider.extendLine).not.toHaveBeenCalled();expect(f.store.complete).not.toHaveBeenCalled();});
  it.each([{amountTotal:39899},{currency:'usd'},{quantity:2},{userId:'other_user'},{mode:'subscription'},{catalogVersion:'old'},{users:1},{priceId:'price_other'}])('rejects mismatched settled session%j before provider writes',async(change)=>{const f=fixture();Object.assign(f.paid,change);expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('review-required');expect(f.provider.extendLine).not.toHaveBeenCalled();expect(f.store.complete).not.toHaveBeenCalled();});
  it.each([{amountReceived:0},{amount:39901},{userId:'other_user'},{customerId:'cus_other'},{users:1},{priceId:'price_other'}])('rejects a mismatched fresh PaymentIntent%j',async(change)=>{const f=fixture();Object.assign(f.paid.paymentIntent!,change);expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('review-required');expect(f.provider.extendLine).not.toHaveBeenCalled();});
  it('serializes provider work per user and leaves busy jobs unclaimed',async()=>{const f=fixture();f.store.withUserLock.mockResolvedValue(null);expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('busy');expect(f.store.claim).not.toHaveBeenCalled();});
  it('does not repeat a possibly applied provider write after a timeout',async()=>{const f=fixture();f.provider.extendLine.mockRejectedValue(new Error('timeout'));expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('fulfilled');expect(f.provider.extendLine).toHaveBeenCalledOnce();});
  it('requires exact paid capacity and a full package advance before completion',async()=>{for(const change of [{maxConnections:1},{expiresAt:Date.now()+3*3600000}]){const f=fixture();Object.assign(f.after,change);expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('review-required');expect(f.store.complete).not.toHaveBeenCalled();expect(f.provider.extendLine).toHaveBeenCalledOnce();}});
  it('reserves unique PaymentIntent before provider writes and stops on a duplicate PI',async()=>{const f=fixture();f.store.bindPaymentIntent.mockRejectedValue(new Error('payment_intent_conflict'));expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('review-required');expect(f.provider.extendLine).not.toHaveBeenCalled();});
  it('puts credential compare-and-swap failure into review without retrying the provider',async()=>{const f=fixture();f.store.complete.mockRejectedValue(new Error('billing_credentials_conflict'));expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('review-required');expect(f.provider.extendLine).toHaveBeenCalledOnce();expect(await fulfillPaidCheckout('cs_fixture',f.deps)).toBe('already-fulfilled');});
});
