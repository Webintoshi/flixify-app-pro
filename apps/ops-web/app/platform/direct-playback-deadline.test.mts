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
