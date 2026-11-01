import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedCheckout, packagePaymentMessage } from './embedded-payment.ts';

test('only a matching embedded session and publishable key can initialize the payment frame', () => {
  const valid = { sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' };
  assert.deepEqual(embeddedCheckout(valid), valid);
  for (const invalid of [{ url: 'https://checkout.stripe.com/pay' }, { ...valid, clientSecret: 'cs_live_other_secret_value' },
    { ...valid, publishableKey: 'sk_live_forbidden' }, { ...valid, publishableKey: 'pk_test_fixture' }]) {
    assert.throws(() => embeddedCheckout(invalid), /embedded_checkout_invalid/);
  }
});

test('only confirmed activation displays success, while pending and failed states never invite a duplicate payment', () => {
  assert.equal(packagePaymentMessage('active').title, 'Paketin kullanıma hazır');
  assert.equal(packagePaymentMessage('processing').title, 'Paketin hazırlanıyor');
  assert.match(packagePaymentMessage('processing').description, /yeniden ödeme yapma/i);
  assert.match(packagePaymentMessage('review_required').description, /yeniden ödeme yapma/i);
  assert.notEqual(packagePaymentMessage('awaiting_payment').title, packagePaymentMessage('active').title);
  assert.notEqual(packagePaymentMessage('unexpected').title, packagePaymentMessage('active').title);
});
