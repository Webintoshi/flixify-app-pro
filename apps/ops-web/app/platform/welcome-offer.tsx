"use client";

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { apiRequest } from '../../lib/api';
import { PackageCheckout } from '../../components/ui/package-checkout';
import { embeddedCheckout, type EmbeddedCheckoutSession } from '../paketler/embedded-payment';
import { formatPackagePrice, type PackageCard } from '../paketler/packages-model';
import { usePlatform } from './session';
import { sessionIdentity } from './personal-integration';
import { parseWelcomeOffer, unavailableWelcomeOffer, welcomeEndpointMissing, welcomeMonthlyOffer, welcomeUsers, type WelcomeOfferStatus } from './welcome-offer-model';
import s from './welcome-offer.module.css';
import { analyticsCheckoutAttribution, trackAnalytics } from './analytics';

const Context = createContext<WelcomeOfferStatus | null>(null);
const exemptRoutes = new Set(['/kayit-ol', '/register', '/giris-yap', '/giris', '/iletisim', '/odeme-sonucu']);
const confetti = [2, 6, 10, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59, 64, 69, 74, 79, 84, 89, 94, 98];
export function useWelcomeOfferStatus(): WelcomeOfferStatus | null { return useContext(Context); }

export function WelcomeOfferBoundary({ children }: { children: ReactNode }) {
  const { session, ready } = usePlatform();
  const path = usePathname() ?? '/';
  if (path.startsWith('/admin') || exemptRoutes.has(path)) return <>{children}</>;
  if (!ready) return <OfferLoading />;
  if (!session) return <>{children}</>;
  return <ScopedWelcomeOffer key={sessionIdentity(session)}>{children}</ScopedWelcomeOffer>;
}

function OfferLoading({ error, retry }: { error?: boolean; retry?: () => void }) {
  return <main className={s.loading} aria-busy={!error}>
    <img src="/logo/flixify-logo.png" alt="Flixify Pro" width="180" height="47" />
    <h1>{error ? 'Karşılama ekranı açılamadı' : 'Flixify hazırlanıyor…'}</h1>
    {error && <><p>Bağlantını kontrol edip tekrar deneyebilirsin.</p><button type="button" data-welcome-retry className={s.freeButton} onClick={retry}>Tekrar dene</button><Link href="/iletisim">Yardım al</Link></>}
  </main>;
}

