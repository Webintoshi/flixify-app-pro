import { describe, expect, it } from 'vitest';
import { resolveStripePackage } from '../api-source/stripe-billing-policy.js';
import { resolveSalePackage, resolveInvoicePackage, providerDurationMonths, SALE_PACKAGE_SLUGS, type SalePriceIds } from '../api-source/stripe-sales-catalog.js';

export const legacyIds = { '1-ay': 'price_old_one', '3-ay': 'price_old_three', '6-ay': 'price_old_six', '12-ay': 'price_old_twelve' };
export const saleIds: SalePriceIds = { '1-ay': 'price_new_one', '6-ay': 'price_new_six', '12-ay': 'price_new_twelve', '1-ay-2-kullanici': 'price_dual_one', '6-ay-2-kullanici': 'price_dual_six', '12-ay-2-kullanici': 'price_dual_twelve' };

describe('versioned sale catalog and legacy invoice preservation', () => {
  it('sells only the six exact new prices and verified provider capacities', () => {
    expect(SALE_PACKAGE_SLUGS.map(slug => { const pkg = resolveSalePackage(slug, false, saleIds)!; return [slug, pkg.intervalMonths, pkg.amountMinor, pkg.users, pkg.providerPackageId]; })).toEqual([
      ['1-ay',1,25000,1,8], ['6-ay',6,69900,1,10], ['12-ay',12,99900,1,11],
      ['1-ay-2-kullanici',1,39900,2,13], ['6-ay-2-kullanici',6,99900,2,15], ['12-ay-2-kullanici',12,139900,2,16]
    ]);
    expect(resolveSalePackage('3-ay', true)).toBeNull();
    expect(() => resolveSalePackage('1-ay', false)).toThrow('stripe_price_not_configured');
  });
  it.each([['1-ay',24900], ['3-ay',64000], ['6-ay',99000], ['12-ay',160000]])('preserves the original %s recurring amount, keyed to invoice Price ID', (slug, amount) => {
    const legacy = resolveStripePackage(String(slug), legacyIds)!;
    expect(legacy.amountMinor).toBe(amount);
    expect(resolveInvoicePackage({ packageSlug: String(slug), priceId: legacy.priceId }, legacyIds, false, saleIds)).toEqual(legacy);
    expect(resolveInvoicePackage({ packageSlug: String(slug), priceId: 'price_unknown' }, legacyIds, false, saleIds)).toBeNull();
  });
  it('resolves only legacy invoices and leaves new one-time prices to the separate payment worker', () => {
    expect(resolveInvoicePackage({ packageSlug:'1-ay',priceId:'price_new_one' },legacyIds,false,saleIds)).toBeNull();
    expect(resolveInvoicePackage({ packageSlug:'1-ay',priceId:'price_old_one' },legacyIds,false,saleIds)?.amountMinor).toBe(24900);
  });
  it('normalizes an official provider year while rejecting hours or days as sale months', () => {
    expect(providerDurationMonths({unit:'years',duration:1})).toBe(12);
    expect(providerDurationMonths({unit:'months',duration:6})).toBe(6);
    expect(providerDurationMonths({unit:'days',duration:30})).toBeNull();
  });
});
