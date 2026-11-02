import { createHash } from 'node:crypto';

export type AnalyticsStream = 'web' | 'windows';
export type AnalyticsStreamConfiguration = { measurementId: string; apiSecret: string };
export type AnalyticsConfiguration = { webId: string | null; web: AnalyticsStreamConfiguration | null; windows: AnalyticsStreamConfiguration | null; hashSecret: string | null; debug: boolean };
export type AnalyticsOutboxEvent = { id: string; stream: AnalyticsStream; clientId: string; sessionId: number; eventTimestampMs: number; name: string; params: Record<string, unknown> };
const measurement = /^G-[A-Z0-9]{6,20}$/;
const secret = /^[A-Za-z0-9_-]{8,128}$/;

export function analyticsConfiguration(env: Record<string, string | undefined>): AnalyticsConfiguration {
  const enabled = env.GA4_ENABLED === 'true';
  const hashSecret = enabled && env.GA4_ANALYTICS_HASH_SECRET && env.GA4_ANALYTICS_HASH_SECRET.length >= 32 && env.GA4_ANALYTICS_HASH_SECRET.length <= 256 ? env.GA4_ANALYTICS_HASH_SECRET : null;
  const stream = (prefix: 'WEB' | 'WINDOWS'): AnalyticsStreamConfiguration | null => {
    const measurementId = env[`GA4_${prefix}_MEASUREMENT_ID`], apiSecret = env[`GA4_${prefix}_API_SECRET`];
    return enabled && hashSecret && measurementId && measurement.test(measurementId) && apiSecret && secret.test(apiSecret) ? { measurementId, apiSecret } : null;
  };
  const webId = enabled && env.GA4_WEB_MEASUREMENT_ID && measurement.test(env.GA4_WEB_MEASUREMENT_ID) ? env.GA4_WEB_MEASUREMENT_ID : null;
  return { webId, web: stream('WEB'), windows: stream('WINDOWS'), hashSecret, debug: env.GA4_DEBUG_MODE === 'true' };
}

export function analyticsPublicConfiguration(configuration: AnalyticsConfiguration) {
  return { schema: 1, consentVersion: 1, web: { enabled: Boolean(configuration.webId), measurementId: configuration.webId }, windows: { enabled: Boolean(configuration.windows), measurementId: configuration.windows?.measurementId ?? null } };
}

function googleWireClientId(clientId: string): string | null {
  if (/^\d{1,20}\.\d{1,20}$/.test(clientId)) return clientId;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(clientId)) return null;
  const anonymous = createHash('sha256').update(clientId).digest();
  return `${anonymous.readUInt32BE(0)}.${anonymous.readUInt32BE(4)}`;
}

export async function deliverAnalyticsEvent(configuration: AnalyticsConfiguration, event: AnalyticsOutboxEvent, fetcher: typeof fetch = fetch): Promise<{ delivered: boolean; retryable: boolean }> {
  const stream = configuration[event.stream];
  const clientId = googleWireClientId(event.clientId);
  if (!stream || !clientId) return { delivered: false, retryable: false };
  const target = new URL('https://region1.google-analytics.com/mp/collect');
  target.searchParams.set('measurement_id', stream.measurementId);
  target.searchParams.set('api_secret', stream.apiSecret);
  try {
    const response = await fetcher(target.toString(), {
      method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, timestamp_micros: event.eventTimestampMs * 1000, non_personalized_ads: true,
        consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
        events: [{ name: event.name, params: { ...event.params, session_id: event.sessionId, engagement_time_msec: event.params.engagement_time_msec ?? 1, ...(configuration.debug ? { debug_mode: 1 } : {}) } }] })
    });
    await response.body?.cancel();
    return { delivered: response.ok, retryable: response.status === 429 || response.status >= 500 };
  } catch { return { delivered: false, retryable: true }; }
}
