"use client";

import { useEffect } from 'react';
import Link from 'next/link';
import { AccountPage, Loading, LoadError, formatDate, useAccountResource } from '../account/components';
import { paymentResultLabel } from '../paketler/stripe-package-copy';
import s from '../account/account.module.css';

type BillingStatus = { status: string; periodEnd?: string | null; cancelAtPeriodEnd?: boolean };

export default function PaymentResultPage() {
  const billing = useAccountResource<BillingStatus>('/me/billing/status');
  useEffect(() => {
    if (billing.error || (billing.data?.status !== 'none' && billing.data?.status !== 'pending')) return;
    const timer = window.setInterval(billing.reload, 5000);
    return () => window.clearInterval(timer);
  }, [billing.data?.status, billing.error, billing.reload]);

  const status = billing.data?.status ?? 'pending';
  return <AccountPage title="Ödeme durumu" subtitle="Kartlı aboneliğinizin durumunu güvenli biçimde kontrol edin.">
    {billing.loading && !billing.data ? <Loading /> : billing.error ? <LoadError onRetry={billing.reload} /> :
      <section className={s.notice} role="status" aria-live="polite">
        <h2>{paymentResultLabel(status)}</h2>
        <p>{status === 'active' ? `Erişiminiz doğrulandı.${billing.data?.periodEnd ? ` Sonraki dönem: ${formatDate(billing.data.periodEnd)}.` : ''}` :
          status === 'review_required' ? 'Ödeme kaydınız alındı, ancak sağlayıcı erişimi henüz doğrulanmadı. Yeniden ödeme yapmayın; destek ekibi inceleyecek.' :
          status === 'past_due' ? 'Tahsilat tamamlanamadı. Kart bilgilerinizi abonelik yönetiminden kontrol edin.' :
          'Stripe dönüşü tek başına erişim açmaz. Ödeme ve sağlayıcı doğrulaması tamamlandığında bu ekran güncellenecek.'}</p>
        <div className={s.resultActions}><button type="button" className={s.secondary} onClick={billing.reload}>Durumu yenile</button>
          <Link className={s.primary} href={status === 'active' ? '/ayarlar' : '/iletisim'}>{status === 'active' ? 'Hesabıma git' : 'Destek al'}</Link></div>
      </section>}
  </AccountPage>;
}
