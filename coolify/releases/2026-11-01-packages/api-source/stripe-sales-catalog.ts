import { resolveStripePackage, type LegacyPackageSlug, type StripePackage } from './stripe-billing-policy.js';

export const STRIPE_PUBLISHABLE_KEY = 'pk_live_51UFvRtKHjtPrjxR0kSMg3liUcSky9oMA9rArmOpEFbPL69taSntvTt5lmKadXRgUoR4pLTGk3rdGzNWEFUGezDqG00JCAd2ZoW';
export const SALE_CATALOG_VERSION = '2026-11-01-one-time';
export const SALE_PACKAGES = {
  '1-ay': { intervalMonths: 1, amountMinor: 25000, providerPackageId: 8, users: 1 },
  '6-ay': { intervalMonths: 6, amountMinor: 69900, providerPackageId: 10, users: 1 },
  '12-ay': { intervalMonths: 12, amountMinor: 99900, providerPackageId: 11, users: 1 },
  '1-ay-2-kullanici': { intervalMonths: 1, amountMinor: 39900, providerPackageId: 13, users: 2 },
  '6-ay-2-kullanici': { intervalMonths: 6, amountMinor: 99900, providerPackageId: 15, users: 2 },
  '12-ay-2-kullanici': { intervalMonths: 12, amountMinor: 139900, providerPackageId: 16, users: 2 }
} as const;
export type SalePackageSlug = keyof typeof SALE_PACKAGES;
export type SalePriceIds = Record<SalePackageSlug, string>;
export type SalePackage = StripePackage & { slug: SalePackageSlug; users: 1 | 2; catalogVersion: string };
export const SALE_PACKAGE_SLUGS = Object.keys(SALE_PACKAGES) as SalePackageSlug[];

// These immutable IDs belong to the new catalog; existing runtime IDs remain legacy renewals.
export const LIVE_SALE_PRICE_IDS: SalePriceIds = {
  '1-ay': 'price_1UWrYMKHjtPrjxR0marsqoDX',
  '6-ay': 'price_1UWrYNKHjtPrjxR0EjWRjUpS',
  '12-ay': 'price_1UWrYOKHjtPrjxR0eOc4590U',
  '1-ay-2-kullanici': 'price_1UWrYPKHjtPrjxR09il72QYm',
  '6-ay-2-kullanici': 'price_1UWrYQKHjtPrjxR0dVkSjn8a',
  '12-ay-2-kullanici': 'price_1UWrYRKHjtPrjxR0GqJfskYn'
};

export function resolveSalePackage(slug: string, liveMode: boolean, fixturePriceIds?: SalePriceIds): SalePackage | null {
  if (!Object.prototype.hasOwnProperty.call(SALE_PACKAGES, slug)) return null;
  const key = slug as SalePackageSlug;
  const priceIds = fixturePriceIds ?? (liveMode ? LIVE_SALE_PRICE_IDS : null);
  const priceId = priceIds?.[key];
  if (!priceId || !/^price_[A-Za-z0-9_]+$/.test(priceId)) throw new Error('stripe_price_not_configured');
  return { slug: key, ...SALE_PACKAGES[key], currency: 'try', priceId, catalogVersion: SALE_CATALOG_VERSION, billingMode: 'payment' };
}

export function resolveInvoicePackage(invoice: { packageSlug: string; priceId: string }, legacyPriceIds: Record<LegacyPackageSlug, string>, liveMode: boolean, fixturePriceIds?: SalePriceIds): StripePackage | null {

  const legacy = resolveStripePackage(invoice.packageSlug, legacyPriceIds);
  return legacy?.priceId === invoice.priceId ? legacy : null;
}

export function providerDurationMonths(pkg: { unit: string; duration: number }): number | null {
  const months = pkg.unit === 'months' ? pkg.duration : pkg.unit === 'years' ? pkg.duration * 12 : NaN;
  return Number.isSafeInteger(months) && months > 0 ? months : null;
}

export function catalogPriceMatches(label: string | null, amountMinor: number): boolean {
  const value = label?.trim().replace(/\s/g, '').replace(/(?:₺|TL|TRY)/gi, '');
  if (!value || !/^\d+(?:\.\d{3})*(?:,00)?$/.test(value)) return false;
  return Number(value.replace(/\./g, '').replace(',00', '')) * 100 === amountMinor;
}
