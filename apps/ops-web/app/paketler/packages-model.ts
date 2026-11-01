import type { WelcomeOfferStatus } from '../platform/welcome-offer-model';

export type PackageUsers = 1 | 2;

export const PACKAGE_PLANS = [
  { slug: '1-ay', months: 1, users: 1, price: 250 },
  { slug: '6-ay', months: 6, users: 1, price: 699 },
  { slug: '12-ay', months: 12, users: 1, price: 999 },
  { slug: '1-ay-2-kullanici', months: 1, users: 2, price: 399 },
  { slug: '6-ay-2-kullanici', months: 6, users: 2, price: 999 },
  { slug: '12-ay-2-kullanici', months: 12, users: 2, price: 1399 }
] as const;

type CatalogPackage = { slug: string; durationMonths: number; isActive: boolean; priceLabel: string | null };
export type PackageCard = {
  slug: string; months: number; users: PackageUsers; price: number; available: boolean;
  regularPrice?: number; offerId?: string;
};
export type BillingPackagesStatus = {
  checkoutEnabled: boolean;
  checkoutPackages?: { packageSlug: string; amountTry: number; users: number; durationMonths: number; offerId?: string }[];
};

function priceAmount(label: string | null): number | null {
  if (!label) return null;
  const amount = label.trim().replace(/\s/g, '').replace(/(?:₺|TL|TRY)/gi, '');
  if (!/^\d+(?:\.\d{3})*(?:,00)?$/.test(amount)) return null;
  return Number(amount.replace(/\./g, '').replace(',00', ''));
}

export function packageCards(catalog: readonly CatalogPackage[], users: PackageUsers, welcome?: unknown): PackageCard[] {
  const quote = welcome as Partial<WelcomeOfferStatus> | null | undefined;
  const offer = quote?.campaign === 'welcome-monthly-50-v1' && quote.eligible === true && (quote.state === 'pending' || quote.state === 'dismissed') && Array.isArray(quote.offers)
    ? quote.offers.find(value => value?.id === quote.campaign && value.users === users && value.durationMonths === 1 && value.currency === 'try' &&
      value.packageSlug === (users === 2 ? '1-ay-2-kullanici' : '1-ay') && value.amountMinor === (users === 2 ? 19950 : 12500) && value.regularAmountMinor === (users === 2 ? 39900 : 25000))
    : undefined;
  return PACKAGE_PLANS.filter(plan => plan.users === users).map(plan => ({
    ...plan,
    ...(offer && plan.months === 1 && offer.packageSlug === plan.slug ? { price: offer.amountMinor / 100, regularPrice: offer.regularAmountMinor / 100, offerId: offer.id } : {}),
    available: catalog.some(pkg => pkg.isActive && pkg.slug === plan.slug && pkg.durationMonths === plan.months && priceAmount(pkg.priceLabel) === plan.price)
  }));
}

export function checkoutAvailable(plan: PackageCard, billing: BillingPackagesStatus | null | undefined): boolean {
  return plan.available && billing?.checkoutEnabled === true && billing.checkoutPackages?.some(pkg =>
    pkg.packageSlug === plan.slug && pkg.amountTry === plan.price && pkg.users === plan.users && pkg.durationMonths === plan.months && pkg.offerId === plan.offerId
  ) === true;
}

export function formatPackagePrice(amount: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
}
