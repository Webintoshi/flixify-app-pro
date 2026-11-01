import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageCheckout, PackagePaymentProgress } from '../../components/ui/package-checkout';

const state = vi.hoisted(() => ({ request: vi.fn(), session: null as any }));
vi.mock('next/link', () => ({ default: (props: any) => React.createElement('a', props) }));
vi.mock('../../lib/api', () => ({ apiRequest: (...args: any[]) => state.request(...args) }));
vi.mock('../platform/session', () => ({ readSession: () => state.session }));
vi.mock('../account/components', () => ({ formatDate: (value: string) => value }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

describe('embedded payment lifecycle and status polling', () => {
  let root: Root | null;
  let container: HTMLElement;
  const session = { sessionId: 'cs_live_fixture', clientSecret: 'cs_live_fixture_secret_example', publishableKey: 'pk_live_fixture' };
  const plan = { slug: '6-ay-2-kullanici', months: 6, users: 2 as const, price: 999, available: true };
  async function settle(action: () => void = () => {}) {
    await act(async () => { action(); await Promise.resolve(); await Promise.resolve(); });
  }
  async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
  async function unmount() { if (root) { const current = root; root = null; await settle(() => current.unmount()); } }

  beforeEach(() => {
    vi.useFakeTimers();
    const dom = parseHTML('<html><head></head><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('Event', dom.window.Event); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Object.defineProperty(window.HTMLElement.prototype, 'focus', { value: vi.fn(), configurable: true });
    state.request.mockReset(); state.session = null;
    container = document.getElementById('root')!;
    root = createRoot(container);
  });
  afterEach(async () => { await unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('shows a later polling failure and recovers safely to confirmed activation', async () => {
    state.request.mockResolvedValueOnce({ status: 'processing' }).mockRejectedValueOnce(new Error('status unavailable')).mockResolvedValue({ status: 'active', endsAt: '2027-05-01T00:00:00.000Z' });
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    expect(container.textContent).toContain('Paketin hazırlanıyor');
    await advance(4000);
    expect(container.textContent).toContain('Ödeme durumu alınamadı');
    expect(container.textContent).toContain('Yeniden ödeme yapmadan');
    expect(container.textContent).not.toContain('Paketin kullanıma hazır');
    await settle(() => container.querySelector('button')!.click());
    expect(container.textContent).toContain('Paketin kullanıma hazır');
    expect(container.textContent).toContain('2027-05-01T00:00:00.000Z');
    await advance(24000);
    window.dispatchEvent(new Event('focus'));
    expect(state.request).toHaveBeenCalledTimes(3);
  });

  it('never overlaps interval or focus requests and stops polling at a terminal result', async () => {
    const first = deferred<{ status: string }>();
    state.request.mockReturnValueOnce(first.promise).mockResolvedValue({ status: 'active' });
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    await advance(12000);
    window.dispatchEvent(new Event('focus'));
    expect(state.request).toHaveBeenCalledTimes(1);
    await settle(() => first.resolve({ status: 'processing' }));
    await advance(4000);
    expect(state.request).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Paketin kullanıma hazır');
    await advance(30000);
    window.dispatchEvent(new Event('focus'));
    expect(state.request).toHaveBeenCalledTimes(2);
  });

  it('aborts the current status request on unmount and ignores its late response', async () => {
    const pending = deferred<{ status: string }>();
    state.request.mockReturnValue(pending.promise);
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    const signal = state.request.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    await unmount();
    expect(signal.aborted).toBe(true);
    await settle(() => pending.resolve({ status: 'active' }));
    await advance(30000);
    window.dispatchEvent(new Event('focus'));
    expect(container.textContent).toBe('');
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it('does not let an aborted older poll overwrite a newer confirmed activation', async () => {
    const older = deferred<{ status: string }>();
    state.request.mockResolvedValueOnce({ status: 'processing' }).mockReturnValueOnce(older.promise).mockResolvedValue({ status: 'active' });
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    await advance(4000);
    const oldSignal = state.request.mock.calls[1][1].signal as AbortSignal;
    await settle(() => container.querySelector('button')!.click());
    expect(oldSignal.aborted).toBe(true);
    expect(container.textContent).toContain('Paketin kullanıma hazır');
    await settle(() => older.resolve({ status: 'processing' }));
    expect(container.textContent).toContain('Paketin kullanıma hazır');
    await advance(12000);
    expect(state.request).toHaveBeenCalledTimes(3);
  });

  it('turns a timed out status request into a visible retry state', async () => {
    state.request.mockImplementation((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('status timeout')), { once: true });
    }));
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    await advance(15000);
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Ödeme durumu alınamadı');
    expect(container.querySelector('button')?.disabled).toBe(false);
  });

  it('destroys a Stripe instance that resolves after initialization timed out', async () => {
    const init = deferred<{ mount: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>();
    const mount = vi.fn(); const destroy = vi.fn();
    let complete: () => void = () => {};
    const initialize = vi.fn((options: { onComplete: () => void }) => { complete = options.onComplete; return init.promise; });
    Object.defineProperty(window, 'Stripe', { value: () => ({ createEmbeddedCheckoutPage: initialize }), configurable: true });
    await settle(() => root!.render(<PackageCheckout checkout={session} plan={plan} onBack={vi.fn()} />));
    expect(initialize).toHaveBeenCalledOnce();
    await advance(30000);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Ödeme ekranı açılamadı');
    await settle(() => { complete(); init.resolve({ mount, destroy }); });
    expect(mount).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Ödeme ekranı açılamadı');
    expect(state.request).not.toHaveBeenCalled();
  });

  it('destroys an initialization result arriving after the checkout screen was closed', async () => {
    const init = deferred<{ mount: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>();
    const mount = vi.fn(); const destroy = vi.fn();
    Object.defineProperty(window, 'Stripe', { value: () => ({ createEmbeddedCheckoutPage: () => init.promise }), configurable: true });
    await settle(() => root!.render(<PackageCheckout checkout={session} plan={plan} onBack={vi.fn()} />));
    await unmount();
    await settle(() => init.resolve({ mount, destroy }));
    expect(mount).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('');
    expect(state.request).not.toHaveBeenCalled();
  });
  it('clears an old account result on session change and ignores its late poll', async () => {
    const old = deferred<{ status: string }>();
    state.session = { accessToken: 'fixture-a', kryptoniteCode: 'account-a' };
    state.request.mockReturnValueOnce(old.promise).mockRejectedValue(new Error('not owned'));
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    const signal = state.request.mock.calls[0][1].signal as AbortSignal;
    await settle(() => { state.session = { accessToken: 'fixture-b', kryptoniteCode: 'account-b' }; window.dispatchEvent(new Event('flixify-session')); });
    expect(signal.aborted).toBe(true);
    await settle(() => old.resolve({ status: 'active' }));
    expect(container.textContent).not.toContain('Paketin kullanıma hazır');
    expect(container.textContent).toContain('Ödeme durumu alınamadı');
  });

  it('removes terminal success immediately when another tab changes the account', async () => {
    state.session = { accessToken: 'fixture-a', kryptoniteCode: 'account-a' };
    state.request.mockResolvedValueOnce({ status: 'active', endsAt: '2027-05-01' }).mockRejectedValue(new Error('not owned'));
    await settle(() => root!.render(<PackagePaymentProgress sessionId={session.sessionId} />));
    expect(container.textContent).toContain('Paketin kullanıma hazır');
    await settle(() => { state.session = { accessToken: 'fixture-b', kryptoniteCode: 'account-b' }; window.dispatchEvent(new Event('storage')); });
    expect(container.textContent).not.toContain('Paketin kullanıma hazır');
    expect(container.textContent).not.toContain('2027-05-01');
  });

});
