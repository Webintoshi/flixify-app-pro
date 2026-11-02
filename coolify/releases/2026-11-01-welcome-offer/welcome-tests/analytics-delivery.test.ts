import { expect, it, vi } from 'vitest';
import { analyticsConfiguration, deliverAnalyticsEvent, analyticsPublicConfiguration, type AnalyticsOutboxEvent } from '../api-source/analytics-delivery.js';

const configured = () => analyticsConfiguration({ GA4_ENABLED: 'true', GA4_WEB_MEASUREMENT_ID: 'G-WEB1234567', GA4_WEB_API_SECRET: 'fixture-web-secret', GA4_WINDOWS_MEASUREMENT_ID: 'G-WIN1234567', GA4_WINDOWS_API_SECRET: 'fixture-windows-secret', GA4_ANALYTICS_HASH_SECRET: 'a'.repeat(40) });
const event: AnalyticsOutboxEvent = { id: 'event-opaque', stream: 'windows', clientId: '34b7745b-573e-4e68-9790-b23415c418a4', sessionId: 123456, eventTimestampMs: 1_793_610_000_000, name: 'video_start', params: { client_platform: 'windows', content_type: 'live', startup_ms: 2400 } };

it('fails closed without explicit complete configuration and never exposes private values', () => {
  expect(analyticsPublicConfiguration(analyticsConfiguration({}))).toEqual({ schema: 1, consentVersion: 1, web: { enabled: false, measurementId: null }, windows: { enabled: false, measurementId: null } });
  const publicValue = analyticsPublicConfiguration(configured());
  expect(publicValue.web).toEqual({ enabled: true, measurementId: 'G-WEB1234567' });
  expect(publicValue.windows).toEqual({ enabled: true, measurementId: 'G-WIN1234567' });
  expect(JSON.stringify(publicValue)).not.toMatch(/secret|aaaa/);
  expect(analyticsPublicConfiguration(analyticsConfiguration({ GA4_ENABLED: 'true', GA4_WINDOWS_MEASUREMENT_ID: 'G-WIN1234567' })).windows.enabled).toBe(false);
});

it('sends a bounded MP payload to the fixed collector with ads consent denied and no account identity', async () => {
  const requests: Array<{url:string;body:any;signal:AbortSignal}> = [];
  const fetcher = vi.fn(async (url, init) => { requests.push({ url: String(url), body: JSON.parse(String(init!.body)), signal: init!.signal as AbortSignal }); return new Response(null, { status: 204 }); });
  expect(await deliverAnalyticsEvent(configured(), event, fetcher)).toEqual({ delivered: true, retryable: false });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('https://region1.google-analytics.com/mp/collect?measurement_id=G-WIN1234567&api_secret=fixture-windows-secret');
  expect(requests[0].signal).toBeInstanceOf(AbortSignal);
  expect(requests[0].body).toEqual({ client_id: event.clientId, timestamp_micros: event.eventTimestampMs * 1000, non_personalized_ads: true, consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' }, events: [{ name: 'video_start', params: { ...event.params, session_id: 123456, engagement_time_msec: 1 } }] });
  expect(JSON.stringify(requests[0].body)).not.toMatch(/user_id|authorization|password|stream_url|customer/);
});

it('does not call Google when the stream is absent and classifies retryable transport errors', async () => {
  const send = vi.fn(async () => new Response(null, { status: 204 }));
  expect(await deliverAnalyticsEvent(analyticsConfiguration({}), event, send)).toEqual({ delivered: false, retryable: false });
  expect(send).not.toHaveBeenCalled();
  expect(await deliverAnalyticsEvent(configured(), event, async () => { throw Error('network-private-value'); })).toEqual({ delivered: false, retryable: true });
  expect(await deliverAnalyticsEvent(configured(), event, async () => new Response(null, { status: 429 }))).toEqual({ delivered: false, retryable: true });
  expect(await deliverAnalyticsEvent(configured(), event, async () => new Response(null, { status: 400 }))).toEqual({ delivered: false, retryable: false });
});