function ScopedWelcomeOffer({ children }: { children: ReactNode }) {
  const { refreshProvider } = usePlatform();
  const search = useSearchParams();
  const [users, setUsers] = useState<1 | 2>(() => welcomeUsers(search?.toString() ?? ''));
  const [status, setStatus] = useState<WelcomeOfferStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<'trial' | 'monthly' | null>(null);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<{ session: EmbeddedCheckoutSession; plan: PackageCard } | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const heading = useRef<HTMLHeadingElement>(null);
  async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController(); controllers.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try { return await apiRequest<T>(path, { ...options, signal: controller.signal }); }
    finally { window.clearTimeout(timer); controllers.current.delete(controller); }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const controller of controllers.current) controller.abort(); };
  }, []);
  useEffect(() => {
    let current = true;
    setLoadError(false);
    void request<unknown>('/me/welcome-offer').then(value => {
      const verified = parseWelcomeOffer(value);
      if (current && mounted.current) setStatus(verified);
    }).catch(cause => {
      if (!current || !mounted.current) return;
      if (welcomeEndpointMissing(cause)) setStatus(unavailableWelcomeOffer());
      else setLoadError(true);
    });
    return () => { current = false; };
  }, [version]);
  useEffect(() => { if (status?.state === 'pending' && !checkout) heading.current?.focus(); }, [status?.state, checkout]);
  useEffect(() => {
    const refresh = () => { if (!controllers.current.size && !locked.current) setVersion(value => value + 1); };
    const focused = () => { if (status?.eligible && !checkout) refresh(); };
    window.addEventListener('focus', focused);
    window.addEventListener('flixify-welcome-offer', refresh);
    return () => { window.removeEventListener('focus', focused); window.removeEventListener('flixify-welcome-offer', refresh); };
  }, [status?.eligible, checkout]);

  async function choose(choice: 'trial' | 'monthly') {
    if (locked.current || !status) return;
    const quote = welcomeMonthlyOffer(status, users);
    if (choice === 'monthly' && !quote) return;
    locked.current = true; setBusy(choice); setError('');
    try {
      const verified = parseWelcomeOffer(await request<unknown>('/me/welcome-offer/choice', { method: 'POST', body: { choice } }));
      if (!mounted.current) return;
      if (choice === 'trial') {
        if (verified.state === 'pending') throw new Error('welcome_choice_unconfirmed');
        trackAnalytics('trial_select');
        setStatus(verified);
      } else {
        const selected = welcomeMonthlyOffer(verified, users);
        if (!selected || selected.packageSlug !== quote!.packageSlug) throw new Error('welcome_offer_unavailable');
        trackAnalytics('welcome_offer_select', { package_id: selected.packageSlug, package_months: 1, package_users: selected.users, offer_id: selected.id });
        const analytics = analyticsCheckoutAttribution();
        const result = await request<unknown>('/me/billing/checkout-session', { method: 'POST', body: { packageSlug: selected.packageSlug, offerId: selected.id, ...(analytics ? { analytics } : {}) } });
        if (!mounted.current) return;
        const session = embeddedCheckout(result);
        setCheckout({ session, plan: { slug: selected.packageSlug, months: 1, users: selected.users, price: selected.amountMinor / 100, regularPrice: selected.regularAmountMinor / 100, offerId: selected.id, available: true } });
        trackAnalytics('begin_checkout', { package_id: selected.packageSlug, package_months: 1, package_users: selected.users, offer_id: selected.id, currency: 'TRY', value: selected.amountMinor / 100, items: [{ item_id: selected.packageSlug, price: selected.amountMinor / 100 }] });
      }
    } catch { if (mounted.current) setError('Seçimin tamamlanamadı. Tekrar deneyebilir veya ücretsiz devam edebilirsin.'); }
    finally { if (mounted.current) { locked.current = false; setBusy(null); } }
  }

  if (!status) return <OfferLoading error={loadError} retry={() => setVersion(value => value + 1)} />;
  if (status.state !== 'pending') return <Context.Provider value={status}>{children}</Context.Provider>;
  if (checkout) return <main className={s.payment}><PackageCheckout checkout={checkout.session} plan={checkout.plan}
    onBack={() => { setCheckout(null); setVersion(value => value + 1); }}
    onActivated={() => { refreshProvider(); setVersion(value => value + 1); }} />
    {loadError && <div className={s.error} role="alert"><p>Hesap durumu yenilenemedi.</p><button type="button" data-welcome-retry onClick={() => setVersion(value => value + 1)}>Tekrar dene</button></div>}
  </main>;
  const quote = welcomeMonthlyOffer(status, users);
  const counts = new Intl.NumberFormat('tr-TR');
  return <main className={s.screen} data-welcome-screen aria-labelledby="welcome-offer-title">
    <div className={s.confetti} aria-hidden="true">{confetti.map((left, index) => <i key={left} style={{ '--x': `${left}%`, '--y': `${(index * 37) % 100}%`, '--angle': `${index * 41}deg` } as CSSProperties} />)}</div>
    <div className={s.content}>
      <header className={s.heading}><img src="/logo/flixify-logo.png" alt="Flixify Pro" width="230" height="60" />
        <h1 id="welcome-offer-title" ref={heading} tabIndex={-1}>Flixify’a hoş geldin.</h1><p>İzlemeye nasıl başlamak istersin?</p>
      </header>
      <div className={s.cards}>
        <section className={`${s.card} ${s.free}`} aria-labelledby="welcome-free-title">
          <p className={s.eyebrow}>Ücretsiz deneme</p><h2 id="welcome-free-title">3 Saat<br />Ücretsiz</h2>
          <p className={s.description}>Önce keşfet, sonra karar ver.</p>
          <ul className={s.features}><Benefit><strong>{counts.format(status.catalogue.movies)}</strong> film</Benefit><Benefit><strong>{counts.format(status.catalogue.live)}</strong> canlı kanal</Benefit><Benefit><strong>{counts.format(status.catalogue.series)}</strong> dizi</Benefit></ul>
          <button type="button" data-welcome-free className={s.freeButton} disabled={busy !== null} onClick={() => void choose('trial')}>{busy === 'trial' ? 'Devam ediliyor…' : 'Ücretsiz devam et'}</button>
        </section>
        <section className={`${s.card} ${s.paid}`} aria-labelledby="welcome-paid-title">
          <div className={s.offerTop}><p className={s.eyebrow}>Yeni üyelere özel</p><span className={s.badge}>%50 indirim</span></div>
          <h2 id="welcome-paid-title">1 Ay</h2>
          <div className={s.price} aria-live="polite"><s>{quote ? formatPackagePrice(quote.regularAmountMinor / 100) : '250'} ₺</s><strong>{quote ? formatPackagePrice(quote.amountMinor / 100) : '125'} <span>₺</span></strong></div>
          <p className={s.description}><span>Sevdiğin her şey,</span> bir ay seninle.</p>
          <ul className={s.features}><Benefit>Denemedeki tüm içerikler</Benefit><Benefit>1 ay boyunca erişim</Benefit><Benefit>TV, telefon ve bilgisayarda izle</Benefit><Benefit>Ödeme sonrası otomatik aktivasyon</Benefit></ul>
          <div className={s.userChoice}><button type="button" role="switch" aria-checked={users === 2} aria-label="Çift kullanıcılı paket" disabled={busy !== null} onClick={() => setUsers(value => value === 1 ? 2 : 1)}><span /></button><span>{users === 2 ? 'Çift kullanıcı' : 'Tek kullanıcı'}<span aria-hidden="true"> · </span>Tek seferlik ödeme</span></div>
          <button type="button" data-welcome-paid className={s.paidButton} disabled={busy !== null || !quote} onClick={() => void choose('monthly')}>{busy === 'monthly' ? 'Ödeme açılıyor…' : `${quote ? formatPackagePrice(quote.amountMinor / 100) : '125'} ₺ ile 1 ay izle`}</button>
        </section>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
      {loadError && <p className={s.error} role="alert">Durum yenilenemedi. <button type="button" data-welcome-retry onClick={() => setVersion(value => value + 1)}>Tekrar dene</button></p>}
    </div>
  </main>;
}

function Benefit({ children }: { children: ReactNode }) {
  return <li><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="10" /><path d="m6.7 12 3.5 3.5 7.1-7.1" /></svg><span>{children}</span></li>;
}
