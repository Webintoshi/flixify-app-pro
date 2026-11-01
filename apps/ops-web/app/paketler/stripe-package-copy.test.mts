import test from 'node:test';
import assert from 'node:assert/strict';
import { packageCopy, paymentResultLabel, checkoutErrorLabel } from './stripe-package-copy.ts';

test('six packages show final TRY price without automatic renewal', () => {
  const expected = [
    ['1-ay', '250 ₺', 'Tek seferlik ödeme. Otomatik yenilenmez.'],
    ['6-ay', '699 ₺', 'Tek seferlik ödeme. Otomatik yenilenmez.'],
    ['12-ay', '999 ₺', 'Tek seferlik ödeme. Otomatik yenilenmez.'],
    ['1-ay-2-kullanici', '399 ₺', 'Tek seferlik ödeme. Otomatik yenilenmez.'],
    ['6-ay-2-kullanici', '999 ₺', 'Tek seferlik ödeme. Otomatik yenilenmez.'],
    ['12-ay-2-kullanici', '1.399 ₺', 'Tek seferlik ödeme. Otomatik yenilenmez.']
  ];
  for (const [slug, price, renewal] of expected) {
    assert.deepEqual(packageCopy(slug), { price, renewal });
    assert.match(renewal, /tek seferlik/i);
  }
  assert.equal(packageCopy('3-ay'), null);
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
