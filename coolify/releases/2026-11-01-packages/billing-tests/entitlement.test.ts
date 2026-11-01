import { describe, expect, it, vi } from 'vitest';
import { fulfillPaidInvoice } from '../api-source/stripe-entitlement.js';
import { legacyIds, saleIds } from './fixtures';

function fixture({slug='1-ay-2-kullanici',priceId='price_dual_one',amount=39900,packageId=13,months=1,unit='months',connections=2,observed=2,create=false}={}){
  const now=Date.now();const periodEnd=new Date(now+months*30*86400000);
  let claimed=false;
  const store={claim:vi.fn(async()=>claimed?null:(claimed=true,{livemode:false})),ownerForCustomer:vi.fn(async()=> 'user_fixture'),userEligible:vi.fn(async()=>true),credentialsForUser:vi.fn(async()=>create?null:{username:'fixture',password:'private_fixture'}),reserveNewLine:vi.fn(async()=>({username:'fixture',password:'private_fixture'})),complete:vi.fn(async()=>{}),review:vi.fn(async()=>{})};
  const line={id:'4242',username:'fixture',password:'private_fixture',expiresAt:now+86400000,enabled:true,isTrial:false,maxConnections:1};
  const provider={listPackages:vi.fn(async()=>[{id:packageId,name:'Fixture paid',isTrial:false,duration:unit==='years'?months/12:months,unit,maxConnections:connections,credits:1}]),findLine:vi.fn().mockResolvedValueOnce(create?null:line).mockResolvedValue({...line,expiresAt:periodEnd.getTime(),maxConnections:observed}),extendLine:vi.fn(async()=>{}),createPaidLine:vi.fn(async()=>{})};
  const billing={fetchPaidInvoice:vi.fn(async()=>({id:'in_fixture',livemode:false,status:'paid',subscriptionStatus:'active',amountPaid:amount,currency:'try',customerId:'cus_fixture',subscriptionId:'sub_fixture',userId:'user_fixture',packageSlug:slug,priceId,periodEnd}))};
  const deps:any={store,provider,billing,priceIds:legacyIds,salePriceIds:saleIds,liveMode:false,allowedTestUserIds:new Set(['user_fixture'])};
  return{store,provider,deps};
}

describe('exact paid line capacity and legacy renewals',()=>{
  it.each([['1-ay','price_old_one',24900,8,1],['3-ay','price_old_three',64000,9,3],['6-ay','price_old_six',99000,10,6],['12-ay','price_old_twelve',160000,11,12]])('continues existing %s subscriptions at the unchanged historical price',async(slug,priceId,amount,packageId,months)=>{const f=fixture({slug:String(slug),priceId:String(priceId),amount:Number(amount),packageId:Number(packageId),months:Number(months),unit:months===12?'years':'months',connections:1,observed:1});expect(await fulfillPaidInvoice('in_fixture',f.deps)).toBe('fulfilled');});
  it('rejects a new-price invoice paid at the old lower amount before provider writes',async()=>{const f=fixture({slug:'1-ay',priceId:'price_new_one',amount:24900,packageId:8,connections:1,observed:1});expect(await fulfillPaidInvoice('in_fixture',f.deps)).toBe('review-required');expect(f.provider.extendLine).not.toHaveBeenCalled();});
});
