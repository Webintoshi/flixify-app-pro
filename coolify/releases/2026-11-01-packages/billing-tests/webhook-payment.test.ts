import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerStripeWebhook } from '../api-source/stripe-webhook.js';
describe('one-time webhook queue boundary',()=>{
  it.each(['checkout.session.completed','checkout.session.async_payment_succeeded'])('only queues signed payment event%s without granting access',async(type)=>{
    const app=Fastify();const enqueue=vi.fn(async()=>true),wake=vi.fn(),wakePayment=vi.fn();
    registerStripeWebhook(app,{liveMode:false,verify:()=>({id:'evt_fixture',type,livemode:false,data:{object:{id:'cs_fixture',mode:'payment'}}}),store:{acceptEvent:async()=>({invoiceId:null})},wake,paymentStore:{enqueue},wakePayment});
    expect((await app.inject({method:'POST',url:'/webhooks/stripe',headers:{'stripe-signature':'fixture','content-type':'application/json'},payload:'{}'})).statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith('cs_fixture',false);expect(wakePayment).toHaveBeenCalledExactlyOnceWith('cs_fixture');expect(wake).not.toHaveBeenCalled();await app.close();
  });
  it('does not treat subscription checkout events as one-time paid jobs',async()=>{const app=Fastify();const enqueue=vi.fn();registerStripeWebhook(app,{liveMode:false,verify:()=>({id:'evt_old',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_legacy',mode:'subscription'}}}),store:{acceptEvent:async()=>({invoiceId:null})},wake:vi.fn(),paymentStore:{enqueue}});await app.inject({method:'POST',url:'/webhooks/stripe',headers:{'stripe-signature':'fixture','content-type':'application/json'},payload:'{}'});expect(enqueue).not.toHaveBeenCalled();await app.close();});
});
