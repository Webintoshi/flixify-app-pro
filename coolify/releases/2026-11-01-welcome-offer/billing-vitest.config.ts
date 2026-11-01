import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const candidatePolicy=fileURLToPath(new URL('../../../apps/api/src/referral-policy.ts',import.meta.url));
const target = (name: string) => fileURLToPath(new URL(`./api-source/${name}.ts`, import.meta.url));
const previous = (name: string) => fileURLToPath(new URL(`../2026-11-01-packages/api-source/${name}.ts`, import.meta.url));
const changed = ['stripe-billing-routes','stripe-billing-store','stripe-billing-api','stripe-payment-api','stripe-payment','stripe-payment-store','welcome-offer','welcome-offer-store','welcome-offer-routes'];
const unchanged = ['entitlement-provider','stripe-sales-catalog','stripe-billing-policy','stripe-billing-runtime','stripe-price-validation','stripe-billing-schema','stripe-entitlement','stripe-webhook'];
export default defineConfig({resolve:{alias:[
  ...changed.map(name=>({find:new RegExp(`^(?:.*\\/)?${name}\\.js$`),replacement:target(name)})),
  ...unchanged.map(name=>({find:new RegExp(`^(?:.*\\/)?${name}\\.js$`),replacement:previous(name)})),
  {find:/^\.\/user-route-error\.js$/,replacement:fileURLToPath(new URL('../../../apps/api/src/user-route-error.ts',import.meta.url))},
  {find:/^\.\/referral-store\.js$/,replacement:fileURLToPath(new URL('../2026-11-01-packages/billing-tests/referral-store.fixture.ts',import.meta.url))},
  {find:/^\.\/referral-policy\.js$/,replacement:existsSync(candidatePolicy)?candidatePolicy:fileURLToPath(new URL('../../../../artifacts/packages-20261101/production-source/referral-policy.ts',import.meta.url))},
  {find:/^\.\/time\.js$/,replacement:fileURLToPath(new URL('../../../apps/api/src/time.ts',import.meta.url))}
]},test:{exclude:['coolify/releases/2026-11-01-packages/billing-tests/payment-postgres.test.ts'],include:['coolify/releases/2026-11-01-welcome-offer/welcome-tests/*.test.ts','coolify/releases/2026-11-01-packages/billing-tests/*.test.ts']}});
