import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const source = (name: string) => fileURLToPath(new URL(`../../../apps/api/src/${name}.ts`, import.meta.url));
const operational = ['stripe-billing-routes', 'stripe-billing-store', 'stripe-billing-api', 'stripe-payment-api', 'stripe-payment', 'stripe-payment-store', 'welcome-offer', 'welcome-offer-store', 'welcome-offer-routes', 'entitlement-provider', 'stripe-sales-catalog', 'stripe-billing-policy', 'stripe-billing-runtime', 'stripe-price-validation', 'stripe-billing-schema', 'stripe-entitlement', 'stripe-webhook', 'analytics-policy', 'analytics-delivery', 'analytics-routes', 'analytics-store', 'analytics-runtime'];
export default defineConfig({
  resolve: { alias: [
    ...operational.map(name => ({ find: new RegExp(`^(?:.*\\/)?${name}\\.js$`), replacement: source(name) })),
    { find: /^\.\/user-route-error\.js$/, replacement: source('user-route-error') },
    { find: /^\.\/referral-store\.js$/, replacement: fileURLToPath(new URL('../2026-11-01-packages/billing-tests/referral-store.fixture.ts', import.meta.url)) },
    { find: /^\.\/referral-policy\.js$/, replacement: source('referral-policy') },
    { find: /^\.\/time\.js$/, replacement: source('time') },
  ] },
  test: { include: ['apps/api/src/*.test.ts', 'coolify/releases/2026-11-01-welcome-offer/welcome-tests/*.test.ts', 'coolify/releases/2026-11-01-packages/billing-tests/*.test.ts'], exclude: ['coolify/releases/2026-11-01-packages/billing-tests/payment-postgres.test.ts'] },
});
