import type { StripePackage } from './stripe-billing-policy.js';

type PriceView = {
  id: string;
  active: boolean;
  livemode: boolean;
  currency: string;
  unit_amount: number | null;
  type: string;
  recurring: { interval: string; interval_count: number } | null;
  metadata?: Record<string, string>;
};

export function assertStripePrice(price: PriceView, expected: StripePackage, liveMode: boolean): void {
  if (price.id !== expected.priceId || !price.active || price.livemode !== liveMode ||
      price.currency !== expected.currency || price.unit_amount !== expected.amountMinor ||
      (expected.billingMode === 'payment' ? price.type !== 'one_time' || price.recurring !== null :
       price.type !== 'recurring' || price.recurring?.interval !== 'month' || price.recurring.interval_count !== expected.intervalMonths) ||
      (expected.catalogVersion !== undefined && (price.metadata?.flixify_package_slug !== expected.slug ||
        price.metadata?.flixify_users !== String(expected.users) || price.metadata?.flixify_catalog_version !== expected.catalogVersion))) {
    throw new Error('stripe_price_mismatch');
  }
}
