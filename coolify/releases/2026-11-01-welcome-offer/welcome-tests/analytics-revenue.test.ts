import { expect, it } from 'vitest';
import { analyticsConfiguration } from '../api-source/analytics-delivery.js';
import { verifiedSaleEvent } from '../api-source/analytics-store.js';
const configuration = analyticsConfiguration({ GA4_ENABLED: 'true', GA4_WEB_MEASUREMENT_ID: 'G-WEB1234567', GA4_WEB_API_SECRET: 'fixture-secret', GA4_ANALYTICS_HASH_SECRET: 'x'.repeat(40) });
const sale = { sessionId: 'cs_live_privateFixture', paymentIntentId: 'pi_privateFixture', userId: '4e8b92d7-667d-44c7-94ac-c63729873139', liveMode: true, packageSlug: '1-ay-2-kullanici', amountMinor: 19950, packageMonths: 1, packageUsers: 2, offerId: 'welcome-monthly-50-v1' };
const attribution = { consentVersion: 1 as const, clientId: '12345.67890', sessionId: 12345, clientPlatform: 'pwa' as const, sourcePlatform: 'macos' as const };

it('builds actual discounted revenue without raw Stripe or account identity and uses a stable opaque transaction ID', () => {
  const event = verifiedSaleEvent(configuration, 'purchase', sale, attribution, 1_793_610_000_000)!;
  expect(event).not.toBeNull();
  expect(event.params).toMatchObject({ value: 199.5, currency: 'TRY', package_id: '1-ay-2-kullanici', package_months: 1, package_users: 2, client_platform: 'pwa', source_platform: 'macos', offer_id: 'welcome-monthly-50-v1' });
  expect(event.params.items).toEqual([{ item_id: '1-ay-2-kullanici', item_name: '1 ay / 2 kullanıcı', price: 199.5, quantity: 1 }]);
  expect(event.params.transaction_id).toMatch(/^fx_[a-f0-9]{48}$/);
  expect(JSON.stringify(event)).not.toMatch(/pi_private|cs_live_private|4e8b92d7|user_id|password|customer/);
  expect(verifiedSaleEvent(configuration, 'purchase', sale, attribution, 1_793_620_000_000)!.id).toBe(event.id);
  expect(verifiedSaleEvent(configuration, 'purchase', { ...sale, paymentIntentId: 'pi_different' }, attribution, 1_793_610_000_000)!.id).not.toBe(event.id);
  expect(verifiedSaleEvent(configuration, 'package_activated', sale, attribution, 1_793_610_000_000)!.params).not.toHaveProperty('value');
});

it('refuses test purchases, invalid packages/amounts and absent private configuration', () => {
  expect(verifiedSaleEvent(configuration, 'purchase', { ...sale, liveMode: false }, attribution)).toBeNull();
  expect(verifiedSaleEvent(configuration, 'purchase', { ...sale, amountMinor: -1 }, attribution)).toBeNull();
  expect(verifiedSaleEvent(configuration, 'purchase', { ...sale, packageSlug: 'private-account-code' }, attribution)).toBeNull();
  expect(verifiedSaleEvent(configuration, 'purchase', { ...sale, packageUsers: 1 }, attribution)).toBeNull();
  expect(verifiedSaleEvent(analyticsConfiguration({}), 'purchase', sale, attribution)).toBeNull();
});
