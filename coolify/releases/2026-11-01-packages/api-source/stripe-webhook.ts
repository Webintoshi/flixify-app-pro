import type { FastifyInstance } from 'fastify';

export type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: { id: string; [key: string]: unknown } };
};

type Dependencies = {
  liveMode: boolean;
  verify(rawBody: Buffer, signature: string): StripeWebhookEvent;
  store: { acceptEvent(event: StripeWebhookEvent): Promise<{ invoiceId: string | null }> };
  wake(invoiceId: string): void;
  paymentStore?: { enqueue(sessionId: string, liveMode: boolean): Promise<boolean> };
  wakePayment?(sessionId: string): void;
};

/** The JSON parser is scoped to this plugin so only Stripe receives raw bytes. */
export function registerStripeWebhook(app: FastifyInstance, deps: Dependencies): void {
  app.register(async child => {
    child.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    child.post('/webhooks/stripe', async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: 'invalid_signature' });
      }
      let event: StripeWebhookEvent;
      try {
        event = deps.verify(request.body, signature);
      } catch {
        return reply.code(400).send({ error: 'invalid_signature' });
      }
      if (event.livemode !== deps.liveMode || !event.id || !event.data?.object?.id) {
        return reply.code(400).send({ error: 'invalid_event' });
      }
      const saved = await deps.store.acceptEvent(event);
      if (event.type === 'invoice.paid' && saved.invoiceId) deps.wake(saved.invoiceId);
      if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
          event.data.object.mode === 'payment' && deps.paymentStore) {
        await deps.paymentStore.enqueue(event.data.object.id, event.livemode);
        deps.wakePayment?.(event.data.object.id);
      }
      return { received: true };
    });
  });
}
