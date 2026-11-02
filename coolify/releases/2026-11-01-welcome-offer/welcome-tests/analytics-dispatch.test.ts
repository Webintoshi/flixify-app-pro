import { expect, it, vi } from 'vitest';
import { AnalyticsDispatcher } from '../api-source/analytics-runtime.js';
import { analyticsConfiguration, type AnalyticsOutboxEvent } from '../api-source/analytics-delivery.js';
const config = () => analyticsConfiguration({ GA4_ENABLED: 'true', GA4_WINDOWS_MEASUREMENT_ID: 'G-WIN1234567', GA4_WINDOWS_API_SECRET: 'fixture-secret', GA4_ANALYTICS_HASH_SECRET: 'x'.repeat(40) });
const queued: AnalyticsOutboxEvent & { leaseToken: string } = { id: 'a'.repeat(64), leaseToken: 'lease-fixture', stream: 'windows', clientId: '34b7745b-573e-4e68-9790-b23415c418a4', sessionId: 123456, eventTimestampMs: Date.now(), name: 'video_start', params: { client_platform: 'windows' } };

it('serializes overlapping drains and keeps a slow Google call out of the route response', async () => {
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = { claim: vi.fn(async () => [queued]), consentActive: vi.fn(async () => true), finish: vi.fn(async () => {}) };
  const fetcher = vi.fn(async () => { entered(); await gate; return new Response(null, { status: 204 }); });
  const dispatcher = new AnalyticsDispatcher(store, config(), fetcher);
  const draining = dispatcher.flush();
  await enteredPromise;
  expect(await dispatcher.flush()).toBe(0);
  expect(store.claim).toHaveBeenCalledTimes(1);
  release(); expect(await draining).toBe(1);
  expect(store.finish).toHaveBeenCalledWith(queued.id, queued.leaseToken, { delivered: true, retryable: false });
});

it('rechecks consent before sending a claimed event and does not send a revoked queue', async () => {
  const store = { claim: vi.fn(async () => [queued]), consentActive: vi.fn(async () => false), finish: vi.fn(async () => {}) };
  const send = vi.fn(async () => new Response(null, { status: 204 }));
  expect(await new AnalyticsDispatcher(store, config(), send).flush()).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(store.finish).toHaveBeenCalledWith(queued.id, queued.leaseToken, { delivered: false, retryable: false });
});

it('preserves bounded retry state on transport failures and fails disabled without claims', async () => {
  const store = { claim: vi.fn(async () => [queued]), consentActive: vi.fn(async () => true), finish: vi.fn(async () => {}) };
  expect(await new AnalyticsDispatcher(store, analyticsConfiguration({})).flush()).toBe(0);
  expect(store.claim).not.toHaveBeenCalled();
  expect(await new AnalyticsDispatcher(store, config(), async () => { throw Error('private network detail'); }).flush()).toBe(0);
  expect(store.finish).toHaveBeenCalledWith(queued.id, queued.leaseToken, { delivered: false, retryable: true });
});
