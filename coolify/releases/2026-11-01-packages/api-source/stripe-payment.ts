import type { ProviderLine, ProviderPackage } from './entitlement-provider.js';
import { resolveSalePackage, providerDurationMonths, SALE_CATALOG_VERSION, type SalePriceIds } from './stripe-sales-catalog.js';
type Credentials={username:string;password:string};
export type CheckoutPin={sessionId:string;userId:string;packageSlug:string;priceId:string|null;catalogVersion:string|null;liveMode:boolean};
type Intent={id:string;status:string;liveMode:boolean;amount:number;amountReceived:number;currency:string;customerId:string|null;userId:string|null;packageSlug:string|null;catalogVersion:string|null;users:number;priceId:string|null};
export type CheckoutPaymentView={sessionId:string;liveMode:boolean;mode:string|null;status:string|null;paymentStatus:string;customerId:string|null;userId:string|null;packageSlug:string|null;catalogVersion:string|null;users:number;priceId:string|null;quantity:number|null;amountTotal:number|null;currency:string|null;paymentIntent:Intent|null};
export type PaymentCompletion={userId:string;packageSlug:string;paymentIntentId:string;providerLineId:string;providerExpiryBefore:Date|null;providerExpiryAfter:Date;credentialsBefore:Credentials|null;credentialsAfter:Credentials};
type Store={jobOwner(sessionId:string):Promise<string|null>;withUserLock<T>(userId:string,work:()=>Promise<T>):Promise<T|null>;claim(sessionId:string):Promise<{userId:string;livemode:boolean}|null>;checkout(sessionId:string):Promise<CheckoutPin|null>;bindPaymentIntent(sessionId:string,piId:string):Promise<void>;credentialsForUser(userId:string):Promise<Credentials|null>;reserveNewLine(sessionId:string,userId:string):Promise<Credentials>;complete(sessionId:string,c:PaymentCompletion):Promise<void>;review(sessionId:string,code:string):Promise<void>;defer(sessionId:string):Promise<void>;expire?(sessionId:string,userId:string,liveMode:boolean):Promise<void>;qualifyReferrals?(sessionId:string):Promise<void>};
export type PaymentDependencies={liveMode:boolean;allowedTestUserIds:Set<string>;salePriceIds?:SalePriceIds;billing:{fetchCheckoutPayment(sessionId:string):Promise<CheckoutPaymentView>};store:Store;customerStore:{ownerForCustomer(customerId:string,liveMode:boolean):Promise<string|null>;userEligible(userId:string):Promise<boolean>};provider:{listPackages():Promise<ProviderPackage[]>;findLine(username:string):Promise<ProviderLine|null>;extendLine(input:{lineId:string;packageId:number}):Promise<void>;createPaidLine(input:{username:string;password:string;packageId:number;operationId:string}):Promise<void>}};
type Result='fulfilled'|'already-fulfilled'|'review-required'|'awaiting-payment'|'busy';

