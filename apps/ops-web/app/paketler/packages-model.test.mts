import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutAvailable, formatPackagePrice, packageCards, PACKAGE_PLANS } from './packages-model.ts';

const catalog = PACKAGE_PLANS.map((plan, index) => ({
  id: `plan-${index}`, slug: plan.slug, title: `${plan.months} Aylık`,
  durationMonths: plan.months, isActive: true, priceLabel: `${plan.price} ₺`
}));

test('single and dual user modes keep the three requested periods and distinct purchase slugs', () => {
  const single = packageCards(catalog, 1);
  const dual = packageCards(catalog, 2);
  assert.deepEqual(single.map(plan => [plan.months, plan.price, plan.slug, plan.available]), [
    [1, 250, '1-ay', true], [6, 699, '6-ay', true], [12, 999, '12-ay', true]
  ]);
  assert.deepEqual(dual.map(plan => [plan.months, plan.price, plan.slug, plan.available]), [
    [1, 399, '1-ay-2-kullanici', true], [6, 999, '6-ay-2-kullanici', true], [12, 1399, '12-ay-2-kullanici', true]
  ]);
  assert.equal(formatPackagePrice(1399), '1.399');
});

test('missing, inactive or mismatched catalog entries cannot be sold and legacy three month plans are excluded', () => {
  const source = [...catalog.filter(plan => plan.slug !== '1-ay').map(plan => ({ ...plan })),
    { id: 'legacy', slug: '3-ay', title: '3 Aylık', durationMonths: 3, isActive: true, priceLabel: '640 TL' }];
  source.find(plan => plan.slug === '6-ay')!.isActive = false;
  source.find(plan => plan.slug === '12-ay')!.priceLabel = '1.600 TL';
  assert.deepEqual(packageCards(source, 1).map(plan => plan.available), [false, false, false]);
  assert.equal(packageCards(source, 1).length, 3);
  assert.ok(!packageCards(source, 1).some(plan => plan.slug === '3-ay'));
  assert.equal(packageCards([{ ...catalog[0], durationMonths: 6 }], 1)[0].available, false);
});

test('catalog amounts accept Turkish currency formatting without accepting approximate or malformed totals', () => {
  for (const priceLabel of ['1.399 ₺', '1399 TL', '1.399,00 TRY']) {
    assert.equal(packageCards([{ ...catalog[5], priceLabel }], 2)[2].available, true);
  }
  for (const priceLabel of ['1.399,50 ₺', '1399–1499 TL', '1.39 ₺', 'Fiyat için destek', null]) {
    assert.equal(packageCards([{ ...catalog[5], priceLabel }], 2)[2].available, false);
  }
});

test('Stripe checkout requires an exact enabled package match, including duration, users and charged total', () => {
  const plan = packageCards(catalog, 2)[1];
  const exact = { packageSlug: plan.slug, amountTry: 999, users: 2, durationMonths: 6 };
  assert.equal(checkoutAvailable(plan, { checkoutEnabled: true, checkoutPackages: [exact] }), true);
  assert.equal(checkoutAvailable(plan, { checkoutEnabled: true }), false);
  assert.equal(checkoutAvailable(plan, { checkoutEnabled: false, checkoutPackages: [exact] }), false);
  for (const mismatch of [{ amountTry: 990 }, { users: 1 }, { durationMonths: 1 }, { packageSlug: '6-ay' }]) {
    assert.equal(checkoutAvailable(plan, { checkoutEnabled: true, checkoutPackages: [{ ...exact, ...mismatch }] }), false);
  }
  assert.equal(checkoutAvailable({ ...plan, available: false }, { checkoutEnabled: true, checkoutPackages: [exact] }), false);
});

test('eligible welcome quotes discount only the matching monthly plan and retain fractional lira', () => {
  const welcome = { campaign: 'welcome-monthly-50-v1', state: 'dismissed', eligible: true, offers: [
    { id: 'welcome-monthly-50-v1', packageSlug: '1-ay', users: 1, durationMonths: 1, amountMinor: 12500, regularAmountMinor: 25000, currency: 'try' },
    { id: 'welcome-monthly-50-v1', packageSlug: '1-ay-2-kullanici', users: 2, durationMonths: 1, amountMinor: 19950, regularAmountMinor: 39900, currency: 'try' }
  ], catalogue: { movies: 11955, live: 12677, series: 1675 } };
  const single = packageCards(catalog, 1, welcome);
  const dual = packageCards(catalog, 2, welcome);
  assert.deepEqual(single.map(plan => plan.price), [125, 699, 999]);
  assert.deepEqual(dual.map(plan => plan.price), [199.5, 999, 1399]);
  assert.equal(dual[0].regularPrice, 399);
  assert.equal(dual[0].offerId, 'welcome-monthly-50-v1');
  assert.equal(formatPackagePrice(199.5), '199,50');
  const exact = { packageSlug: dual[0].slug, amountTry: 199.5, users: 2, durationMonths: 1, offerId: 'welcome-monthly-50-v1' };
  assert.equal(checkoutAvailable(dual[0], { checkoutEnabled: true, checkoutPackages: [exact] }), true);
  assert.equal(checkoutAvailable(dual[0], { checkoutEnabled: true, checkoutPackages: [{ ...exact, offerId: undefined }] }), false);
  assert.equal(packageCards(catalog, 2, { ...welcome, eligible: false })[0].price, 399);
  assert.equal(packageCards(catalog, 2, { ...welcome, state: 'redeemed' })[0].price, 399);
});
