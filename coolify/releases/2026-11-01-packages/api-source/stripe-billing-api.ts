import type Stripe from 'stripe';
import { resolveSalePackage, type SalePriceIds } from './stripe-sales-catalog.js';
import type { StripeBillingRouteApi } from './stripe-billing-routes.js';
import type { StripeRuntime } from './stripe-billing-runtime.js';
import { assertStripePrice } from './stripe-price-validation.js';
import type { PaidInvoiceView } from './stripe-entitlement.js';

export function createStripeBillingApi(stripe: Stripe, config: StripeRuntime, fixturePriceIds?: SalePriceIds): StripeBillingRouteApi {
  const verified = new Map<string, number>();
  async function verifyPrice(slug: string, fresh = false) {
    const selected = resolveSalePackage(slug, config.liveMode, fixturePriceIds);
    if (!selected) throw new Error('stripe_price_mismatch');
    if (fresh || (verified.get(selected.priceId) ?? 0) < Date.now()) {
      assertStripePrice(await stripe.prices.retrieve(selected.priceId), selected, config.liveMode);
      verified.set(selected.priceId, Date.now() + 30000);
    }
    return selected;
  }
  return {
    async verifyCheckoutPackage(slug) { await verifyPrice(slug); },
    async createCustomer(userId, idempotencyKey) {
      const customer = await stripe.customers.create({ metadata: { flixify_user_id: userId } }, { idempotencyKey });
      return { id: customer.id };
    },
    async createCheckoutSession(params, idempotencyKey) {
      const selected = await verifyPrice(params.metadata.package_slug, true);
      if (selected.priceId !== params.line_items[0].price || params.line_items.length !== 1 || params.line_items[0].quantity !== 1) throw new Error('stripe_price_mismatch');
      for (const metadata of [params.metadata, params.payment_intent_data.metadata]) {
        if (metadata.package_slug !== selected.slug || metadata.user_id !== params.client_reference_id ||
            metadata.package_users !== String(selected.users) || metadata.catalog_version !== selected.catalogVersion ||
            metadata.sale_price_id !== selected.priceId) throw new Error('stripe_price_mismatch');
      }
      const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
      if (session.livemode !== config.liveMode || session.mode !== 'payment' || session.ui_mode !== 'embedded_page') throw new Error('stripe_mode_mismatch');
      return { id: session.id, clientSecret: session.client_secret };
    },
    async retrieveCheckoutSession(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] });
      const items = session.line_items;
      const onlyItem = items && !items.has_more && items.data.length === 1 ? items.data[0] : null;
      return {
        id: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        url: session.url,
        liveMode: session.livemode,
        customerId: stripeId(session.customer),
        userId: session.client_reference_id,
        packageSlug: session.metadata?.package_slug ?? null,
        priceId: onlyItem ? stripeId(onlyItem.price) : null,
        quantity: onlyItem?.quantity ?? null,
        mode: session.mode,
        uiMode: session.ui_mode,
        clientSecret: session.client_secret
      };
    },
    async expireCheckoutSession(sessionId) {
      await stripe.checkout.sessions.expire(sessionId);
    },
    async createPortalSession(customerId) {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: 'https://flixify.vip/ayarlar' });
      return { url: session.url };
    }
  };
}

function stripeId(value: { id: string } | string | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null;
}

/** Reads current Stripe state; webhook payloads alone never authorize access. */
export function createStripeInvoiceReader(stripe: Stripe): { fetchPaidInvoice(invoiceId: string): Promise<PaidInvoiceView> } {
  return {
    async fetchPaidInvoice(invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription);
      const customerId = stripeId(invoice.customer);
      if (!subscriptionId || !customerId || !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason ?? '') ||
          invoice.collection_method !== 'charge_automatically' || invoice.lines.has_more || invoice.lines.data.length !== 1) {
        throw new Error('stripe_invoice_invalid');
      }
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const item = subscription.items.data;
      const invoiceLinePrice = stripeId(invoice.lines.data[0].pricing?.price_details?.price);
      if (stripeId(subscription.customer) !== customerId || item.length !== 1 ||
          item[0].price.id !== invoiceLinePrice || subscription.metadata.user_id == null || subscription.metadata.package_slug == null) {
        throw new Error('stripe_invoice_mismatch');
      }
      return {
        id: invoice.id,
        livemode: invoice.livemode,
        status: invoice.status ?? 'unknown',
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
        customerId,
        subscriptionId,
        userId: subscription.metadata.user_id,
        packageSlug: subscription.metadata.package_slug,
        priceId: item[0].price.id,
        periodEnd: new Date(item[0].current_period_end * 1000),
        subscriptionStatus: subscription.status
      };
    }
  };
}
