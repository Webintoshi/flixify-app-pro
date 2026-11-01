import type { LegacyPackageSlug, PackageSlug } from './stripe-billing-policy.js';
import { assertInvoiceMatchesPackage } from './stripe-billing-policy.js';
import type { ProviderLine, ProviderPackage } from './entitlement-provider.js';
import { resolveInvoicePackage, providerDurationMonths, type SalePriceIds } from './stripe-sales-catalog.js';

export type PaidInvoiceView = {
  id: string;
  livemode: boolean;
  status: string;
  amountPaid: number;
  currency: string;
  customerId: string;
  subscriptionId: string;
  userId: string;
  packageSlug: string;
  priceId: string;
  periodEnd: Date;
  subscriptionStatus: string;
};

type Credentials = { username: string; password: string };
export type StripeEntitlementCompletion = {
  userId: string;
  packageSlug: PackageSlug;
  subscriptionId: string;
  providerLineId: string;
  periodEnd: Date;
  providerExpiryBefore: Date | null;
  providerExpiryAfter: Date;
  newCredentials: Credentials | null;
};

export type StripeEntitlementDependencies = {
  liveMode: boolean;
  allowedTestUserIds: Set<string>;
  priceIds: Record<LegacyPackageSlug, string>;
  salePriceIds?: SalePriceIds;
  billing: { fetchPaidInvoice(invoiceId: string): Promise<PaidInvoiceView> };
  store: {
    claim(invoiceId: string): Promise<{ livemode: boolean } | null>;
    ownerForCustomer(customerId: string, liveMode: boolean): Promise<string | null>;
    userEligible(userId: string): Promise<boolean>;
    credentialsForUser(userId: string): Promise<Credentials | null>;
    reserveNewLine(invoiceId: string, userId: string): Promise<Credentials>;
    complete(invoiceId: string, completion: StripeEntitlementCompletion): Promise<void>;
    review(invoiceId: string, code: string): Promise<void>;
  };
  provider: {
    listPackages(): Promise<ProviderPackage[]>;
    findLine(username: string): Promise<ProviderLine | null>;
    extendLine(input: { lineId: string; packageId: number }): Promise<void>;
    createPaidLine(input: { username: string; password: string; packageId: number; operationId: string }): Promise<void>;
  };
};

function verifiedLine(line: ProviderLine | null, credentials: Credentials): line is ProviderLine {
  return Boolean(line && line.username === credentials.username && line.password === credentials.password && line.enabled && !line.isTrial);
}

/** Claims first; a crash or ambiguous provider response becomes review, never a blind second extension. */
export async function fulfillPaidInvoice(invoiceId: string, deps: StripeEntitlementDependencies): Promise<'fulfilled' | 'already-fulfilled' | 'review-required'> {
  const job = await deps.store.claim(invoiceId);
  if (!job) return 'already-fulfilled';
  let providerWriteStarted = false;
  try {
    const invoice = await deps.billing.fetchPaidInvoice(invoiceId);
    if (invoice.id !== invoiceId || invoice.livemode !== deps.liveMode || job.livemode !== deps.liveMode ||
        invoice.status !== 'paid' || invoice.subscriptionStatus !== 'active' ||
        !Number.isFinite(invoice.periodEnd.getTime()) || invoice.periodEnd.getTime() <= Date.now()) throw new Error('stripe_invoice_invalid');
    if (!deps.liveMode && !deps.allowedTestUserIds.has(invoice.userId)) throw new Error('stripe_test_user_not_allowed');
    const expected = resolveInvoicePackage(invoice, deps.priceIds, deps.liveMode, deps.salePriceIds);
    if (!expected) throw new Error('stripe_invoice_mismatch');
    assertInvoiceMatchesPackage({ slug: invoice.packageSlug, priceId: invoice.priceId, currency: invoice.currency, amountPaid: invoice.amountPaid }, expected);
    const owner = await deps.store.ownerForCustomer(invoice.customerId, deps.liveMode);
    if (owner !== invoice.userId || !await deps.store.userEligible(invoice.userId)) throw new Error('stripe_customer_mismatch');
    const providerPackage = (await deps.provider.listPackages()).find(pkg => pkg.id === expected.providerPackageId);
    if (!providerPackage || providerPackage.isTrial || providerDurationMonths(providerPackage) !== expected.intervalMonths ||
        providerPackage.maxConnections !== (expected.users ?? 1)) throw new Error('provider_package_mismatch');

    const existingCredentials = await deps.store.credentialsForUser(invoice.userId);
    const credentials = existingCredentials ?? await deps.store.reserveNewLine(invoiceId, invoice.userId);
    const before = await deps.provider.findLine(credentials.username);
    if (before && (before.username !== credentials.username || before.password !== credentials.password)) throw new Error('provider_line_mismatch');

    let after: ProviderLine | null;
    if (before) {
      providerWriteStarted = true;
      try {
        await deps.provider.extendLine({ lineId: before.id, packageId: expected.providerPackageId });
      } catch {
        // The provider may have applied the write before its response failed.
      }
      after = await deps.provider.findLine(credentials.username);
      if (!verifiedLine(after, credentials) || after.id !== before.id || after.expiresAt <= before.expiresAt) {
        throw new Error('provider_extension_unverified');
      }
    } else {
      providerWriteStarted = true;
      try {
        await deps.provider.createPaidLine({ username: credentials.username, password: credentials.password, packageId: expected.providerPackageId, operationId: invoiceId });
      } catch {
        // Read back the exact deterministic username instead of repeating create_line.
      }
      after = await deps.provider.findLine(credentials.username);
      if (!verifiedLine(after, credentials)) throw new Error('provider_creation_unverified');
    }
    if (after.maxConnections !== (expected.users ?? 1)) throw new Error('provider_connections_mismatch');
    if (after.expiresAt < invoice.periodEnd.getTime() - 3 * 86400000) throw new Error('provider_duration_mismatch');
    await deps.store.complete(invoiceId, {
      userId: invoice.userId,
      packageSlug: expected.slug,
      subscriptionId: invoice.subscriptionId,
      providerLineId: after.id,
      periodEnd: invoice.periodEnd,
      providerExpiryBefore: before ? new Date(before.expiresAt) : null,
      providerExpiryAfter: new Date(after.expiresAt),
      newCredentials: existingCredentials ? null : credentials
    });
    return 'fulfilled';
  } catch (error) {
    await deps.store.review(invoiceId, providerWriteStarted ? 'provider_result_uncertain' : error instanceof Error ? error.message : 'invoice_processing_failed');
    return 'review-required';
  }
}
