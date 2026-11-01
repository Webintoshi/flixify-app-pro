export type LegacyPackageSlug = "1-ay" | "3-ay" | "6-ay" | "12-ay";
export type PackageSlug = LegacyPackageSlug | "1-ay-2-kullanici" | "6-ay-2-kullanici" | "12-ay-2-kullanici";
export type StripePackage = {
  slug: PackageSlug;
  intervalMonths: number;
  amountMinor: number;
  providerPackageId: number;
  priceId: string;
  currency: "try";
  users?: 1 | 2;
  catalogVersion?: string;
  billingMode?: 'payment' | 'subscription';
};

const PACKAGES = {
  "1-ay": { intervalMonths: 1, amountMinor: 24900, providerPackageId: 8 },
  "3-ay": { intervalMonths: 3, amountMinor: 64000, providerPackageId: 9 },
  "6-ay": { intervalMonths: 6, amountMinor: 99000, providerPackageId: 10 },
  "12-ay": { intervalMonths: 12, amountMinor: 160000, providerPackageId: 11 }
} as const satisfies Record<LegacyPackageSlug, Omit<StripePackage, "slug" | "priceId" | "currency">>;

export const STRIPE_PACKAGE_SLUGS = Object.keys(PACKAGES) as LegacyPackageSlug[];

export function resolveStripePackage(slug: string, priceIds: Record<LegacyPackageSlug, string>): StripePackage | null {
  if (!Object.prototype.hasOwnProperty.call(PACKAGES, slug)) return null;
  const packageSlug = slug as LegacyPackageSlug;
  const priceId = priceIds[packageSlug];
  if (typeof priceId !== "string" || !/^price_[A-Za-z0-9_]+$/.test(priceId)) {
    throw new Error("stripe_price_not_configured");
  }
  return { slug: packageSlug, ...PACKAGES[packageSlug], priceId, currency: "try" };
}

export function assertInvoiceMatchesPackage(
  invoice: { slug: string; priceId: string; currency: string; amountPaid: number },
  expected: StripePackage
): void {
  if (invoice.slug !== expected.slug || invoice.priceId !== expected.priceId || invoice.currency !== expected.currency ||
      !Number.isSafeInteger(invoice.amountPaid) || invoice.amountPaid !== expected.amountMinor) {
    throw new Error("stripe_invoice_mismatch");
  }
}
