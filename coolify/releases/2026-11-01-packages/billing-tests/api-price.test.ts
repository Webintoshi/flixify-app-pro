import { describe, expect, it, vi } from 'vitest';
import { createStripeBillingApi } from '../api-source/stripe-billing-api.js';
import { assertStripePrice } from '../api-source/stripe-price-validation.js';
import { resolveSalePackage, SALE_CATALOG_VERSION } from '../api-source/stripe-sales-catalog.js';
import { legacyIds, saleIds } from './fixtures';

function fixture() {
  const selected=resolveSalePackage('6-ay-2-kullanici',false,saleIds)!;
  const price={id:selected.priceId,active:true,livemode:false,currency:'try',unit_amount:99900,type:'one_time',recurring:null,metadata:{flixify_package_slug:selected.slug,flixify_users:'2',flixify_catalog_version:SALE_CATALOG_VERSION}};
  const stripe:any={prices:{retrieve:vi.fn(async()=>price)},checkout:{sessions:{create:vi.fn(async()=>({id:'cs_fixture',client_secret:'cs_fixture_secret_private',mode:'payment',ui_mode:'embedded_page',livemode:false})),retrieve:vi.fn(async()=>({id:'cs_old',status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/cs_old',livemode:false,customer:'cus_fixture',client_reference_id:'fixture-user',metadata:{package_slug:'1-ay'},line_items:{has_more:false,data:[{quantity:1,price:{id:'price_old_one'}}]}}))}}};
  const config:any={liveMode:false,priceIds:legacyIds};
  const api=createStripeBillingApi(stripe,config,saleIds);
  const meta={package_slug:selected.slug,user_id:'fixture-user',package_users:'2',catalog_version:SALE_CATALOG_VERSION,sale_price_id:selected.priceId};
  const params:any={mode:'payment',ui_mode:'embedded_page',redirect_on_completion:'if_required',customer:'cus_fixture',client_reference_id:'fixture-user',payment_method_types:['card'],line_items:[{price:selected.priceId,quantity:1}],return_url:'https://flixify.vip/odeme-sonucu',metadata:meta,payment_intent_data:{metadata:meta}};
  return{selected,price,stripe,api,params};
}

describe('actual Stripe Price verification before sale',()=>{
  it('validates the new exact price object and never submits caller-provided amount or user count',async()=>{const f=fixture();await expect(f.api.createCheckoutSession(f.params,'op_fixture')).resolves.toMatchObject({id:'cs_fixture'});expect(f.stripe.prices.retrieve).toHaveBeenCalledWith('price_dual_six');expect(f.stripe.checkout.sessions.create).toHaveBeenCalledOnce();});
  it.each([{unit_amount:99000},{livemode:true},{active:false},{currency:'usd'},{recurring:{interval:'month',interval_count:1}},{metadata:{flixify_package_slug:'6-ay-2-kullanici',flixify_users:'1',flixify_catalog_version:SALE_CATALOG_VERSION}}])('does not create a checkout when the Price object mismatches%j',async(change)=>{const f=fixture();f.stripe.prices.retrieve.mockResolvedValue({...f.price,...change});await expect(f.api.createCheckoutSession(f.params,'op_fixture')).rejects.toThrow('stripe_price_mismatch');expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled();});
  it('rejects changed checkout payment-intent metadata before any chargeable session is created',async()=>{const f=fixture();f.params.payment_intent_data.metadata={...f.params.metadata,package_users:'1'};await expect(f.api.createCheckoutSession(f.params,'op_fixture')).rejects.toThrow('stripe_price_mismatch');expect(f.stripe.checkout.sessions.create).not.toHaveBeenCalled();});
  it('reads the real old session line item instead of inferring its price from the reused package slug',async()=>{const f=fixture();expect(await f.api.retrieveCheckoutSession!('cs_old')).toMatchObject({priceId:'price_old_one',quantity:1});expect(f.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_old',{expand:['line_items.data.price']});});
  it('validates legacy price objects without requiring newly introduced catalog metadata',()=>{const selected={slug:'3-ay',intervalMonths:3,amountMinor:64000,providerPackageId:9,priceId:'price_old_three',currency:'try'} as const;expect(()=>assertStripePrice({id:'price_old_three',active:true,livemode:false,currency:'try',unit_amount:64000,type:'recurring',recurring:{interval:'month',interval_count:3}},selected,false)).not.toThrow();});
});
