import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrialClock, remainingTrialSeconds } from './trial-countdown-model';
import { useSharedAccountResource } from './account-resource';
import { TrialCountdown } from './trial-countdown';
import { AppShell } from './shell';
import SettingsPage from '../ayarlar/page';
import type { Session } from './types';

const transport = vi.hoisted(() => ({ request: vi.fn(), platform: {} as any, pathname: '/' }));
vi.mock('../../lib/api', () => ({ apiRequest: (...args: unknown[]) => transport.request(...args) }));
vi.mock('next/link', () => ({ default: (props: any) => <a {...props}/> }));
vi.mock('./analytics', () => ({ trackAnalytics: vi.fn() }));
vi.mock('./session', () => ({ usePlatform: () => transport.platform, readSession: () => transport.platform.session }));
vi.mock('next/navigation', () => ({ usePathname: () => transport.pathname, useRouter: () => ({ push: vi.fn() }) }));
const start = '2026-11-07T12:00:00.000Z', end = '2026-11-07T15:00:00.000Z';
const trial = (status = 'active', endsAt: string | null = end, serverNow = start) => ({ status, endsAt, serverNow });
const session = (id = 'account-a'): Session => ({ accessToken: `fixture.${btoa(JSON.stringify({ sub: id }))}.signature` });
const me = (id = 'account-a', countdown = trial()) => ({ user: { id, status: 'active', hasAssignedLink: true, hasActiveSubscription: true, activePackage: { title: '3 Saat Deneme', endsAt: end } }, trialCountdown: countdown });
let root: Root, container: HTMLElement, monotonic: number;
const settle = async (action = () => {}) => { await act(async () => { action(); }); };
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('Event', dom.window.Event);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date(start));
  monotonic = 100; vi.stubGlobal('performance', { now: () => monotonic });
  transport.request.mockReset().mockResolvedValue(me());
  transport.platform = { session: session(), ready: true, reload: vi.fn(), logout: vi.fn(), dismissError: vi.fn() }; transport.pathname = '/';
  container = document.getElementById('root')!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('trial countdown clock', () => {
  it('counts from the existing server cutoff and ignores changes to the wall clock', () => {
    const clock = createTrialClock(trial(), monotonic)!;
    expect(remainingTrialSeconds(clock, monotonic)).toBe(10800);
    vi.setSystemTime(new Date('2036-01-01'));
    expect(remainingTrialSeconds(clock, monotonic + 3600000)).toBe(7200);
    expect(remainingTrialSeconds(clock, monotonic + 10800000)).toBe(0);
    expect(remainingTrialSeconds(clock, monotonic + 10801000)).toBe(0);
  });
  it('reanchors from the server after a reload instead of granting three hours again', () => {
    const clock = createTrialClock(trial('active', end, '2026-11-07T14:59:00.000Z'), 12)!;
    expect(remainingTrialSeconds(clock, 12)).toBe(60);
  });
  it('cannot gain time from an older snapshot but accepts a genuinely extended server deadline', () => {
    const first = createTrialClock(trial(), 100)!;
    const older = createTrialClock(trial(), 10100, first)!;
    expect(remainingTrialSeconds(older, 10100)).toBe(10790);
    const extended = createTrialClock(trial('active', '2026-11-07T16:00:00.000Z'), 10100, first)!;
    expect(remainingTrialSeconds(extended, 10100)).toBe(14400);
  });
  it.each([trial('none', null), trial('pending', null), trial('unavailable', null), trial('active', null), trial('active', 'invalid'), { ...trial(), serverNow: 'invalid' }, { ...trial(), status: ['active'] }, undefined])('does not make a clock for a non-counting or malformed response %#', raw => {
    expect(createTrialClock(raw, monotonic)).toBeNull();
  });
});

it('updates only the timer child, makes no per-second requests, and does not announce each second', async () => {
  let peerRenders = 0;
  function Shell() {
    const account = useSharedAccountResource(session());
    peerRenders++;
    return <><p>Catalogue stays mounted</p><TrialCountdown clock={account.trialClock} onExpired={account.refresh}/></>;
  }
  await settle(() => root.render(<Shell/>));
  expect(container.querySelector('[role="timer"]')?.textContent).toBe('03:00:00');
  expect(container.querySelector('[role="timer"]')?.getAttribute('aria-live')).toBe('off');
  const renders = peerRenders; const requests = transport.request.mock.calls.length;
  monotonic += 1000; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector('[role="timer"]')?.textContent).toBe('02:59:59');
  expect(peerRenders).toBe(renders); expect(transport.request).toHaveBeenCalledTimes(requests);
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/paketler');
});

it('clears an old trial immediately on account switch and ignores a late response', async () => {
  let finish!: (value: unknown) => void;
  transport.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(me('account-b', trial('none', null)));
  function Shell({ id }: { id: string }) { const resource = useSharedAccountResource(session(id)); return <TrialCountdown clock={resource.trialClock}/>; }
  await settle(() => root.render(<Shell id="account-a"/>));
  await settle(() => root.render(<Shell id="account-b"/>));
  await settle(() => finish(me()));
  expect(container.querySelector('[role="timer"]')).toBeNull();
});

it('hides a visible previous account timer while the replacement account is still loading', async () => {
  let finish!: (value: unknown) => void;
  function Shell({ id }: { id: string }) { const resource = useSharedAccountResource(session(id)); return <TrialCountdown clock={resource.trialClock}/>; }
  await settle(() => root.render(<Shell id="account-a"/>));
  expect(container.querySelector('[role="timer"]')).not.toBeNull();
  transport.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await settle(() => root.render(<Shell id="account-b"/>));
  expect(container.querySelector('[role="timer"]')).toBeNull();
  await settle(() => finish(me('account-b', trial('none', null))));
  expect(container.querySelector('[role="timer"]')).toBeNull();
});

