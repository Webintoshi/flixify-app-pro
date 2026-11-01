import type Stripe from 'stripe';
import type { CheckoutPaymentView } from './stripe-payment.js';
const id=(value:{id:string}|string|null|undefined):string|null=>typeof value==='string'?value:value?.id??null;
export function createStripePaymentReader(stripe:Stripe):{fetchCheckoutPayment(sessionId:string):Promise<CheckoutPaymentView>}{
  return{async fetchCheckoutPayment(sessionId){
    const session=await stripe.checkout.sessions.retrieve(sessionId,{expand:['line_items.data.price']});
    const rows=session.line_items;const item=rows&&!rows.has_more&&rows.data.length===1?rows.data[0]:null;
    const intentId=id(session.payment_intent);const pi=intentId?await stripe.paymentIntents.retrieve(intentId):null;
    return{sessionId:session.id,liveMode:session.livemode,mode:session.mode,status:session.status,paymentStatus:session.payment_status,customerId:id(session.customer),userId:session.client_reference_id,packageSlug:session.metadata?.package_slug??null,catalogVersion:session.metadata?.catalog_version??null,users:Number(session.metadata?.package_users??0),priceId:item?id(item.price):null,quantity:item?.quantity??null,amountTotal:session.amount_total,currency:session.currency,paymentIntent:pi?{id:pi.id,status:pi.status,liveMode:pi.livemode,amount:pi.amount,amountReceived:pi.amount_received,currency:pi.currency,customerId:id(pi.customer),userId:pi.metadata.user_id??null,packageSlug:pi.metadata.package_slug??null,catalogVersion:pi.metadata.catalog_version??null,users:Number(pi.metadata.package_users??0),priceId:pi.metadata.sale_price_id??null}:null};
  }};
}
