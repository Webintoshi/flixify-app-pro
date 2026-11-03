import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceApprovalPage from './page';
import LoginPage from '../giris-yap/page';
import { LoginDialog } from '../platform/login';

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  platform: {} as any,
  router: { push: vi.fn(), replace: vi.fn() },
  analytics: vi.fn()
}));
vi.mock('../../lib/api', () => ({
  apiRequest: fixture.request,
  ApiRequestError: class extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  }
}));
vi.mock('../platform/session', () => ({ usePlatform: () => fixture.platform }));
vi.mock('../platform/analytics', () => ({ trackAnalytics: fixture.analytics }));
vi.mock('next/navigation', () => ({ useRouter: () => fixture.router }));
vi.mock('next/link', () => ({ default: (props: any) => React.createElement('a', props) }));
vi.mock('next/image', () => ({ default: ({ priority, ...props }: any) => React.createElement('img', props) }));

const userCode = 'BCDF-GHJK';
const storageKey = 'flixify-public-session';
const session = { accessToken: 'fixture-access-a', refreshToken: 'fixture-refresh-a', user: {
  id: 'fixture-account-a', codeSuffix: 'ABCD', status: 'active', hasAssignedLink: true,
  hasActiveSubscription: true, activePackage: null
} };
const preview = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'ae752a4e-98b5-44c4-8093-56ac3c6b8e46', userCode, deviceName: 'Fixture living room TV',
  platform: 'android_tv', expiresAt: '2099-01-01T00:00:00Z', accountSuffix: 'ABCD',
  approvalNonce: 'fixture-bound-nonce-a', state: 'pending', ...overrides
});
const challenge = {
  requestId: 'ae752a4e-98b5-44c4-8093-56ac3c6b8e46', deviceSecret: 'x'.repeat(43), userCode,
  verificationUri: 'https://flixify.vip/cihaz', verificationUriComplete: `https://flixify.vip/cihaz?code=${userCode}`,
  qrPngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAA==', expiresInSeconds: 180, intervalSeconds: 2
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
let root: Root, container: HTMLElement;
const settle = async (action: () => void = () => {}) => { await act(async () => { action(); }); };
const render = (element: React.ReactNode) => settle(() => root.render(element));
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text);
const click = (text: string) => settle(() => {
  const target = button(text);
  expect(target, `Expected button: ${text}`).toBeDefined();
  target!.dispatchEvent(new Event('click', { bubbles: true }));
});
const calls = (path: string) => fixture.request.mock.calls.filter(call => call[0] === path);
function route(path: string) { Object.defineProperty(window, 'location', { configurable: true, value: new URL(path, 'https://flixify.vip') }); }
async function type(input: HTMLInputElement, value: string) {
  await settle(() => {
    // ReactDOM loads before LinkeDOM, so use its change-event fallback.
    Object.assign(input, {
      attachEvent: (name: string, handler: EventListener) => input.addEventListener(name.slice(2), handler),
      detachEvent: (name: string, handler: EventListener) => input.removeEventListener(name.slice(2), handler)
    });
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    const event = new Event('propertychange', { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'value' });
    input.dispatchEvent(event);
  });
}

