import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PackagesPage from './page';

const state = vi.hoisted(() => ({ packages: [] as any[], billing: {} as any, welcome: null as any, search: '', loading: false, billingLoading: false, request: vi.fn(), assign: vi.fn(), mounted: vi.fn(), destroyed: vi.fn(), complete: (() => {}) as () => void, payment: {} as any }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock('../platform/welcome-offer', () => ({ useWelcomeOfferStatus: () => state.welcome }));
vi.mock('next/link', () => ({ default: (props: any) => React.createElement('a', props) }));
vi.mock('../../lib/api', () => ({ apiRequest: (...args: any[]) => state.request(...args) }));
vi.mock('../account/components', () => ({
  AccountFrame: ({ children }: any) => React.createElement('main', null, children),
  Loading: () => React.createElement('p', null, 'Bilgiler yükleniyor…'),
  LoadError: () => React.createElement('p', null, 'Bilgiler yüklenemedi'),
  useAccountResource: (path: string) => ({ loading: path.includes('billing') ? state.billingLoading : state.loading, error: false, reload: vi.fn(), refresh: vi.fn(), data: path.includes('payment-status') ? state.payment : path.includes('billing') ? state.billing : { items: state.packages } })
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
    state.assign.mockReset(); state.request.mockReset(); state.mounted.mockReset(); state.destroyed.mockReset(); state.payment = { status: 'processing' }; state.welcome = null; state.search = ''; state.loading = false; state.billingLoading = false;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    Object.defineProperty(window.HTMLElement.prototype, 'focus', { value: vi.fn(), configurable: true });
    Object.defineProperty(window, 'Stripe', { value: () => ({ createEmbeddedCheckoutPage: async (options: any) => { await options.fetchClientSecret(); state.complete = options.onComplete; return { mount: state.mounted, destroy: state.destroyed }; } }), configurable: true });
    state.packages = slugs.map((slug, index) => ({ id: `plan-${index}`, slug, title: `${months[index]} Aylık`, durationMonths: months[index], isActive: true, priceLabel: `${prices[index]} ₺` }));
    state.packages.push({ id: 'legacy', slug: '3-ay', title: '3 Aylık', durationMonths: 3, isActive: true, priceLabel: '640 TL' });
    state.billing = { checkoutEnabled: false };
    container = document.getElementById('root')!; root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });

  it('focuses and scrolls the exact native plan once after loading without starting checkout', async () => {
    state.search = '?users=2&plan=6-ay-2-kullanici&from=android_tv';
    state.loading = true;
    state.billingLoading = true;
    state.billing = { checkoutEnabled: true, checkoutPackages: [{ packageSlug: '6-ay-2-kullanici', amountTry: 999, users: 2, durationMonths: 6 }] };
    await settle(() => root.render(<PackagesPage />));
    expect(window.HTMLElement.prototype.focus).not.toHaveBeenCalled();
    state.loading = false;
    await settle(() => root.render(<PackagesPage />));
    expect(window.HTMLElement.prototype.focus).not.toHaveBeenCalled();
    state.billingLoading = false;
    await settle(() => root.render(<PackagesPage />));
    const card = container.querySelector('[data-package-slug="6-ay-2-kullanici"]')!;
    const purchase = card.querySelector('button')!;
    const focus = vi.mocked(window.HTMLElement.prototype.focus);
    const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(focus.mock.instances[0]).toBe(purchase);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'instant' });
    expect(scroll.mock.instances[0]).toBe(card);
    expect(state.request).not.toHaveBeenCalled();
    expect(state.mounted).not.toHaveBeenCalled();
    await settle(() => root.render(<PackagesPage />));
    await settle(() => toggle().click());
    await settle(() => root.render(<PackagesPage />));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(focus).toHaveBeenCalledOnce();
    expect(state.request).not.toHaveBeenCalled();
  });

  it('preserves a manual toggle before billing finishes loading', async () => {
    state.search = '?users=2&plan=6-ay-2-kullanici&from=android_tv';
    state.billingLoading = true;
    await settle(() => root.render(<PackagesPage />));
    await settle(() => toggle().click());
    state.billingLoading = false;
    await settle(() => root.render(<PackagesPage />));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(window.HTMLElement.prototype.focus).not.toHaveBeenCalled();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  });

  it('keeps a manual purchase from being refocused when billing finishes', async () => {
    state.search = '?users=1&plan=6-ay&from=android_tv';
    state.billingLoading = true;
    await settle(() => root.render(<PackagesPage />));
    await settle(() => container.querySelector('[data-package-slug="1-ay"] a')!.dispatchEvent(new Event('click', { bubbles: true })));
    state.billingLoading = false;
    await settle(() => root.render(<PackagesPage />));
    expect(window.HTMLElement.prototype.focus).not.toHaveBeenCalled();
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  });

  it('ignores an unavailable native card without focusing or checkout', async () => {
    state.search = '?users=1&plan=6-ay&from=android_tv';
    state.packages.find(plan => plan.slug === '6-ay')!.isActive = false;
    await settle(() => root.render(<PackagesPage />));
    expect(window.HTMLElement.prototype.focus).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  });

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
    Object.defineProperty(window, 'Stripe', { value: () => ({ createEmbeddedCheckoutPage: async (options: any) => {
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

  it('retains the monthly welcome quote after dismissal and sends only its server-approved offer id', async () => {
    state.search = '?welcome=1&users=2&plan=unknown&from=android_tv';
    state.welcome = { campaign: 'welcome-monthly-50-v1', state: 'dismissed', eligible: true, catalogue: { movies: 11955, live: 12677, series: 1675 }, offers: [
      { id: 'welcome-monthly-50-v1', packageSlug: '1-ay', users: 1, durationMonths: 1, amountMinor: 12500, regularAmountMinor: 25000, currency: 'try' },
      { id: 'welcome-monthly-50-v1', packageSlug: '1-ay-2-kullanici', users: 2, durationMonths: 1, amountMinor: 19950, regularAmountMinor: 39900, currency: 'try' }
    ] };
    state.billing = { checkoutEnabled: true, checkoutPackages: [{ packageSlug: '1-ay-2-kullanici', amountTry: 199.5, users: 2, durationMonths: 1, offerId: 'welcome-monthly-50-v1' }] };
    state.request.mockResolvedValue({ sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' });
    await settle(() => root.render(<PackagesPage />));
    const monthly = container.querySelectorAll('article')[0];
    expect(toggle().getAttribute('aria-checked')).toBe('true'); expect(monthly.textContent).toContain('199,50'); expect(monthly.querySelector('s')?.textContent).toBe('399 ₺');
    expect(monthly.querySelector('a')).toBeNull(); expect(state.request).not.toHaveBeenCalled();
    expect(vi.mocked(window.HTMLElement.prototype.focus).mock.instances[0]).toBe(monthly.querySelector('button'));
    expect(window.HTMLElement.prototype.focus).toHaveBeenCalledOnce();
    await settle(() => monthly.querySelector('button')!.click());
    expect(state.request.mock.calls[0][1].body).toEqual({ packageSlug: '1-ay-2-kullanici', offerId: 'welcome-monthly-50-v1' });
    expect(container.textContent).toContain('199,50 ₺');
  });

  it('does not advertise a discounted manual payment when the matching card quote is unavailable', async () => {
    state.welcome = { campaign: 'welcome-monthly-50-v1', state: 'dismissed', eligible: true, offers: [
      { id: 'welcome-monthly-50-v1', packageSlug: '1-ay', users: 1, durationMonths: 1, amountMinor: 12500, regularAmountMinor: 25000, currency: 'try' }
    ] };
    state.billing = { checkoutEnabled: true, checkoutPackages: [{ packageSlug: '1-ay', amountTry: 250, users: 1, durationMonths: 1 }] };
    await settle(() => root.render(<PackagesPage />));
    const monthly = container.querySelectorAll('article')[0];
    expect(monthly.querySelector('a')).toBeNull(); expect(monthly.querySelector('button')?.disabled).toBe(true); expect(state.request).not.toHaveBeenCalled();
  });

});
