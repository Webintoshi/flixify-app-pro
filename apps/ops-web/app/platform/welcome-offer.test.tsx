import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WelcomeOfferBoundary, useWelcomeOfferStatus } from './welcome-offer';

const fixture = vi.hoisted(() => ({ request: vi.fn(), session: { accessToken: 'fixture-a', kryptoniteCode: 'AAAAAAAAAAAAAAAA' } as any,
  path: '/', search: '', refresh: vi.fn(), childMounts: 0, checkout: null as any }));
vi.mock('../../lib/api', () => ({ apiRequest: (...args: any[]) => fixture.request(...args) }));
vi.mock('./session', () => ({ usePlatform: () => ({ ready: true, session: fixture.session, refreshProvider: fixture.refresh, logout: vi.fn() }) }));
vi.mock('next/navigation', () => ({ usePathname: () => fixture.path, useSearchParams: () => new URLSearchParams(fixture.search) }));
vi.mock('next/link', () => ({ default: (props: any) => React.createElement('a', props) }));
vi.mock('../../components/ui/package-checkout', () => ({ PackageCheckout: (props: any) => {
  fixture.checkout = props;
  return <section data-embedded-checkout><p>{props.plan.price}</p><button onClick={props.onBack}>Geri dön</button></section>;
} }));