beforeEach(() => {
  const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('Event', dom.window.Event); vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  (dom.window.HTMLElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  fixture.request.mockReset(); fixture.router.push.mockReset(); fixture.router.replace.mockReset(); fixture.analytics.mockReset();
  fixture.platform = { ready: true, session, saveSession: vi.fn() };
  fixture.request.mockImplementation(async (path: string) => {
    if (path === '/auth/device/lookup') return preview();
    if (path === '/auth/device/start') return challenge;
    if (path === '/auth/device/token') return { status: 'pending' };
    if (path === '/auth/device/cancel') return { status: 'cancelled' };
    if (path === '/settings/public') return {};
    if (path === '/me') return { user: session.user };
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network is forbidden in component acceptance tests'); }));
  route(`/cihaz?code=${userCode}`);
  container = document.getElementById('root')!; root = createRoot(container);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(async () => {
  await settle(() => root.unmount());
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('phone device consent', () => {
  it('opening the scanned URL only looks up a preview and never approves or signs in', async () => {
    await render(<DeviceApprovalPage/>);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(calls('/auth/device/lookup')[0]).toEqual(['/auth/device/lookup', {
      method: 'POST', body: { code: userCode }, accessToken: session.accessToken,
      skipAuthRefresh: true, signal: expect.any(AbortSignal)
    }]);
    expect(container.textContent).toContain('Fixture living room TV · Android TV');
    expect(container.textContent).toContain('•••• ABCD');
    expect(container.textContent).toContain(userCode);
    expect(button('Bu cihazda giriş yap')).toBeDefined();
    expect(button('Reddet')).toBeDefined();
    expect(fixture.platform.saveSession).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(fixture.analytics).not.toHaveBeenCalled();
  });

  it('an anonymous phone uses manual login and returns to exactly the pending code without approving', async () => {
    fixture.platform.session = null;
    await render(<DeviceApprovalPage/>);
    const login = container.querySelector<HTMLAnchorElement>('a[href^="/giris-yap"]')!;
    expect(login.getAttribute('href')).toBe(`/giris-yap?device_code=${userCode}`);
    expect(fixture.request).not.toHaveBeenCalled();
    expect(button('Bu cihazda giriş yap')).toBeUndefined();
    route(login.getAttribute('href')!);
    sessionStorage.setItem('flixify-auth-prefill-code', 'ABCDEFGHIJKLMNOP');
    fixture.request.mockImplementation(async (path: string) => {
      if (path === '/settings/public') return {};
      if (path === '/auth/login-by-code') return session;
      if (path === '/me') return { user: session.user };
      throw new Error(`Unexpected fixture request: ${path}`);
    });
    await render(<LoginPage/>);
    expect(button('Telefonla QR giriş')).toBeUndefined();
    expect(calls('/auth/login-by-code')).toHaveLength(0);
    await click('Giriş Yap');
    expect(calls('/auth/login-by-code')).toHaveLength(1);
    expect(calls('/auth/login-by-code')[0][1].body.code).toBe('ABCDEFGHIJKLMNOP');
    expect(fixture.router.push).toHaveBeenCalledExactlyOnceWith(`/cihaz?code=${userCode}`);
    expect(fixture.router.replace).not.toHaveBeenCalled();
    expect(calls('/auth/device/decision')).toHaveLength(0);
    expect(calls('/auth/device/start')).toHaveLength(0);
    expect(container.textContent).not.toContain('Premium Erişim');
  });

  it.each(['https://evil.test/cihaz', 'BCDF-GHJK&return=https://evil.test', '1234-5678'])(
    'does not retain an invalid device return value %s', async invalid => {
      fixture.platform.session = null;
      route(`/giris-yap?device_code=${encodeURIComponent(invalid)}`);
      sessionStorage.setItem('flixify-auth-prefill-code', 'ABCDEFGHIJKLMNOP');
      fixture.request.mockImplementation(async (path: string) => path === '/auth/login-by-code' ? session : path === '/me' ? { user: session.user } : {});
      await render(<LoginPage/>);
      await click('Giriş Yap');
      expect(fixture.router.push).toHaveBeenCalledExactlyOnceWith('/');
      expect(calls('/auth/device/decision')).toHaveLength(0);
    }
  );

  it.each([['Bu cihazda giriş yap', 'approve'], ['Reddet', 'deny']])(
    'sends %s only after the explicit click, using the preview nonce and fixed token', async (label, action) => {
      const pending = deferred<unknown>();
      fixture.request.mockImplementation(async (path: string) => path === '/auth/device/lookup' ? preview() : pending.promise);
      await render(<DeviceApprovalPage/>);
      expect(calls('/auth/device/decision')).toHaveLength(0);
      await click(label);
      expect(button('Bu cihazda giriş yap')!.disabled).toBe(true);
      expect(button('Reddet')!.disabled).toBe(true);
      await click(label);
      expect(calls('/auth/device/decision')).toHaveLength(1);
      expect(calls('/auth/device/decision')[0]).toEqual(['/auth/device/decision', {
        method: 'POST', accessToken: session.accessToken, skipAuthRefresh: true, signal: expect.any(AbortSignal),
        body: { requestId: preview().requestId, userCode, approvalNonce: preview().approvalNonce, action }
      }]);
      await settle(() => pending.resolve({ status: action === 'approve' ? 'approved' : 'denied' }));
      expect(button('Bu cihazda giriş yap')).toBeUndefined();
      expect(button('Reddet')).toBeUndefined();
      expect(fixture.platform.saveSession).not.toHaveBeenCalled();
    }
  );

  it.each(['approved', 'completed'])(
    'after a lost approval response, rechecks %s status without another decision', async state => {
      let lookups = 0;
      fixture.request.mockImplementation(async (path: string) => {
        if (path === '/auth/device/lookup') return ++lookups === 1 ? preview() : preview({ state, approvalNonce: undefined });
        if (path === '/auth/device/decision') throw new Error('Lost response after server accepted approval');
        throw new Error(`Unexpected fixture request: ${path}`);
      });
      await render(<DeviceApprovalPage/>);
      await click('Bu cihazda giriş yap');
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Yeniden onaylamak yerine');
      expect(button('Bu cihazda giriş yap')).toBeUndefined();
      expect(button('Reddet')).toBeUndefined();
      await click('Son durumu kontrol et');
      expect(calls('/auth/device/lookup')).toHaveLength(2);
      expect(calls('/auth/device/decision')).toHaveLength(1);
      expect(container.querySelector('[role="status"]')?.textContent).toContain('girişi onaylandı');
      expect(button('Son durumu kontrol et')).toBeUndefined();
      expect(button('Bu cihazda giriş yap')).toBeUndefined();
    }
  );

  it('discards an old account preview even when it resolves after the new account preview', async () => {
    const old = deferred<unknown>(), next = deferred<unknown>();
    fixture.request.mockImplementation((_path: string, options: any) => options.accessToken === session.accessToken ? old.promise : next.promise);
    await render(<DeviceApprovalPage/>);
    const oldSignal = calls('/auth/device/lookup')[0][1].signal;
    fixture.platform = { ...fixture.platform, session: { accessToken: 'fixture-access-b' } };
    await render(<DeviceApprovalPage/>);
    expect(oldSignal.aborted).toBe(true);
    await settle(() => next.resolve(preview({ accountSuffix: 'WXYZ', approvalNonce: 'fixture-bound-nonce-b' })));
    await settle(() => old.resolve(preview()));
    expect(container.textContent).toContain('•••• WXYZ');
    expect(container.textContent).not.toContain('•••• ABCD');
    fixture.request.mockResolvedValue({ status: 'approved' });
    await click('Bu cihazda giriş yap');
    const options = calls('/auth/device/decision')[0][1];
    expect(options.accessToken).toBe('fixture-access-b');
    expect(options.body.approvalNonce).toBe('fixture-bound-nonce-b');
  });

  it('discards a pending preview after logout and keeps manual continuation available', async () => {
    const pending = deferred<unknown>();
    fixture.request.mockReturnValue(pending.promise);
    await render(<DeviceApprovalPage/>);
    fixture.platform = { ...fixture.platform, session: null };
    await render(<DeviceApprovalPage/>);
    await settle(() => pending.resolve(preview()));
    expect(container.querySelector('dl')).toBeNull();
    expect(button('Bu cihazda giriş yap')).toBeUndefined();
    expect(container.querySelector('a[href^="/giris-yap"]')?.getAttribute('href')).toBe(`/giris-yap?device_code=${userCode}`);
    expect(calls('/auth/device/decision')).toHaveLength(0);
  });

  it('an expired preview cannot be approved and never starts a replacement challenge', async () => {
    fixture.request.mockResolvedValue(preview({ expiresAt: '2020-01-01T00:00:00Z' }));
    await render(<DeviceApprovalPage/>);
    expect(container.textContent).toContain('Kodun süresi doldu');
    expect(button('Bu cihazda giriş yap')).toBeUndefined();
    expect(button('Reddet')).toBeUndefined();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
});

describe('target manual and QR controls', () => {
  it('starts only on explicit QR entry and ignores authorization arriving after returning to manual login', async () => {
    route('/giris-yap');
    const pending = deferred<unknown>();
    const normalRequest = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation((path: string, options: any) => path === '/auth/device/token' ? pending.promise : normalRequest(path, options));
    await render(<LoginPage/>);
    expect(calls('/auth/device/start')).toHaveLength(0);
    await click('Telefonla QR giriş');
    expect(calls('/auth/device/start')).toHaveLength(1);
    expect(container.querySelector('img[alt="Flixify cihaz giriş QR kodu"]')?.getAttribute('src')).toBe(`data:image/png;base64,${challenge.qrPngBase64}`);
    expect(container.textContent).toContain(userCode);
    expect(container.textContent).not.toContain(challenge.deviceSecret);
    expect(container.textContent).not.toContain(challenge.requestId);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(calls('/auth/device/token')).toHaveLength(1);
    await click('Kullanıcı koduyla giriş yap');
    expect(calls('/auth/device/cancel')).toHaveLength(1);
    expect(calls('/auth/device/token')[0][1].signal.aborted).toBe(true);
    await settle(() => pending.resolve({ status: 'authorized', session }));
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(fixture.router.push).not.toHaveBeenCalled();
    expect(calls('/auth/device/ack')).toHaveLength(0);
    expect(button('Telefonla QR giriş')).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(calls('/auth/device/token')).toHaveLength(1);
  });

  it.each(['public page', 'player dialog'])('disables QR entry while %s manual login is pending', async surface => {
    route('/giris-yap');
    const pending = deferred<unknown>();
    const normalRequest = fixture.request.getMockImplementation()!;
    fixture.request.mockImplementation((path: string, options: any) => path === '/auth/login-by-code' ? pending.promise : normalRequest(path, options));
    if (surface === 'public page') {
      sessionStorage.setItem('flixify-auth-prefill-code', 'ABCDEFGHIJKLMNOP');
      await render(<LoginPage/>);
      await click('Giriş Yap');
    } else {
      await render(<LoginDialog onClose={vi.fn()}/>);
      await type(container.querySelector<HTMLInputElement>('#player-code')!, 'ABCDEFGHIJKLMNOP');
      expect(container.querySelector<HTMLButtonElement>('form button')!.disabled).toBe(false);
      await settle(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    }
    expect(calls('/auth/login-by-code')).toHaveLength(1);
    expect(button('Telefonla QR giriş')!.disabled).toBe(true);
    await click('Telefonla QR giriş');
    expect(calls('/auth/device/start')).toHaveLength(0);
    await settle(() => pending.reject(new Error('Fixture manual login unavailable')));
    expect(button('Telefonla QR giriş')!.disabled).toBe(false);
  });
});
