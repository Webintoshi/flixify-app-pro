import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PackagesPage from './page';

const state = vi.hoisted(() => ({ packages: [] as any[], billing: {} as any, request: vi.fn(), assign: vi.fn(), mounted: vi.fn(), destroyed: vi.fn(), complete: (() => {}) as () => void, payment: {} as any }));
vi.mock('next/link', () => ({ default: (props: any) => React.createElement('a', props) }));
vi.mock('../../lib/api', () => ({ apiRequest: (...args: any[]) => state.request(...args) }));
vi.mock('../account/components', () => ({
  AccountFrame: ({ children }: any) => React.createElement('main', null, children),
  Loading: () => React.createElement('p', null, 'Bilgiler yükleniyor…'),
  LoadError: () => React.createElement('p', null, 'Bilgiler yüklenemedi'),
  useAccountResource: (path: string) => ({ loading: false, error: false, reload: vi.fn(), refresh: vi.fn(), data: path.includes('payment-status') ? state.payment : path.includes('billing') ? state.billing : { items: state.packages } })
}));

describe('package selection and payment handoff', () => {
  let root: Root;
  let container: HTMLElement;
  const slugs = ['1-ay', '6-ay', '12-ay', '1-ay-2-kullanici', '6-ay-2-kullanici', '12-ay-2-kullanici'];
  const prices = [250, 699, 999, 399, 999, 1399];
  const months = [1, 6, 12, 1, 6, 12];
  async function settle(action: () => void = () => {}) { await act(async () => { action(); await vi.dynamicImportSettled(); }); }
  const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  beforeEach(() => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(window, 'location', { value: { assign: state.assign }, configurable: true });
    state.assign.mockReset(); state.request.mockReset(); state.mounted.mockReset(); state.destroyed.mockReset(); state.payment = { status: 'processing' };
    Object.defineProperty(window.HTMLElement.prototype, 'focus', { value: vi.fn(), configurable: true });
    Object.defineProperty(window, 'Stripe', { value: () => ({ initEmbeddedCheckout: async (options: any) => { await options.fetchClientSecret(); state.complete = options.onComplete; return { mount: state.mounted, destroy: state.destroyed }; } }), configurable: true });
    state.packages = slugs.map((slug, index) => ({ id: `plan-${index}`, slug, title: `${months[index]} Aylık`, durationMonths: months[index], isActive: true, priceLabel: `${prices[index]} ₺` }));
    state.packages.push({ id: 'legacy', slug: '3-ay', title: '3 Aylık', durationMonths: 3, isActive: true, priceLabel: '640 TL' });
    state.billing = { checkoutEnabled: false };
    container = document.getElementById('root')!; root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });

  it('switches all three real purchase links and totals between single and dual user packages', async () => {
    await settle(() => root.render(<PackagesPage />));
    expect(container.querySelectorAll('article')).toHaveLength(3);
    expect(toggle().getAttribute('aria-label')).toBe('Çift kullanıcılı paketler');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect([...container.querySelectorAll('[data-package-price]')].map(node => node.textContent)).toEqual(['250', '699', '999']);
    expect([...container.querySelectorAll('article a')].map(node => node.getAttribute('href'))).toEqual(slugs.slice(0, 3).map(slug => `/odeme-bildirimi?paket=${slug}`));
    expect(container.textContent).not.toContain('3 Aylık');
    await settle(() => toggle().click());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect([...container.querySelectorAll('[data-package-price]')].map(node => node.textContent)).toEqual(['399', '999', '1.399']);
    expect([...container.querySelectorAll('article a')].map(node => node.getAttribute('href'))).toEqual(slugs.slice(3).map(slug => `/odeme-bildirimi?paket=${slug}`));
    expect(container.textContent).toContain('Çift kullanıcılı');
    await settle(() => toggle().click());
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('article a')?.getAttribute('href')).toBe('/odeme-bildirimi?paket=1-ay');
  });

  it('disables unavailable plans and rejects stale generic Stripe availability', async () => {
    state.packages.find(plan => plan.slug === '6-ay')!.isActive = false;
    state.billing = { checkoutEnabled: true };
    await settle(() => root.render(<PackagesPage />));
    const unavailable = container.querySelectorAll('article')[1];
    expect(unavailable.querySelector('a')).toBeNull();
    expect(unavailable.querySelector('button')?.disabled).toBe(true);
    expect(unavailable.textContent).toContain('Şu anda kullanılamıyor');
    expect(container.textContent).not.toContain('Şimdi Abone Ol');
    expect(state.request).not.toHaveBeenCalled();
  });

  it('opens exact dual plan inside the site, locks other purchases and never treats browser completion as activation', async () => {
    state.billing = { checkoutEnabled: true, checkoutPackages: [{ packageSlug: '6-ay-2-kullanici', amountTry: 999, users: 2, durationMonths: 6 }] };
    let release: (value: unknown) => void = () => {};
    state.request.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await settle(() => root.render(<PackagesPage />)); await settle(() => toggle().click());
    const pay = container.querySelectorAll('article')[1].querySelector('button')!;
    await settle(() => pay.click());
    expect(state.request).toHaveBeenCalledExactlyOnceWith('/me/billing/checkout-session', { method: 'POST', body: { packageSlug: '6-ay-2-kullanici' }, signal: expect.any(AbortSignal) });
    expect(pay.disabled).toBe(true); expect(toggle().disabled).toBe(true);
    expect(container.querySelectorAll('article a[href]')).toHaveLength(0);
    expect(container.querySelectorAll('article [aria-disabled="true"]')).toHaveLength(3);
    await settle(() => release({ url: 'https://fixture.invalid/checkout' }));
    expect(state.assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Ödeme başlatılamadı');
    expect(toggle().disabled).toBe(false);
    expect(container.querySelectorAll('article a[href]')).toHaveLength(3);
    state.request.mockImplementation((path: string) => Promise.resolve(path.includes('payment-status') ? { status: 'processing' } : { sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' }));
    await settle(() => pay.click());
    expect(state.assign).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Ödemeyi tamamla');
    expect(container.textContent).toContain('6 aylık · Çift kullanıcı');
    expect(container.textContent).toContain('Tek seferlik ödeme. Otomatik yenileme yok.');
    expect(state.mounted).toHaveBeenCalledOnce();
    await settle(() => state.complete());
    expect(container.textContent).toContain('Paketin hazırlanıyor');
    expect(container.textContent).not.toContain('Paketin kullanıma hazır');
  });
  it('keeps immediate Stripe completion in verification state instead of reopening the form', async () => {
    state.billing = { checkoutEnabled: true, checkoutPackages: [{ packageSlug: '1-ay', amountTry: 250, users: 1, durationMonths: 1 }] };
    state.request.mockImplementation((path: string) => Promise.resolve(path.includes('payment-status') ? { status: 'processing' } : { sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' }));
    Object.defineProperty(window, 'Stripe', { value: () => ({ initEmbeddedCheckout: async (options: any) => {
      options.onComplete();
      return { mount: state.mounted, destroy: state.destroyed };
    } }), configurable: true });
    await settle(() => root.render(<PackagesPage />));
    await settle(() => container.querySelectorAll('article')[0].querySelector('button')!.click());
    expect(container.textContent).toContain('Paketin hazırlanıyor');
    expect(container.textContent).not.toContain('Ödemeyi tamamla');
    expect(container.textContent).not.toContain('Paketin kullanıma hazır');
    expect(state.assign).not.toHaveBeenCalled();
  });

});
