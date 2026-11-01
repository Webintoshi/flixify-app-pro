import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LiveTvPage from './page';

const state = vi.hoisted(() => ({ platform: {} as any, rows: [] as any[] }));
vi.mock('../platform/session', () => ({ usePlatform: () => state.platform, useProviderExpiry: () => state.platform.providerExpiresAt }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: (props: any) => React.createElement('a', props) }));
let root: Root, container: HTMLElement, observers: Observer[];
class Observer {
  target: Element | null = null;
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
  observe(target: Element) { this.target = target; }
  disconnect() {}
  trigger() {
    const target = this.target!;
    const previous = Object.getOwnPropertyDescriptor(target, 'getBoundingClientRect');
    Object.defineProperty(target, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 500, bottom: 501, width: 10, height: 1 }) });
    try { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    finally { if (previous) Object.defineProperty(target, 'getBoundingClientRect', previous); else Reflect.deleteProperty(target, 'getBoundingClientRect'); }
  }
}
const settle = async (action = () => {}) => { await act(async () => { action(); await vi.dynamicImportSettled(); }); };
const render = async () => { await settle(() => root.render(<LiveTvPage/>)); await settle(); };
const names = () => [...container.querySelectorAll('[aria-label="Canlı kanallar"] strong')].map(node => node.textContent);
const sentinelObserver = () => [...observers].reverse().find(observer => observer.target?.hasAttribute('data-infinite-scroll-sentinel'))!;
const clickTab = async (text: string) => settle(() => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === text)!.click());
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `fixture-channel-${index}`, title: `TR • Fixture Kanal ${index} FHD`, groupTitle: 'TR:ULUSAL',
  personalRef: { source: 'personal', sourceVersion: 'fixture-line', kind: 'live', id: String(1000 + index), extension: 'ts' }
}));
beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('Event', dom.window.Event);
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('IntersectionObserver', Observer);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } });
  observers = []; state.rows = rows(100); vi.useFakeTimers();
  state.platform = { session: { accessToken: 'fixture-token' }, favorites: state.rows.slice(0, 60).map(row => ({ ...row, kind: 'live' })),
    favoritesReady: true, pending: new Set(), toggle: vi.fn(), providerMode: 'personal', providerScope: 'fixture-line',
    providerExpiresAt: '2099-01-01', livePolicyRevision: 'initial',
    personalProvider: { catalog: vi.fn(async () => state.rows), playback: vi.fn(), shortEpg: vi.fn(), resolveLiveItemId: (id: string) => id } };
  container = document.getElementById('root')!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('appends channel rows on scrolling without a load-more button or opening any stream', async () => {
  await render(); expect(names()).toHaveLength(36);
  expect(container.textContent).not.toContain('Daha fazla kanal göster');
  const observer = sentinelObserver(); expect(observer).toBeDefined();
  await settle(() => { observer.trigger(); observer.trigger(); }); expect(names()).toHaveLength(72);
  await settle(() => observer.trigger()); expect(names()).toHaveLength(100);
  await settle(() => observer.trigger()); expect(names()).toHaveLength(100);
  expect(container.querySelector('[data-infinite-scroll-sentinel]')).toBeNull();
  expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
  expect(state.platform.personalProvider.playback).not.toHaveBeenCalled(); expect(container.querySelector('video')).toBeNull();
});

it('resets each tab to the first36 rows and discards queued callbacks from the old tab', async () => {
  await render(); const old = sentinelObserver(); await settle(() => old.trigger()); expect(names()).toHaveLength(72);
  await clickTab('Favorilerim'); expect(names()).toHaveLength(36);
  await settle(() => old.trigger()); expect(names()).toHaveLength(36);
  await settle(() => sentinelObserver().trigger()); expect(names()).toHaveLength(60);
  await clickTab('Tüm Kanallar'); expect(names()).toHaveLength(36);
  expect(state.platform.personalProvider.playback).not.toHaveBeenCalled();
});

it('resets a committed search query without allowing queued old-list callbacks or key presses to advance it', async () => {
  await render(); const old = sentinelObserver(); await settle(() => old.trigger()); expect(names()).toHaveLength(72);
  const input = container.querySelector<HTMLInputElement>('#live-channel-search')!;
  await settle(() => {
    // ReactDOM was imported before LinkeDOM, so dispatch its change-event fallback.
    Object.assign(input, {
      attachEvent: (name: string, handler: EventListener) => input.addEventListener(name.slice(2), handler),
      detachEvent: (name: string, handler: EventListener) => input.removeEventListener(name.slice(2), handler)
    });
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Fixture');
    const changed = new Event('propertychange', { bubbles: true });
    Object.defineProperty(changed, 'propertyName', { value: 'value' });
    input.dispatchEvent(changed);
  });
  expect(names()).toHaveLength(36);
  await settle(() => { old.trigger(); input.dispatchEvent(new Event('keyup', { bubbles: true })); });
  expect(names()).toHaveLength(36);
  await settle(() => sentinelObserver().trigger()); expect(names()).toHaveLength(72);
  expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
  expect(state.platform.personalProvider.playback).not.toHaveBeenCalled();
});

it('resets the current data revision without allowing an old observer to expand the replacement list', async () => {
  await render(); const old = sentinelObserver(); await settle(() => old.trigger()); expect(names()).toHaveLength(72);
  state.rows = rows(110); state.platform = { ...state.platform, livePolicyRevision: 'replacement' };
  await render(); expect(names()).toHaveLength(36);
  await settle(() => old.trigger()); expect(names()).toHaveLength(36);
  await settle(() => sentinelObserver().trigger()); expect(names()).toHaveLength(72);
  expect(state.platform.personalProvider.playback).not.toHaveBeenCalled();
});
