import assert from 'node:assert/strict';
import test from 'node:test';
import * as policy from './direct-playback-deadline.ts';

function setup(cutoff: string | null) {
  let now = 1000, stopped = 0;
  const events = new EventTarget();
  const timers = new Map<number, () => void>();
  let id = 0;
  const create = (policy as any).createDirectPlaybackDeadline;
  assert.equal(typeof create, 'function');
  const watcher = create(cutoff, () => stopped++, {
    now: () => now, events, visibility: events,
    schedule: (fn: () => void) => { timers.set(++id, fn); return id; },
    clear: (key: number) => timers.delete(key)
  });
  return { watcher, timers, events, stopped: () => stopped, time: (value: number) => now = value };
}
test('absolute deadline stops once even when timers are delayed and return events repeat', () => {
  const state = setup(new Date(2000).toISOString());
  state.time(3000);
  state.events.dispatchEvent(new Event('focus'));
  state.events.dispatchEvent(new Event('visibilitychange'));
  state.events.dispatchEvent(new Event('pageshow'));
  assert.equal(state.stopped(), 1);
  assert.equal(state.timers.size, 0);
});
test('timer rechecks absolute time and expires at the cutoff', () => {
  const state = setup(new Date(2000).toISOString());
  const fire = [...state.timers.values()][0]; state.timers.clear(); fire();
  assert.equal(state.stopped(), 0);
  state.time(2000); [...state.timers.values()][0]();
  assert.equal(state.stopped(), 1);
});
test('disposal removes pending timer and event effects', () => {
  const state = setup(new Date(2000).toISOString());
  state.watcher.dispose(); state.time(3000);
  state.events.dispatchEvent(new Event('focus'));
  assert.equal(state.stopped(), 0); assert.equal(state.timers.size, 0);
});
test('null remains unrestricted, invalid or elapsed cutoffs fail closed', () => {
  assert.equal(setup(null).stopped(), 0);
  assert.equal(setup('bad').stopped(), 1);
  assert.equal(setup('').stopped(), 1);
  assert.equal(setup(new Date(1000).toISOString()).stopped(), 1);
});

test('default browser environment preserves Window receiver for scheduling and clearing through expiry', (t) => {
  const keys = ['window', 'document', 'setTimeout', 'clearTimeout'] as const;
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const timers = new Map<number, () => void>();
  let nextId = 0, schedules = 0, clears = 0, expired = 0, now = 1000;
  const browser = Object.assign(new EventTarget(), {
    setTimeout(this: unknown, callback: () => void, delay: number) {
      assert.equal(this, browser, 'Window.setTimeout requires its Window receiver');
      assert.equal(delay, 1000);
      schedules++;
      timers.set(++nextId, callback);
      return nextId;
    },
    clearTimeout(this: unknown, id: number) {
      assert.equal(this, browser, 'Window.clearTimeout requires its Window receiver');
      clears++;
      timers.delete(id);
    }
  });
  const visibility = new EventTarget();
  t.mock.method(Date, 'now', () => now);
  try {
    for (const [key, value] of Object.entries({ window: browser, document: visibility, setTimeout: browser.setTimeout, clearTimeout: browser.clearTimeout })) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const watcher = policy.createDirectPlaybackDeadline(new Date(2000).toISOString(), () => expired++);
    assert.equal(schedules, 1);
    // A return event clears and rearms the existing timer through the default environment.
    browser.dispatchEvent(new Event('focus'));
    assert.equal(clears, 1);
    assert.equal(schedules, 2);
    now = 2000;
    [...timers.values()][0]();
    assert.equal(expired, 1);
    assert.equal(watcher.expired, true);
    assert.equal(clears, 2);
    assert.equal(timers.size, 0);
    browser.dispatchEvent(new Event('pageshow'));
    visibility.dispatchEvent(new Event('visibilitychange'));
    watcher.dispose();
    assert.equal(expired, 1);
    assert.equal(clears, 2);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('metadata extension and shortening update the existing absolute timer', () => {
  const state = setup(new Date(2000).toISOString());
  state.watcher.update(new Date(4000).toISOString());
  state.time(2500); state.events.dispatchEvent(new Event('focus'));
  assert.equal(state.stopped(), 0);
  state.watcher.update(new Date(2500).toISOString());
  assert.equal(state.stopped(), 1);
});