const status = (state = 'pending', eligible = true) => ({ campaign: 'welcome-monthly-50-v1', state, eligible,
  offers: eligible ? [
    { id: 'welcome-monthly-50-v1', packageSlug: '1-ay', users: 1, durationMonths: 1, amountMinor: 12500, regularAmountMinor: 25000, currency: 'try' },
    { id: 'welcome-monthly-50-v1', packageSlug: '1-ay-2-kullanici', users: 2, durationMonths: 1, amountMinor: 19950, regularAmountMinor: 39900, currency: 'try' }
  ] : [], catalogue: { movies: 11955, live: 12677, series: 1675 } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Child() { const offer = useWelcomeOfferStatus(); useEffect(() => { fixture.childMounts++; }, []); return <output data-catalog>{offer?.eligible ? 'Eligible catalogue' : 'Existing catalogue'}</output>; }

describe('account-scoped welcome choice', () => {
  let root: Root; let container: HTMLElement;
  async function settle(action: () => void = () => {}) { await act(async () => { action(); await Promise.resolve(); await Promise.resolve(); }); }
  const mount = () => settle(() => root.render(<WelcomeOfferBoundary><Child /></WelcomeOfferBoundary>));
  beforeEach(() => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(window.HTMLElement.prototype, 'focus', { value: vi.fn(), configurable: true });
    fixture.session = { accessToken: 'fixture-a', kryptoniteCode: 'AAAAAAAAAAAAAAAA' }; fixture.path = '/'; fixture.search = '';
    fixture.request.mockReset(); fixture.refresh.mockReset(); fixture.childMounts = 0; fixture.checkout = null;
    fixture.request.mockResolvedValue(status()); container = document.getElementById('root')!; root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });

  it('does not mount catalogue content before the authoritative account decision', async () => {
    const pending = deferred<any>(); fixture.request.mockReturnValue(pending.promise); await mount();
    expect(container.querySelector('[data-catalog]')).toBeNull(); expect(fixture.childMounts).toBe(0);
    await settle(() => pending.resolve(status()));
    expect(container.textContent).toContain('3 Saat'); expect(container.textContent).toContain('11.955');
    expect(container.textContent).toContain('12.677'); expect(container.textContent).toContain('1.675');
    expect(container.querySelector('[data-catalog]')).toBeNull(); expect(container.querySelector('footer')).toBeNull();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it('free selection only persists the decision and waits for server acknowledgement', async () => {
    await mount(); const pending = deferred<any>(); fixture.request.mockReturnValueOnce(pending.promise);
    await settle(() => { container.querySelector<HTMLButtonElement>('[data-welcome-free]')!.click(); container.querySelector<HTMLButtonElement>('[data-welcome-free]')!.click(); });
    expect(container.querySelector('[data-catalog]')).toBeNull();
    expect(fixture.request.mock.calls.filter(([path]) => path === '/me/welcome-offer/choice')).toHaveLength(1);
    expect(fixture.request.mock.calls[1][1].body).toEqual({ choice: 'trial' });
    await settle(() => pending.resolve(status('dismissed')));
    expect(container.querySelector('[data-catalog]')?.textContent).toBe('Eligible catalogue');
    expect(fixture.request.mock.calls.some(([path]) => /trial-request|register|provider/.test(path))).toBe(false);
  });

  it('honors a native dual-user link without starting payment before the explicit purchase click', async () => {
    fixture.path = '/paketler'; fixture.search = '?welcome=1&users=2'; await mount();
    expect(container.textContent).toContain('199,50'); expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(fixture.request).toHaveBeenCalledTimes(1);
    fixture.request.mockResolvedValueOnce(status('dismissed')).mockResolvedValueOnce({ sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' });
    await settle(() => container.querySelector<HTMLButtonElement>('[data-welcome-paid]')!.click());
    expect(fixture.request.mock.calls[1][1].body).toEqual({ choice: 'monthly' });
    expect(fixture.request.mock.calls[2][1].body).toEqual({ packageSlug: '1-ay-2-kullanici', offerId: 'welcome-monthly-50-v1' });
    expect(fixture.checkout.plan.price).toBe(199.5); expect(container.querySelector('[data-embedded-checkout]')).not.toBeNull();
  });

  it('keeps unknown network failures closed with a retry but permits a genuine older API404', async () => {
    fixture.request.mockRejectedValueOnce(new Error('network unavailable')); await mount();
    expect(container.querySelector('[data-catalog]')).toBeNull(); expect(container.textContent).toContain('Tekrar dene');
    fixture.request.mockRejectedValueOnce(Object.assign(new Error('Route not found'), { status: 404 }));
    await settle(() => container.querySelector<HTMLButtonElement>('[data-welcome-retry]')!.click());
    expect(container.querySelector('[data-catalog]')).not.toBeNull();
  });

  it('never replaces a confirmed old account player on focus or token refresh', async () => {
    fixture.request.mockResolvedValue(status('not_eligible', false)); await mount();
    const child = container.querySelector('[data-catalog]');
    fixture.session = { ...fixture.session, accessToken: 'refreshed-a' }; await mount();
    await settle(() => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('[data-catalog]')).toBe(child); expect(fixture.childMounts).toBe(1); expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it('rejects an old account response after switching identities', async () => {
    const old = deferred<any>(); fixture.request.mockReturnValueOnce(old.promise); await mount();
    fixture.session = { accessToken: 'fixture-b', kryptoniteCode: 'BBBBBBBBBBBBBBBB' }; fixture.request.mockResolvedValueOnce(status('not_eligible', false)); await mount();
    await settle(() => old.resolve(status()));
    expect(container.querySelector('[data-catalog]')).not.toBeNull(); expect(container.textContent).not.toContain('3 Saat');
  });

  it('ignores a checkout response belonging to a logged-out account', async () => {
    await mount(); const pending = deferred<any>(); fixture.request.mockResolvedValueOnce(status('dismissed')).mockReturnValueOnce(pending.promise);
    await settle(() => container.querySelector<HTMLButtonElement>('[data-welcome-paid]')!.click());
    fixture.session = null; await mount();
    await settle(() => pending.resolve({ sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' }));
    expect(container.querySelector('[data-embedded-checkout]')).toBeNull();
  });

  it('reveals content after payment only when a fresh server offer response confirms completion', async () => {
    await mount();
    fixture.request.mockResolvedValueOnce(status('dismissed')).mockResolvedValueOnce({ sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' });
    await settle(() => container.querySelector<HTMLButtonElement>('[data-welcome-paid]')!.click());
    expect(container.querySelector('[data-catalog]')).toBeNull();
    fixture.request.mockResolvedValueOnce(status('redeemed', false)); await settle(() => fixture.checkout.onActivated());
    expect(container.querySelector('[data-catalog]')).not.toBeNull(); expect(fixture.refresh).toHaveBeenCalledOnce();
  });

  it('refreshes a pending decision made on another device without remounting a confirmed catalogue', async () => {
    await mount(); fixture.request.mockResolvedValueOnce(status('dismissed'));
    await settle(() => window.dispatchEvent(new Event('focus')));
    const child = container.querySelector('[data-catalog]'); expect(child).not.toBeNull();
    fixture.request.mockResolvedValueOnce(status('redeemed', false)); await settle(() => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('[data-catalog]')).toBe(child); expect(fixture.childMounts).toBe(1);
  });

  it.each(['/admin', '/admin/kullanicilar', '/giris-yap', '/kayit-ol', '/odeme-sonucu', '/iletisim'])('leaves %s outside the mandatory offer gate', async path => {
    fixture.path = path; await mount(); expect(container.querySelector('[data-catalog]')).not.toBeNull(); expect(fixture.request).not.toHaveBeenCalled();
  });
});
