"use client";

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDate } from '../../app/account/components';
import { apiRequest } from '../../lib/api';
import { packagePaymentMessage, type EmbeddedCheckoutSession, type PackagePaymentStatus as PaymentState } from '../../app/paketler/embedded-payment';
import { formatPackagePrice, type PackageCard } from '../../app/paketler/packages-model';
import s from './package-checkout.module.css';

type CheckoutInstance = { mount: (element: HTMLElement) => void; destroy: () => void };
type StripeCheckout = { initEmbeddedCheckout: (options: { fetchClientSecret: () => Promise<string>; onComplete: () => void }) => Promise<CheckoutInstance> };
type StripeFactory = (key: string) => StripeCheckout;
let stripeScript: Promise<StripeFactory> | null = null;

function loadStripe(): Promise<StripeFactory> {
  const current = () => (window as Window & { Stripe?: StripeFactory }).Stripe;
  if (current()) return Promise.resolve(current()!);
  if (stripeScript) return stripeScript;
  stripeScript = new Promise<StripeFactory>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error('payment_script_unavailable')); }, 15000);
    script.onload = () => { window.clearTimeout(timeout); current() ? resolve(current()!) : reject(new Error('payment_script_unavailable')); };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error('payment_script_unavailable')); };
    document.head.append(script);
  }).catch(error => { stripeScript = null; throw error; });
  return stripeScript;
}

export function PackagePaymentProgress({ sessionId }: { sessionId: string }) {
  const [version, setVersion] = useState(0);
  const [payment, setPayment] = useState<{ data: PaymentState | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: true });
  const state = payment.data?.status ?? 'processing';
  const terminal = ['active', 'review_required', 'failed', 'expired'].includes(state);
  useEffect(() => {
    let current = true;
    let pending = false;
    let finished = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (pending || finished || !current) return;
      pending = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 15000);
      try {
        const data = await apiRequest<PaymentState>(`/me/billing/payment-status?session_id=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (!data || typeof data.status !== 'string') throw new Error('payment_status_invalid');
        if (current) {
          finished = ['active', 'review_required', 'failed', 'expired'].includes(data.status);
          setPayment({ data, error: false, loading: false });
        }
      } catch { if (current) setPayment(previous => ({ ...previous, error: true, loading: false })); }
      finally { window.clearTimeout(timeout); pending = false; }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 4000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { current = false; window.clearInterval(timer); controller?.abort(); window.removeEventListener('focus', onFocus); };
  }, [sessionId, version]);
  const message = packagePaymentMessage(state);
  return <section className={s.result} role="status" aria-live="polite">
    {!terminal && !payment.error && <span className={s.spinner} aria-hidden="true" />}
    <h2>{payment.error ? 'Ödeme durumu alınamadı' : message.title}</h2>
    <p>{payment.error ? 'Sonuç kontrol edilemedi. Yeniden ödeme yapmadan durumu yenile veya destek ekibimize ulaş.' : message.description}</p>
    {state === 'active' && payment.data?.endsAt && <p>Paket bitişi: {formatDate(payment.data.endsAt)}</p>}
    <div className={s.resultActions}>
      <button type="button" onClick={() => { setPayment(previous => ({ ...previous, loading: true })); setVersion(value => value + 1); }} className={s.secondary} disabled={payment.loading}>Durumu yenile</button>
      <Link className={s.primary} href={state === 'active' ? '/' : '/iletisim'}>{state === 'active' ? 'İzlemeye dön' : 'Destek al'}</Link>
    </div>
  </section>;
}

export function PackageCheckout({ checkout, plan, onBack }: { checkout: EmbeddedCheckoutSession; plan: PackageCard; onBack: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'complete' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let disposed = false;
    let expired = false;
    let instance: CheckoutInstance | null = null;
    const destroy = () => { instance?.destroy(); instance = null; };
    const timeout = window.setTimeout(() => { expired = true; destroy(); if (!disposed) setPhase('error'); }, 30000);
    setPhase('loading');
    void (async () => {
      const Stripe = await loadStripe();
      if (disposed || expired) return;
      const created = await Stripe(checkout.publishableKey).initEmbeddedCheckout({
        fetchClientSecret: async () => checkout.clientSecret,
        onComplete: () => { if (!disposed && !expired) setPhase('complete'); }
      });
      if (disposed || expired) { created.destroy(); return; }
      instance = created;
      if (!mount.current) throw new Error('payment_mount_unavailable');
      instance.mount(mount.current);
      window.clearTimeout(timeout);
      setPhase(previous => previous === 'complete' ? previous : 'ready');
    })().catch(() => { window.clearTimeout(timeout); destroy(); if (!disposed && !expired) setPhase('error'); });
    return () => { disposed = true; window.clearTimeout(timeout); destroy(); };
  }, [checkout, attempt]);

  return <section className={s.checkout} aria-labelledby={id}>
    <button type="button" className={s.back} onClick={onBack}>‹ Paketlere dön</button>
    <header className={s.heading}>
      <h1 ref={heading} tabIndex={-1} id={id}>{phase === 'complete' ? 'Ödeme durumu' : 'Ödemeyi tamamla'}</h1>
      <p>{plan.months} aylık · {plan.users === 2 ? 'Çift kullanıcı' : 'Tek kullanıcı'} <strong>{formatPackagePrice(plan.price)} ₺</strong></p>
      <span>Tek seferlik ödeme. Otomatik yenileme yok.</span>
    </header>
    {phase === 'loading' && <p className={s.loading} role="status"><span className={s.spinner} aria-hidden="true" />Ödeme ekranı hazırlanıyor…</p>}
    {phase === 'error' && <div className={s.result} role="alert"><h2>Ödeme ekranı açılamadı</h2><p>Bağlantını kontrol edip aynı işlemi tekrar açabilirsin.</p><button type="button" className={s.primary} onClick={() => setAttempt(value => value + 1)}>Tekrar aç</button></div>}
    <div ref={mount} className={s.frame} hidden={phase === 'complete' || phase === 'error'} />
    {phase === 'complete' && <PackagePaymentProgress key={checkout.sessionId} sessionId={checkout.sessionId} />}
  </section>;
}