it('reanchors after background suspension without polling while hidden', async () => {
  function Shell() { const resource = useSharedAccountResource(session()); return <TrialCountdown clock={resource.trialClock}/>; }
  await settle(() => root.render(<Shell/>));
  const requests = transport.request.mock.calls.length;
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  await settle(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(3600000); });
  expect(transport.request).toHaveBeenCalledTimes(requests);
  transport.request.mockResolvedValue(me('account-a', trial('active', end, '2026-11-07T14:00:00.000Z')));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await settle(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(container.querySelector('[role="timer"]')?.textContent).toBe('01:00:00');
});

it('removes the counter when the authoritative refresh reports a paid package', async () => {
  function Shell() { const resource = useSharedAccountResource(session()); return <TrialCountdown clock={resource.trialClock}/>; }
  await settle(() => root.render(<Shell/>));
  expect(container.querySelector('[role="timer"]')).not.toBeNull();
  transport.request.mockResolvedValue(me('account-a', trial('none', null)));
  await settle(() => window.dispatchEvent(new Event('focus')));
  expect(container.querySelector('[role="timer"]')).toBeNull();
});

it('finishes an initial timeout and recovers through the existing focus refresh', async () => {
  transport.request.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture timeout')))));
  function Shell() { const resource = useSharedAccountResource(session()); return <output>{resource.loading ? 'loading' : resource.error ? 'error' : 'ready'}</output>; }
  await settle(() => root.render(<Shell/>));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(container.textContent).toBe('error');
  await settle(() => window.dispatchEvent(new Event('focus')));
  expect(container.textContent).toBe('ready');
});

it('refreshes at zero once and never resets the expired display locally', async () => {
  const clock = createTrialClock(trial('active', '2026-11-07T12:00:01.000Z'), monotonic)!;
  const refresh = vi.fn();
  await settle(() => root.render(<TrialCountdown clock={clock} onExpired={refresh}/>));
  monotonic += 1000; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector('[role="timer"]')?.textContent).toBe('00:00:00');
  expect(container.textContent).toContain('Deneme sona erdi'); expect(refresh).toHaveBeenCalledTimes(1);
  monotonic += 1000; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('mounts the countdown in the real browsing header without rerendering the catalogue every second', async () => {
  transport.platform.accountResource = { data: me(), trialClock: createTrialClock(trial(), monotonic), refresh: vi.fn() };
  let catalogueRenders = 0;
  function Catalogue() { catalogueRenders++; return <p>Content stays mounted</p>; }
  await settle(() => root.render(<AppShell><Catalogue/></AppShell>));
  expect(container.querySelector('header [role="timer"]')?.textContent).toBe('03:00:00');
  monotonic += 1000; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector('header [role="timer"]')?.textContent).toBe('02:59:59');
  expect(catalogueRenders).toBe(1);
});

it('uses the shared snapshot in the real account page without a second me poll', async () => {
  transport.pathname = '/ayarlar';
  transport.platform.accountResource = { data: me(), trialClock: createTrialClock(trial(), monotonic), refresh: vi.fn(), reload: vi.fn(), loading: false, error: false };
  transport.request.mockResolvedValue({ status: 'none' });
  await settle(() => root.render(<SettingsPage/>));
  expect(container.querySelector('[role="timer"]')?.textContent).toBe('03:00:00');
  expect(transport.request.mock.calls.some(([path]) => path === '/me')).toBe(false);
  expect(container.textContent).toContain('Paketleri gör');
});

it('marks account access inactive at the trial cutoff despite a wrong wall clock and failed authority refresh', async () => {
  vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  const countdown = trial('active', '2026-11-07T12:00:01.000Z');
  let checks = 0;
  transport.request.mockImplementation(async (path: string) => {
    if (path === '/me/billing/status') return { status: 'none' };
    if (path === '/me' && checks++ === 0) return me('account-a', countdown);
    throw new Error('fixture authority refresh unavailable');
  });
  function AccountHarness() {
    const resource = useSharedAccountResource(session());
    transport.platform.accountResource = resource;
    return <SettingsPage/>;
  }
  await settle(() => root.render(<AccountHarness/>));
  const accountStatus = () => [...container.querySelectorAll('h2')].find(node => node.textContent === 'Hesap durumu')?.parentElement?.querySelector('span')?.textContent;
  expect(accountStatus()).toBe('Aktif');
  expect(container.querySelector('[role="timer"]')?.textContent).toBe('00:00:01');
  monotonic += 1000; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(accountStatus()).toBe('Aktif paket yok');
  expect(container.querySelector('aside h3')?.textContent).toBe('Aktif paketiniz yok');
  expect(container.querySelector('[role="timer"]')).toBeNull();
  expect(checks).toBe(2);
  monotonic += 1000; await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(checks).toBe(2);
});

it('does not label an already expired server clock active because the local date is behind', async () => {
  vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
  transport.platform.accountResource = { data: me(), trialClock: createTrialClock(trial('expired', start), monotonic), refresh: vi.fn(), reload: vi.fn(), loading: false, error: false };
  transport.request.mockResolvedValue({ status: 'none' });
  await settle(() => root.render(<SettingsPage/>));
  expect(container.querySelector('aside h3')?.textContent).toBe('Aktif paketiniz yok');
  expect(container.querySelector('[role="timer"]')).toBeNull();
});
