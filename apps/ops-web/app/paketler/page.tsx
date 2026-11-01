"use client";

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { PackageRecord } from '@flixify/contracts';
import { apiRequest } from '../../lib/api';
import { AccountFrame, Loading, LoadError, useAccountResource } from '../account/components';
import { checkoutErrorLabel } from './stripe-package-copy';
import { checkoutAvailable, packageCards, type BillingPackagesStatus, type PackageUsers } from './packages-model';
import { Pricing } from '../../components/ui/pricing';
import { PackageCheckout } from '../../components/ui/package-checkout';
import { embeddedCheckout, type EmbeddedCheckoutSession } from './embedded-payment';
import type { PackageCard } from './packages-model';
import { useWelcomeOfferStatus } from '../platform/welcome-offer';
import { welcomeUsers } from '../platform/welcome-offer-model';

export default function PackagesPage() {
  const search = useSearchParams();
  const welcome = useWelcomeOfferStatus();
  const { data, loading, error, reload } = useAccountResource<{ items: PackageRecord[] }>('/admin/packages/public');
  const billing = useAccountResource<BillingPackagesStatus>('/me/billing/status');
  const [users, setUsers] = useState<PackageUsers>(() => welcomeUsers(search?.toString() ?? ''));
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [checkout, setCheckout] = useState<{ session: EmbeddedCheckoutSession; plan: PackageCard } | null>(null);
  const plans = packageCards(data?.items ?? [], users, welcome);
  const welcomeLanding = search?.get('welcome') === '1';
  useEffect(() => {
    if (!welcomeLanding || loading || error || checkout) return;
    const card = document.querySelector<HTMLElement>('[data-welcome-package]');
    card?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    card?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [welcomeLanding, loading, error, users, checkout]);

  async function startCheckout(slug: string) {
    const selected = plans.find(plan => plan.slug === slug);
    if (inFlight.current || !selected || !checkoutAvailable(selected, billing.data)) return;
    inFlight.current = true;
    setSubmitting(slug);
    setCheckoutError(null);
    try {
      const result = await apiRequest<unknown>('/me/billing/checkout-session', { method: 'POST', body: { packageSlug: slug, ...(selected.offerId ? { offerId: selected.offerId } : {}) }, signal: AbortSignal.timeout(30000) });
      setCheckout({ session: embeddedCheckout(result), plan: selected });
      setSubmitting(null);
    } catch (error) {
      setCheckoutError(checkoutErrorLabel(error));
      setSubmitting(null);
      inFlight.current = false;
    }
  }

  return <AccountFrame>{checkout ? <PackageCheckout checkout={checkout.session} plan={checkout.plan} onActivated={() => { window.dispatchEvent(new Event('flixify-welcome-offer')); billing.reload(); }} onBack={() => { setCheckout(null); inFlight.current = false; setCheckoutError(null); billing.reload(); }} /> : loading ? <Loading /> : error ? <LoadError onRetry={reload} /> : <Pricing plans={plans} users={users} onUsersChange={next => { if (!inFlight.current) { setUsers(next); setCheckoutError(null); } }} billing={billing.data} submitting={submitting} checkoutError={checkoutError} onCheckout={startCheckout} />}</AccountFrame>;
}
