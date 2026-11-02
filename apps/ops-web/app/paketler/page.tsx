"use client";

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { PackageRecord } from '@flixify/contracts';
import { apiRequest } from '../../lib/api';
import { AccountFrame, Loading, LoadError, useAccountResource } from '../account/components';
import { checkoutErrorLabel } from './stripe-package-copy';
import { checkoutAvailable, packageCards, packageLandingPlan, type BillingPackagesStatus, type PackageUsers } from './packages-model';
import { Pricing } from '../../components/ui/pricing';
import { PackageCheckout } from '../../components/ui/package-checkout';
import { embeddedCheckout, type EmbeddedCheckoutSession } from './embedded-payment';
import type { PackageCard } from './packages-model';
import { useWelcomeOfferStatus } from '../platform/welcome-offer';
import { welcomeUsers } from '../platform/welcome-offer-model';
import { analyticsCheckoutAttribution, trackAnalytics } from '../platform/analytics';

export default function PackagesPage() {
  const search = useSearchParams();
  const welcome = useWelcomeOfferStatus();
  const { data, loading, error, reload } = useAccountResource<{ items: PackageRecord[] }>('/admin/packages/public');
  const billing = useAccountResource<BillingPackagesStatus>('/me/billing/status');
  const [users, setUsers] = useState<PackageUsers>(() => welcomeUsers(search?.toString() ?? ''));
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const landingHandled = useRef(false);
  const [checkout, setCheckout] = useState<{ session: EmbeddedCheckoutSession; plan: PackageCard } | null>(null);
  const plans = packageCards(data?.items ?? [], users, welcome);
  const measuredPlans = useRef('');
  const plansKey = plans.map(plan => `${plan.slug}:${plan.price}`).join('|');
  useEffect(() => {
    if (loading || error || !plans.length || measuredPlans.current === plansKey) return;
    measuredPlans.current = plansKey;
    trackAnalytics('view_item_list', { item_list_id: 'packages', package_users: users, items: plans.map(plan => ({ item_id: plan.slug, price: plan.price })) });
  }, [loading, error, plansKey, users]);
  const welcomeLanding = search?.get('welcome') === '1';
  const landingPlan = packageLandingPlan(search?.toString() ?? '', plans)?.slug;
  useEffect(() => {
    if (landingHandled.current || loading || billing.loading || error || checkout) return;
    const card = landingPlan
      ? document.querySelector<HTMLElement>(`[data-package-slug="${landingPlan}"]`)
      : welcomeLanding ? document.querySelector<HTMLElement>('[data-welcome-package]') : null;
    const purchase = card?.querySelector<HTMLElement>('button:not([disabled]), a[href]');
    if (!purchase) return;
    landingHandled.current = true;
    card?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    purchase.focus({ preventScroll: true });
  }, [welcomeLanding, landingPlan, loading, billing.loading, error, checkout]);

  async function startCheckout(slug: string) {
    landingHandled.current = true;
    const selected = plans.find(plan => plan.slug === slug);
    if (inFlight.current || !selected || !checkoutAvailable(selected, billing.data)) return;
    trackAnalytics('select_item', { item_list_id: 'packages', package_id: selected.slug, package_months: selected.months, package_users: selected.users });
    inFlight.current = true;
    setSubmitting(slug);
    setCheckoutError(null);
    try {
      const analytics = analyticsCheckoutAttribution();
      const result = await apiRequest<unknown>('/me/billing/checkout-session', { method: 'POST', body: { packageSlug: slug, ...(selected.offerId ? { offerId: selected.offerId } : {}), ...(analytics ? { analytics } : {}) }, signal: AbortSignal.timeout(30000) });
      const session = embeddedCheckout(result);
      setCheckout({ session, plan: selected });
      trackAnalytics('begin_checkout', { package_id: selected.slug, package_months: selected.months, package_users: selected.users, offer_id: selected.offerId, currency: 'TRY', value: selected.price, items: [{ item_id: selected.slug, price: selected.price }] });
      setSubmitting(null);
    } catch (error) {
      setCheckoutError(checkoutErrorLabel(error));
      setSubmitting(null);
      inFlight.current = false;
    }
  }

  return <AccountFrame>{checkout ? <PackageCheckout checkout={checkout.session} plan={checkout.plan} onActivated={() => { window.dispatchEvent(new Event('flixify-welcome-offer')); billing.reload(); }} onBack={() => { setCheckout(null); inFlight.current = false; setCheckoutError(null); billing.reload(); }} /> : loading ? <Loading /> : error ? <LoadError onRetry={reload} /> : <Pricing plans={plans} users={users} onUsersChange={next => { landingHandled.current = true; if (!inFlight.current) { setUsers(next); setCheckoutError(null); } }} onInteract={() => { landingHandled.current = true; }} billing={billing.data} submitting={submitting} checkoutError={checkoutError} onCheckout={startCheckout} />}</AccountFrame>;
}
