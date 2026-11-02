import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { analyticsConfiguration } from '../api-source/analytics-delivery.js';
import { registerAnalyticsRoutes } from '../api-source/analytics-routes.js';

const clientId = '34b7745b-573e-4e68-9790-b23415c418a4';
const body = () => ({ schema: 1, consentVersion: 1, clientPlatform: 'windows', clientId, sessionId: 12345,
  events: [{ id: '7f80e0ee-a7ab-4666-9e86-87e8fcdebd40', name: 'video_start', eventTimestampMs: Date.now(), params: { content_type: 'live', startup_ms: 1450 } }] });
function fixture(options: { configured?: boolean; limit?: number } = {}) {
  const app = Fastify();
  const ids = new Set<string>();
  let consent = true;
  const store = {
    acceptWindowsBatch: vi.fn(async (_user: string, batch: any) => { if (!consent) return 0; let accepted = 0; for (const event of batch.events) if (!ids.has(event.id)) { ids.add(event.id); accepted++; } return accepted; }),
    setConsent: vi.fn(async (_user: string, _client: string, accepted: boolean) => { consent = accepted; }),
    wake: vi.fn()
  };
  registerAnalyticsRoutes(app, { configuration: analyticsConfiguration(options.configured === false ? {} : { GA4_ENABLED: 'true', GA4_WINDOWS_MEASUREMENT_ID: 'G-WIN1234567', GA4_WINDOWS_API_SECRET: 'fixture-secret', GA4_ANALYTICS_HASH_SECRET: 'x'.repeat(40) }),
    authenticate: async authorization => { if (authorization !== 'Bearer fixture') throw Error('private-auth-error'); return { userId: 'fixture-user' }; }, store, rateLimit: options.limit });
  const send = (payload: unknown, auth = 'Bearer fixture') => app.inject({ method: 'POST', url: '/me/analytics/events', headers: { authorization: auth }, payload });
  return { app, store, send };
}

it('accepts a consented authenticated batch, acknowledges duplicates and returns without a Google round trip', async () => {
  const f = fixture();
  expect((await f.send(body())).json()).toEqual({ accepted: 1 });
  expect((await f.send(body())).json()).toEqual({ accepted: 0 });
  expect(f.store.wake).toHaveBeenCalledTimes(2);
  await f.app.close();
});

it('requires authentication and rejects malformed or oversize data before persistence', async () => {
  const f = fixture();
  expect((await f.send(body(), 'Bearer wrong')).statusCode).toBe(401);
  expect((await f.send({ ...body(), secret: 'private' })).statusCode).toBe(400);
  expect((await f.send({ ...body(), raw: 'x'.repeat(40_000) })).statusCode).toBe(413);
  expect(f.store.acceptWindowsBatch).not.toHaveBeenCalled();
  await f.app.close();
});

it('fails disabled and caps event ingestion per authenticated user', async () => {
  const disabled = fixture({ configured: false });
  expect((await disabled.send(body())).json()).toEqual({ accepted: 0 });
  expect(disabled.store.acceptWindowsBatch).not.toHaveBeenCalled();
  await disabled.app.close();
  const limited = fixture({ limit: 1 });
  expect((await limited.send(body())).statusCode).toBe(202);
  expect((await limited.send(body())).statusCode).toBe(429);
  expect(limited.store.acceptWindowsBatch).toHaveBeenCalledTimes(1);
  await limited.app.close();
});

it('persists withdrawal and does not re-enable a stale event batch', async () => {
  const f = fixture();
  expect((await f.app.inject({ method: 'POST', url: '/me/analytics/consent', headers: { authorization: 'Bearer fixture' }, payload: { schema: 1, consentVersion: 1, clientId, consent: 'rejected' } })).statusCode).toBe(202);
  expect((await f.send(body())).json()).toEqual({ accepted: 0 });
  expect(f.store.setConsent).toHaveBeenCalledWith('fixture-user', clientId, false);
  const config = await f.app.inject({ method: 'GET', url: '/analytics/config' });
  expect(config.statusCode).toBe(200);
  expect(config.payload).not.toMatch(/fixture-secret|xxxx|hashSecret|apiSecret/);
  await f.app.close();
});
