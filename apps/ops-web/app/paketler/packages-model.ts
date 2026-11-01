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
};
export type BillingPackagesStatus = {
  checkoutEnabled: boolean;
  checkoutPackages?: { packageSlug: string; amountTry: number; users: number; durationMonths: number }[];
};

function priceAmount(label: string | null): number | null {
  if (!label) return null;
  const amount = label.trim().replace(/\s/g, '').replace(/(?:₺|TL|TRY)/gi, '');
  if (!/^\d+(?:\.\d{3})*(?:,00)?$/.test(amount)) return null;
  return Number(amount.replace(/\./g, '').replace(',00', ''));
}

export function packageCards(catalog: readonly CatalogPackage[], users: PackageUsers): PackageCard[] {
  return PACKAGE_PLANS.filter(plan => plan.users === users).map(plan => ({
    ...plan,
    available: catalog.some(pkg => pkg.isActive && pkg.slug === plan.slug && pkg.durationMonths === plan.months && priceAmount(pkg.priceLabel) === plan.price)
  }));
}

export function checkoutAvailable(plan: PackageCard, billing: BillingPackagesStatus | null | undefined): boolean {
  return plan.available && billing?.checkoutEnabled === true && billing.checkoutPackages?.some(pkg =>
    pkg.packageSlug === plan.slug && pkg.amountTry === plan.price && pkg.users === plan.users && pkg.durationMonths === plan.months
  ) === true;
}

export function formatPackagePrice(amount: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(amount);
}
