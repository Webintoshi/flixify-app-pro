import test from 'node:test';
import assert from 'node:assert/strict';
import { packageCopy, paymentResultLabel, checkoutErrorLabel } from './stripe-package-copy.ts';

test('all four card subscriptions show final TRY price and honest renewal interval', () => {
  const expected = [
    ['1-ay', '249 TL', 'Her ay otomatik yenilenir.'],
    ['3-ay', '640 TL', 'Her 3 ayda bir otomatik yenilenir.'],
    ['6-ay', '990 TL', 'Her 6 ayda bir otomatik yenilenir.'],
    ['12-ay', '1.600 TL', 'Her 12 ayda bir otomatik yenilenir.']
  ];
  for (const [slug, price, renewal] of expected) {
    assert.deepEqual(packageCopy(slug), { price, renewal });
    assert.doesNotMatch(renewal, /tek seferlik/i);
  }
});

test('payment return never asserts activation until status is active', () => {
  assert.equal(paymentResultLabel('pending'), 'Ödemeniz doğrulanıyor');
  assert.equal(paymentResultLabel('active'), 'Aboneliğiniz etkin');
  assert.equal(paymentResultLabel('past_due'), 'Ödeme tamamlanamadı');
  assert.equal(paymentResultLabel('review_required'), 'Ödemeniz inceleniyor');
});

test('checkout failures distinguish pending payment from temporary Stripe state failures', () => {
  assert.match(checkoutErrorLabel(new Error('{"error":"checkout_payment_pending"}')), /doğrulanıyor/i);
  assert.match(checkoutErrorLabel(new Error('{"error":"subscription_active"}')), /zaten aktif/i);
  assert.match(checkoutErrorLabel(new Error('{"error":"checkout_state_unavailable"}')), /biraz sonra/i);
  assert.match(checkoutErrorLabel(new Error('{"error":"checkout_preparing"}')), /hazırlanıyor/i);
  assert.match(checkoutErrorLabel(new Error('network failed')), /başlatılamadı/i);
});
