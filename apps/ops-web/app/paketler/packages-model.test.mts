import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutAvailable, formatPackagePrice, packageCards, packageLandingPlan, PACKAGE_PLANS } from './packages-model.ts';

const catalog = PACKAGE_PLANS.map((plan, index) => ({
  id: `plan-${index}`, slug: plan.slug, title: `${plan.months} Aylık`,
  durationMonths: plan.months, isActive: true, priceLabel: `${plan.price} ₺`
}));

test('a package landing selects the exact available canonical plan for its requested users', () => {
  for (const [query, users, expected] of [
    ['users=1&plan=1-ay&from=android_tv', 1, '1-ay'],
    ['users=1&plan=6-ay&from=android_tv', 1, '6-ay'],
    ['users=1&plan=12-ay&from=android_tv', 1, '12-ay'],
    ['users=2&plan=1-ay-2-kullanici&from=android_tv', 2, '1-ay-2-kullanici'],
    ['users=2&plan=6-ay-2-kullanici&from=android_tv', 2, '6-ay-2-kullanici'],
    ['users=2&plan=12-ay-2-kullanici&from=android_tv', 2, '12-ay-2-kullanici']
  ] as const) {
    assert.equal(packageLandingPlan(query, packageCards(catalog, users))?.slug, expected);
  }
  assert.equal(packageLandingPlan('users=2&plan=6-ay-2-kullanici', packageCards(catalog, 2))?.slug, '6-ay-2-kullanici');
});

test('a package landing ignores unknown, duplicate or mismatched plan and user input', () => {
  const plans = packageCards(catalog, 1);
  for (const query of [
    '', 'users=1', 'plan=6-ay', 'users=0&plan=6-ay', 'users=01&plan=6-ay',
    'users=1&plan=3-ay', 'users=1&plan=6-ay-2-kullanici', 'users=2&plan=6-ay',
    'users=1&users=1&plan=6-ay', 'users=1&users=2&plan=6-ay',
    'users=1&plan=6-ay&plan=6-ay', 'users=1&plan=6-ay&plan=12-ay',
    'users=1&plan=6-ay%22%5D', 'users=1&plan=https%3A%2F%2Fexample.test'
  ]) assert.equal(packageLandingPlan(query, plans), null, query);
});

test('a package landing cannot select a missing, unavailable or differently rendered card', () => {
  const query = 'users=1&plan=6-ay&from=android_tv';
  assert.equal(packageLandingPlan(query, []), null);
  assert.equal(packageLandingPlan(query, packageCards(catalog.filter(plan => plan.slug !== '6-ay'), 1)), null);
  assert.equal(packageLandingPlan(query, packageCards(catalog, 2)), null);
  assert.equal(packageLandingPlan(query, [{ slug: '6-ay', months: 1, users: 1, price: 699, available: true }]), null);
  const inactive = catalog.map(plan => ({ ...plan, isActive: plan.slug !== '6-ay' }));
  assert.equal(packageLandingPlan(query, packageCards(inactive, 1)), null);
});

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
