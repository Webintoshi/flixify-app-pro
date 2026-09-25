"use client";

import { useState } from 'react';
import Link from 'next/link';
import type { PackageRecord } from '@flixify/contracts';
import { apiRequest } from '../../lib/api';
import { packagePaymentHref } from '../../lib/account-model';
import { AccountPage, Loading, LoadError, useAccountResource } from '../account/components';
import { packageCopy, checkoutErrorLabel } from './stripe-package-copy';
import s from '../account/account.module.css';

type BillingStatus = { status: string; checkoutEnabled: boolean };

export default function PackagesPage() {
  const { data, loading, error, reload } = useAccountResource<{ items: PackageRecord[] }>('/admin/packages/public');
  const billing = useAccountResource<BillingStatus>('/me/billing/status');
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const packages = (data?.items ?? []).filter(pkg => pkg.isActive).sort((a, b) => a.durationMonths - b.durationMonths);
  const cardCheckoutEnabled = billing.data?.checkoutEnabled === true;

  async function startCheckout(slug: string) {
    setSubmitting(slug);
    setCheckoutError(null);
    try {
      const result = await apiRequest<{ url: string }>('/me/billing/checkout-session', { method: 'POST', body: { packageSlug: slug } });
      const target = new URL(result.url);
      if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') throw new Error('checkout_url_invalid');
      window.location.assign(result.url);
    } catch (error) {
      setCheckoutError(checkoutErrorLabel(error));
      setSubmitting(null);
    }
  }

  return <AccountPage title="Paketler" subtitle="Paketinizi seçin.">
    {loading ? <Loading /> : error ? <LoadError onRetry={reload} /> : packages.length ? <section aria-label="Abonelik paketleri">
      {checkoutError && <p className={s.errorText} role="alert">{checkoutError}</p>}
      <div className={s.packages}>{packages.map(pkg => {
        const copy = packageCopy(pkg.slug);
        return <article className={s.package} key={pkg.id}>
          <h3>{pkg.title}</h3>
          <div className={s.price}>{copy?.price ?? pkg.priceLabel ?? 'Fiyat için destek'}</div>
          {cardCheckoutEnabled && copy ? <>
            <button className={s.primary} type="button" disabled={submitting !== null} onClick={() => startCheckout(pkg.slug)}>
              {submitting === pkg.slug ? 'Ödeme açılıyor…' : 'Şimdi Abone Ol'}
            </button>
            <Link className={s.textLink} href={packagePaymentHref(pkg.slug)}>Diğer Ödeme Yöntemlerini Gör</Link>
          </> : <>
            <Link className={s.primary} aria-label={pkg.title + ' ödeme yöntemlerini gör'} href={packagePaymentHref(pkg.slug)}>Ödeme Yöntemlerini Gör</Link>
          </>}
        </article>;
      })}</div>
      {cardCheckoutEnabled && <p className={s.billingNote}>Kartlı abonelik seçtiğiniz süre sonunda otomatik yenilenir. Dilediğiniz zaman iptal edebilirsiniz.</p>}
    </section> : <div className={s.notice}><h2>Şu anda paket bulunmuyor</h2><p>Güncel seçenekler için destek ekibimize ulaşabilirsiniz.</p><Link className={s.secondary} href="/iletisim">Destek al</Link></div>}
  </AccountPage>;
}
