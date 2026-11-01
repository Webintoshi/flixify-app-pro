import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('/app/apps/api/package.json');
const Stripe = require('stripe');
const apply = process.argv.includes('--apply');
assert(process.env.STRIPE_MODE === 'live', 'live_mode_required');
assert(process.env.STRIPE_LIVE_SECRET_KEY?.startsWith('sk_live_'), 'live_key_required');
const stripe = new Stripe(process.env.STRIPE_LIVE_SECRET_KEY);
const version = '2026-11-01-one-time';
const definitions = [
  ['1-ay', 1, 1, 25000], ['6-ay', 6, 1, 69900], ['12-ay', 12, 1, 99900],
  ['1-ay-2-kullanici', 1, 2, 39900], ['6-ay-2-kullanici', 6, 2, 99900], ['12-ay-2-kullanici', 12, 2, 139900]
];
const result = [];
for (const [slug, months, users, amount] of definitions) {
  const key = `flixify_20261101_onetime_${slug}`;
  const metadata = { flixify_package_slug: slug, flixify_users: String(users), flixify_catalog_version: version };
  const found = await stripe.prices.list({ lookup_keys: [key], limit: 2 });
  assert(found.data.length <= 1, 'ambiguous_sale_price');
  let price = found.data[0];
  if (!price && apply) {
    const prior = await stripe.prices.list({ lookup_keys: [`flixify_20261101_${slug}`], limit: 2 });
    assert(prior.data.length <= 1, 'ambiguous_prior_price');
    const existingProduct = prior.data[0]?.product;
    const productId = typeof existingProduct === 'string' ? existingProduct : (await stripe.products.create({
      name: `Flixify Pro · ${months} Ay · ${users === 1 ? 'Tek Kullanıcı' : 'Çift Kullanıcı'}`, metadata
    }, { idempotencyKey: `${key}_product` })).id;
    price = await stripe.prices.create({ product: productId, currency: 'try', unit_amount: amount,
      tax_behavior: 'inclusive', lookup_key: key, metadata
    }, { idempotencyKey: `${key}_price` });
  }
  if (price) {
    assert(price.active && price.livemode && price.currency === 'try' && price.unit_amount === amount &&
      price.type === 'one_time' && price.recurring === null &&
      price.tax_behavior === 'inclusive', 'sale_price_shape_mismatch');
    for (const [name, value] of Object.entries(metadata)) assert.equal(price.metadata[name], value);
    assert(/^price_[A-Za-z0-9_]+$/.test(price.id));
  }
  result.push({ packageSlug: slug, durationMonths: months, users, amountTry: amount / 100, priceId: price?.id ?? null });
}
if (apply) {
  for (const [slug] of definitions) {
    const previous = await stripe.prices.list({ lookup_keys: [`flixify_20261101_${slug}`], limit: 2 });
    assert(previous.data.length <= 1, 'ambiguous_prior_price');
    for (const price of previous.data) {
      assert.equal(price.metadata.flixify_catalog_version, '2026-11-01');
      assert.equal(price.metadata.flixify_package_slug, slug);
      const subscriptions = await stripe.subscriptions.list({ price: price.id, status: 'all', limit: 1 });
      assert.equal(subscriptions.data.length, 0, 'prior_new_price_already_has_subscription');
      if (price.active) await stripe.prices.update(price.id, { active: false });
    }
  }
}
console.log(JSON.stringify({ version, apply, prices: result, customerOrSubscriptionWrites: 0 }));
