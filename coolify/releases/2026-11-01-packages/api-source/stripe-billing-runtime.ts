import type { LegacyPackageSlug } from './stripe-billing-policy.js';

type StripeRuntimeEnvironment = {
  STRIPE_CHECKOUT_ENABLED?: boolean;
  STRIPE_MODE?: 'test' | 'live';
  STRIPE_TEST_ALLOWED_USER_IDS?: string;
  STRIPE_TEST_SECRET_KEY?: string;
  STRIPE_LIVE_SECRET_KEY?: string;
  STRIPE_TEST_WEBHOOK_SECRET?: string;
  STRIPE_LIVE_WEBHOOK_SECRET?: string;
  STRIPE_TEST_PRICE_1_MONTH?: string;
  STRIPE_TEST_PRICE_3_MONTHS?: string;
  STRIPE_TEST_PRICE_6_MONTHS?: string;
  STRIPE_TEST_PRICE_12_MONTHS?: string;
  STRIPE_LIVE_PRICE_1_MONTH?: string;
  STRIPE_LIVE_PRICE_3_MONTHS?: string;
  STRIPE_LIVE_PRICE_6_MONTHS?: string;
  STRIPE_LIVE_PRICE_12_MONTHS?: string;
};

export type StripeRuntime = {
  checkoutEnabled: boolean;
  allowedTestUserIds: Set<string>;
  liveMode: boolean;
  secretKey: string;
  webhookSecret: string;
  priceIds: Record<LegacyPackageSlug, string>;
};

/** Incomplete configuration cannot turn on card payments. */
export function stripeBillingRuntime(env: StripeRuntimeEnvironment): StripeRuntime | null {
  const liveMode = env.STRIPE_MODE === 'live';
  const secretKey = liveMode ? env.STRIPE_LIVE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY;
  const webhookSecret = liveMode ? env.STRIPE_LIVE_WEBHOOK_SECRET : env.STRIPE_TEST_WEBHOOK_SECRET;
  const prices = liveMode
    ? [env.STRIPE_LIVE_PRICE_1_MONTH, env.STRIPE_LIVE_PRICE_3_MONTHS, env.STRIPE_LIVE_PRICE_6_MONTHS, env.STRIPE_LIVE_PRICE_12_MONTHS]
    : [env.STRIPE_TEST_PRICE_1_MONTH, env.STRIPE_TEST_PRICE_3_MONTHS, env.STRIPE_TEST_PRICE_6_MONTHS, env.STRIPE_TEST_PRICE_12_MONTHS];
  if (!secretKey?.startsWith(liveMode ? 'sk_live_' : 'sk_test_') || !webhookSecret?.startsWith('whsec_') ||
      prices.some(price => !price || !/^price_[A-Za-z0-9_]+$/.test(price)) || new Set(prices).size !== 4) return null;
  return {
    checkoutEnabled: Boolean(env.STRIPE_CHECKOUT_ENABLED),
    allowedTestUserIds: new Set((env.STRIPE_TEST_ALLOWED_USER_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean)),
    liveMode,
    secretKey,
    webhookSecret,
    priceIds: { '1-ay': prices[0]!, '3-ay': prices[1]!, '6-ay': prices[2]!, '12-ay': prices[3]! }
  };
}
