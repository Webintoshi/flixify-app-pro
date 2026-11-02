import type { FastifyInstance } from 'fastify';
import { analyticsPublicConfiguration, type AnalyticsConfiguration } from './analytics-delivery.js';
import { ANALYTICS_BATCH_BYTES, validAnalyticsClientId, validateWindowsAnalyticsBatch, type WindowsAnalyticsBatch } from './analytics-policy.js';

export class AnalyticsCapacityError extends Error { constructor() { super('analytics_capacity'); } }
type Dependencies = {
  configuration: AnalyticsConfiguration;
  authenticate(authorization?: string): Promise<{ userId: string }>;
  store: { acceptWindowsBatch(userId: string, batch: WindowsAnalyticsBatch): Promise<number>; setConsent(userId: string, clientId: string, accepted: boolean): Promise<void>; wake(): void };
  rateLimit?: number;
};
class ExpiringBudget {
  private readonly values = new Map<string, { until: number; used: number }>();
  admit(key: string, count: number, maximum: number, now = Date.now()): boolean {
    const previous = this.values.get(key);
    if (previous && previous.until > now) {
      if (previous.used + count > maximum) return false;
      previous.used += count; return true;
    }
    if (count > maximum) return false;
    if (this.values.size >= 5000) for (const [stored, value] of this.values) if (value.until <= now) this.values.delete(stored);
    if (this.values.size >= 5000 && !previous) return false;
    this.values.set(key, { until: now + 60_000, used: count }); return true;
  }
}

export function registerAnalyticsRoutes(app: FastifyInstance, deps: Dependencies): void {
  const budget = new ExpiringBudget();
  async function owner(authorization?: string) {
    try { return { userId: (await deps.authenticate(authorization)).userId, status: 401 }; }
    catch (error) { return { userId: null, status: error instanceof Error && error.name === 'BlockedUserRouteError' ? 403 : 401 }; }
  }
  app.get('/analytics/config', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return analyticsPublicConfiguration(deps.configuration);
  });
  app.post('/me/analytics/events', { bodyLimit: ANALYTICS_BATCH_BYTES }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const auth = await owner(request.headers.authorization);
    if (!auth.userId) return reply.code(auth.status).send({ error: 'unauthorized' });
    const batch = validateWindowsAnalyticsBatch(request.body);
    if (!batch) return reply.code(400).send({ error: 'invalid_analytics' });
    if (!deps.configuration.windows) return reply.code(202).send({ accepted: 0 });
    if (!budget.admit(`events:${auth.userId}`, batch.events.length, deps.rateLimit ?? 120)) return reply.code(429).header('retry-after', '60').send({ error: 'analytics_limited' });
    try {
      const accepted = await deps.store.acceptWindowsBatch(auth.userId, batch);
      deps.store.wake();
      return reply.code(202).send({ accepted });
    } catch (error) {
      return reply.code(error instanceof AnalyticsCapacityError ? 429 : 503).send({ error: 'analytics_unavailable' });
    }
  });
  app.post('/me/analytics/consent', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const auth = await owner(request.headers.authorization);
    if (!auth.userId) return reply.code(auth.status).send({ error: 'unauthorized' });
    const body = request.body as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'clientId,consent,consentVersion,schema' || body.schema !== 1 || body.consentVersion !== 1 || !validAnalyticsClientId(body.clientId) || body.consent !== 'accepted' && body.consent !== 'rejected') return reply.code(400).send({ error: 'invalid_analytics' });
    if (!budget.admit(`consent:${auth.userId}`, 1, 20)) return reply.code(429).header('retry-after', '60').send({ error: 'analytics_limited' });
    try { await deps.store.setConsent(auth.userId, body.clientId, body.consent === 'accepted'); return reply.code(202).send({ accepted: true }); }
    catch { return reply.code(503).send({ error: 'analytics_unavailable' }); }
  });
}
