"use client";

import Link from 'next/link';
import type { ReactNode } from 'react';
import { packagePaymentHref } from '../../lib/account-model';
import { checkoutAvailable, formatPackagePrice, type BillingPackagesStatus, type PackageCard, type PackageUsers } from '../../app/paketler/packages-model';
import s from './pricing.module.css';

type PricingProps = {
  plans: PackageCard[];
  users: PackageUsers;
  onUsersChange: (users: PackageUsers) => void;
  billing: BillingPackagesStatus | null;
  submitting: string | null;
  checkoutError: string | null;
  onCheckout: (slug: string) => void;
};

function Check() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>;
}

function PurchaseLink({ slug, locked, className, label, children }: { slug: string; locked: boolean; className: string; label?: string; children: ReactNode }) {
  return locked
    ? <span className={`${className} ${s.locked}`} aria-disabled="true" aria-label={label}>{children}</span>
    : <Link className={className} aria-label={label} href={packagePaymentHref(slug)}>{children}</Link>;
}

export function Pricing({ plans, users, onUsersChange, billing, submitting, checkoutError, onCheckout }: PricingProps) {
  const dual = users === 2;
  const hasCardCheckout = plans.some(plan => checkoutAvailable(plan, billing));
  return <section className={s.pricing} aria-labelledby="packages-title">
    <header className={s.heading}>
      <h1 id="packages-title">Paketler</h1>
      <p>Film, dizi ve canlı TV. Sana uygun süreyi seç.</p>
    </header>
    <div className={s.mode}>
      <span className={!dual ? s.activeMode : undefined}>Tek kullanıcı</span>
      <button type="button" role="switch" aria-label="Çift kullanıcılı paketler" aria-checked={dual} aria-describedby="package-users-description" disabled={submitting !== null} className={s.switch} onClick={() => onUsersChange(dual ? 1 : 2)}><span /></button>
      <span className={dual ? s.activeMode : undefined}>Çift kullanıcı</span>
    </div>
    <p id="package-users-description" className={s.modeDescription} aria-live="polite">{dual ? 'Çift kullanıcılı paketler' : 'Tek kullanıcılı paketler'}</p>
    {checkoutError && <p className={s.error} role="alert">{checkoutError}</p>}
    <div className={s.cards} aria-label="Satın alınabilir paketler">
      {plans.map(plan => {
        const cardCheckout = checkoutAvailable(plan, billing);
        const features = [
          `${plan.months} ay boyunca erişim`,
          dual ? 'Aynı anda 2 cihazda izleme' : 'Aynı anda 1 cihazda izleme',
          'Film, dizi ve canlı TV',
          'TV, telefon ve bilgisayarda kullanım'
        ];
        return <article key={plan.months} className={`${s.card} ${plan.months === 6 ? s.recommended : ''}`} aria-label={`${plan.months} aylık ${dual ? 'çift' : 'tek'} kullanıcılı paket`}>
          {plan.months === 6 && <span className={s.badge}>Önerilen</span>}
          <h2>{plan.months} Aylık</h2>
          <div className={s.price}><span key={plan.price} data-package-price>{formatPackagePrice(plan.price)}</span><span className={s.currency}>₺</span></div>
          <p className={s.period}>Toplam {plan.months} aylık paket tutarı</p>
          <ul>{features.map(feature => <li key={feature}><Check /><span>{feature}</span></li>)}</ul>
          <div className={s.actions}>
            {!plan.available ? <button type="button" disabled className={s.unavailable}>Şu anda kullanılamıyor</button> : cardCheckout ? <>
              <button type="button" className={s.primary} disabled={submitting !== null} onClick={() => onCheckout(plan.slug)}>{submitting === plan.slug ? 'Ödeme açılıyor…' : 'Paketi Satın Al'}</button>
              <PurchaseLink className={s.otherMethods} slug={plan.slug} locked={submitting !== null}>Diğer ödeme yöntemleri</PurchaseLink>
            </> : <PurchaseLink className={s.primary} label={`${plan.months} aylık ${dual ? 'çift' : 'tek'} kullanıcılı paket ödeme yöntemleri`} slug={plan.slug} locked={submitting !== null}>Paketi Seç</PurchaseLink>}
          </div>
          <p className={s.cardNote}>Tek seferlik ödeme. Otomatik yenileme yok.</p>
        </article>;
      })}
    </div>
    {hasCardCheckout && <p className={s.billingNote}>Ödeme sonrasında paketin hesabına otomatik tanımlanır.</p>}
    {!plans.some(plan => plan.available) && <p className={s.support}>Paketler şu anda satışa açık değil. <Link href="/iletisim">Destek ekibine ulaş</Link></p>}
  </section>;
}
