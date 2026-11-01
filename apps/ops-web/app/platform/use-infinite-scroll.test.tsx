import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useInfiniteScroll, type InfiniteScrollOptions } from './use-infinite-scroll';

let root: Root, container: HTMLElement;
let options: Omit<InfiniteScrollOptions, 'rootRef'>;
let geometry: { top: number; bottom: number; width: number; height: number };
let observers: FakeObserver[];
let elementPrototype: HTMLElement;
let originalDescriptors: Array<[string, PropertyDescriptor | undefined]>;
class FakeObserver {
  target: Element | null = null;
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) { observers.push(this); }
  observe(target: Element) { this.target = target; }
  trigger(intersecting = true) { this.callback([{ target: this.target!, isIntersecting: intersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
function Harness({ nested = false }: { nested?: boolean }) {
  const scrollRoot = useRef<HTMLDivElement>(null);
  const sentinel = useInfiniteScroll({ ...options, rootRef: nested ? scrollRoot : undefined });
  return <div ref={scrollRoot} data-scroll-root><button>Son içerik</button><div data-sentinel ref={sentinel}/></div>;
}
const settle = async (action = () => {}) => { await act(async () => { action(); }); };
const render = async (nested = false) => settle(() => root.render(<Harness nested={nested}/>));
const intersect = (observer = observers.at(-1)!) => {
  const previous = geometry;
  geometry = { top: 500, bottom: 501, width: 10, height: 1 };
  try { observer.trigger(); } finally { geometry = previous; }
};
beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('Event', dom.window.Event);
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'visible' }));
  geometry = { top: 2000, bottom: 2001, width: 10, height: 1 };
  elementPrototype = dom.window.HTMLElement.prototype;
  originalDescriptors = ['getBoundingClientRect', 'clientHeight', 'scrollHeight'].map(name => [name, Object.getOwnPropertyDescriptor(elementPrototype, name)]);
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const box = this.hasAttribute('data-scroll-root') ? { top: 0, bottom: 280, width: 400, height: 280 } : geometry;
    return { ...box, left: 0, right: box.width, x: 0, y: box.top, toJSON() {} } as DOMRect;
  };
  observers = [];
  options = { scopeKey: 'account:movie:all', enabled: true, hasMore: true, loading: false, error: null, progressKey: 48, onLoadNext: vi.fn() };
  container = document.getElementById('root')!; root = createRoot(container);
});
afterEach(async () => {
  await settle(() => root.unmount());
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(elementPrototype, name, descriptor);
    else delete (elementPrototype as unknown as Record<string, unknown>)[name];
  }
  vi.unstubAllGlobals();
});

it('admits one request for duplicate observer events until confirmed content advances', async () => {
  await render(); const observer = observers.at(-1)!;
  await settle(() => { intersect(observer); intersect(observer); });
  expect(options.onLoadNext).toHaveBeenCalledTimes(1);
  options = { ...options, loading: true }; await render();
  options = { ...options, loading: false }; await render();
  await settle(() => intersect(observer)); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
  options = { ...options, progressKey: 96 }; await render();
  await settle(() => intersect(observer)); expect(options.onLoadNext).toHaveBeenCalledTimes(2);
});

it('rejects a queued same-owner intersection after appended content moves the sentinel away', async () => {
  await render(); const observer = observers.at(-1)!;
  geometry = { top: 500, bottom: 501, width: 10, height: 1 };
  await settle(() => observer.trigger()); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
  geometry = { top: 3400, bottom: 3401, width: 10, height: 1 };
  options = { ...options, progressKey: 96 }; await render();
  await settle(() => observer.trigger()); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
  geometry = { top: 500, bottom: 501, width: 10, height: 1 };
  await settle(() => observer.trigger()); expect(options.onLoadNext).toHaveBeenCalledTimes(2);
});

it('latches synchronously even when a request callback fires another observer event', async () => {
  await render(); const observer = observers.at(-1)!;
  options = { ...options, onLoadNext: vi.fn(() => intersect(observer)) }; await render();
  await settle(() => intersect(observer)); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
});

it('uses the newest visibility entry when an observer delivers an older entry in the same batch', async () => {
  await render(); const observer = observers.at(-1)!;
  geometry = { top: 500, bottom: 501, width: 10, height: 1 };
  await settle(() => observer.callback([
    { target: observer.target!, isIntersecting: true },
    { target: observer.target!, isIntersecting: false }
  ] as IntersectionObserverEntry[], observer as unknown as IntersectionObserver));
  expect(options.onLoadNext).not.toHaveBeenCalled();
  await settle(() => intersect(observer)); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
});

it.each(['string', 'object'])('rejects queued old-scope events after an account or filter reset (%s scope)', async (kind) => {
  options = { ...options, scopeKey: kind === 'object' ? { account: 'old' } : 'old' };
  await render(); const old = observers.at(-1)!;
  await settle(() => intersect(old));
  options = { ...options, scopeKey: kind === 'object' ? { account: 'new' } : 'new', progressKey: 48 }; await render();
  await settle(() => intersect(old)); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
  await settle(() => intersect()); expect(options.onLoadNext).toHaveBeenCalledTimes(2);
  expect(old.disconnect).toHaveBeenCalled();
});

it('pauses disabled catalog panels and open modal dialogs without consuming a request', async () => {
  options = { ...options, enabled: false }; await render();
  await settle(() => intersect()); expect(options.onLoadNext).not.toHaveBeenCalled();
  options = { ...options, enabled: true }; await render();
  const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); document.body.append(dialog);
  await settle(() => intersect()); expect(options.onLoadNext).not.toHaveBeenCalled();
  dialog.remove(); await settle(() => intersect()); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
});

it('does not append while hidden and resumes only the current visible scope', async () => {
  await render();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  await settle(() => intersect()); expect(options.onLoadNext).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await settle(() => intersect()); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
});

it.each([{ hasMore: false }, { loading: true }, { error: new Error('page failed') }])('blocks automatic loading in a terminal, pending or error state: %j', async (state) => {
  options = { ...options, ...state }; await render();
  await settle(() => { intersect(); intersect(); });
  expect(options.onLoadNext).not.toHaveBeenCalled();
});

it('uses the actual nested scroller and switches to the viewport when mobile overflow becomes visible', async () => {
  vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }));
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 280 });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1600 });
  await render(true); const old = observers.at(-1)!;
  expect(old.options.root).toBe(container.querySelector('[data-scroll-root]'));
  vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'visible' }));
  await settle(() => window.dispatchEvent(new Event('resize')));
  expect(observers.at(-1)!.options.root).toBeNull();
  expect(old.disconnect).toHaveBeenCalled();
  await settle(() => intersect(old)); expect(options.onLoadNext).not.toHaveBeenCalled();
  await settle(() => intersect()); expect(options.onLoadNext).toHaveBeenCalledTimes(1);
});

it('falls back to passive scroll and keyboard focus when IntersectionObserver is unavailable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined); await render();
  geometry = { top: 500, bottom: 501, width: 10, height: 1 };
  await settle(() => { window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('scroll')); });
  expect(options.onLoadNext).toHaveBeenCalledTimes(1);
  geometry.top = 2000; geometry.bottom = 2001;
  options = { ...options, progressKey: 96 }; await render();
  geometry.top = 500; geometry.bottom = 501;
  await settle(() => container.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true })));
  expect(options.onLoadNext).toHaveBeenCalledTimes(2);
});

it('drops queued callbacks after unmount', async () => {
  await render(); const observer = observers.at(-1)!;
  await settle(() => root.render(null));
  await settle(() => intersect(observer)); expect(options.onLoadNext).not.toHaveBeenCalled();
});