let activePayments=0;
const waitingPayments:(()=>void)[]=[];
export async function fulfillPaidCheckout(sessionId:string,deps:PaymentDependencies):Promise<Result>{
  if(activePayments>=2)await new Promise<void>(resolve=>waitingPayments.push(resolve));else activePayments++;
  try{const result=await processPaidCheckout(sessionId,deps);if(result==='fulfilled'||result==='already-fulfilled'){try{await deps.store.qualifyReferrals?.(sessionId);}catch{console.warn('[referrals] Verified payment qualification deferred');}}return result;}finally{const next=waitingPayments.shift();if(next)next();else activePayments--;}
}
async function processPaidCheckout(sessionId:string,deps:PaymentDependencies):Promise<Result>{
  const owner=await deps.store.jobOwner(sessionId);if(!owner)return'already-fulfilled';
  return await deps.store.withUserLock<Result>(owner,async()=>{
    const job=await deps.store.claim(sessionId);if(!job)return'already-fulfilled';
    let providerWriteStarted=false;
    try{
      const pin=await deps.store.checkout(sessionId);const paid=await deps.billing.fetchCheckoutPayment(sessionId);
      if(!pin||job.userId!==owner||pin.userId!==owner||pin.liveMode!==deps.liveMode||job.livemode!==deps.liveMode||paid.sessionId!==sessionId||paid.mode!=='payment'||paid.liveMode!==deps.liveMode||paid.userId!==owner)throw new Error('payment_owner_mismatch');
      if(!deps.liveMode&&!deps.allowedTestUserIds.has(owner))throw new Error('stripe_test_user_not_allowed');
      if(paid.paymentStatus!=='paid'||paid.status!=='complete'||paid.paymentIntent?.status!=='succeeded'){await deps.store.defer(sessionId);if(paid.status==='expired'&&paid.paymentStatus==='unpaid')await deps.store.expire?.(sessionId,owner,deps.liveMode);return'awaiting-payment';}
      const selected=resolveSalePackage(pin.packageSlug,deps.liveMode,deps.salePriceIds);const pi=paid.paymentIntent;
      if(!selected||pin.catalogVersion!==SALE_CATALOG_VERSION||pin.priceId!==selected.priceId||paid.packageSlug!==selected.slug||paid.catalogVersion!==selected.catalogVersion||paid.priceId!==selected.priceId||paid.users!==selected.users||paid.quantity!==1||paid.currency!=='try'||paid.amountTotal!==selected.amountMinor||!pi||!/^pi_[a-zA-Z0-9_]+$/.test(pi.id)||pi.liveMode!==deps.liveMode||pi.amount!==selected.amountMinor||pi.amountReceived!==selected.amountMinor||pi.currency!=='try'||pi.userId!==owner||pi.customerId!==paid.customerId||pi.packageSlug!==selected.slug||pi.catalogVersion!==selected.catalogVersion||pi.priceId!==selected.priceId||pi.users!==selected.users)throw new Error('payment_amount_mismatch');
      if(!paid.customerId||await deps.customerStore.ownerForCustomer(paid.customerId,deps.liveMode)!==owner||!await deps.customerStore.userEligible(owner))throw new Error('payment_customer_mismatch');
      await deps.store.bindPaymentIntent(sessionId,pi.id);
      const pkg=(await deps.provider.listPackages()).find(x=>x.id===selected.providerPackageId);
      if(!pkg||pkg.isTrial||providerDurationMonths(pkg)!==selected.intervalMonths||pkg.maxConnections!==selected.users)throw new Error('provider_package_mismatch');
      const beforeCredentials=await deps.store.credentialsForUser(owner);const credentials=beforeCredentials??await deps.store.reserveNewLine(sessionId,owner);
      const before=await deps.provider.findLine(credentials.username);
      if(before&&(before.username!==credentials.username||before.password!==credentials.password))throw new Error('provider_line_mismatch');
      const startedAt=Date.now();providerWriteStarted=true;
      try{if(before)await deps.provider.extendLine({lineId:before.id,packageId:selected.providerPackageId});else await deps.provider.createPaidLine({username:credentials.username,password:credentials.password,packageId:selected.providerPackageId,operationId:sessionId});}catch{/* Read back a possibly applied write; never repeat it. */}
      const after=await deps.provider.findLine(credentials.username);
      if(!after||after.username!==credentials.username||after.password!==credentials.password||!after.enabled||after.isTrial||after.maxConnections!==selected.users||before&&after.id!==before.id)throw new Error('provider_result_unverified');
      const base=Math.max(startedAt,before?.expiresAt??0);const days=86400000;
      if(after.expiresAt<base+(selected.intervalMonths*30-2)*days||after.expiresAt>base+(selected.intervalMonths*31+3)*days)throw new Error('provider_duration_mismatch');
      await deps.store.complete(sessionId,{userId:owner,packageSlug:selected.slug,paymentIntentId:pi.id,providerLineId:after.id,providerExpiryBefore:before?new Date(before.expiresAt):null,providerExpiryAfter:new Date(after.expiresAt),credentialsBefore:beforeCredentials,credentialsAfter:credentials});
      return'fulfilled';
    }catch(error){await deps.store.review(sessionId,providerWriteStarted?'provider_result_uncertain':error instanceof Error?error.message:'payment_processing_failed');return'review-required';}
  })??'busy';
}
