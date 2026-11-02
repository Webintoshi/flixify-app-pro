import { describe, expect, it } from 'vitest';
import { validateAnalyticsAttribution, validateWindowsAnalyticsBatch } from '../api-source/analytics-policy.js';

const now = 1_793_610_000_000;
const clientId = '34b7745b-573e-4e68-9790-b23415c418a4';
const eventId = '7f80e0ee-a7ab-4666-9e86-87e8fcdebd40';
const body = () => ({ schema: 1, consentVersion: 1, clientPlatform: 'windows', clientId, sessionId: 1_793_610_000,
  events: [{ id: eventId, name: 'video_start', eventTimestampMs: now, params: { content_type: 'live', content_id: '9d02e5b6780ce1f4', startup_ms: 1450, app_version: '1.0.2' } }] });

describe('analytics privacy boundary', () => {
  it('accepts an explicit consented native event with bounded safe parameters', () => {
    expect(validateWindowsAnalyticsBatch(body(), now)).toEqual(body());
  });

  it.each(['purchase', 'package_activated', 'session_start', 'first_visit', 'screen_view'])('rejects client-forged reserved or revenue event %s', name => {
    const value = body(); value.events[0].name = name;
    expect(validateWindowsAnalyticsBatch(value, now)).toBeNull();
  });

  it.each(['account_code', 'accessToken', 'stream_url', 'error_message', 'email', 'search_term'])('rejects unknown or private parameter %s', key => {
    const value = body(); Object.assign(value.events[0].params, { [key]: 'private' });
    expect(validateWindowsAnalyticsBatch(value, now)).toBeNull();
  });

  it('rejects secret-like strings even under otherwise approved keys', () => {
    const value = body(); value.events[0].params.content_id = 'https://provider.invalid/live/user/password/1.ts';
    expect(validateWindowsAnalyticsBatch(value, now)).toBeNull();
    value.events[0].params.content_id = 'ABCDEFGHIJKLMNOP';
    expect(validateWindowsAnalyticsBatch(value, now)).toBeNull();
  });

  it('accepts readable verified catalogue labels and rejects embedded private or encoded strings', () => {
    const value=body(); Object.assign(value.events[0].params,{content_name:'TRT 1',category_name:'Ulusal Kanallar'});
    expect(validateWindowsAnalyticsBatch(value,now)).not.toBeNull();
    for(const label of ['https://fixture.invalid','https:fixture','ftp:fixture','file:/fixture','data:fixture','javascript:fixture','www.fixture.invalid','private@example.invalid','username=fixture','password:fixture','?token=fixture','token:fixture','secret=fixture','session_id=fixture','session:fixture','%41%42','ABCDEFGHIJKLMNOP','name\u200bhidden','line\nfeed','line\u2028feed','line\u2029feed','x'.repeat(101)]) {
      const unsafe=body(); Object.assign(unsafe.events[0].params,{content_name:label});
      expect(validateWindowsAnalyticsBatch(unsafe,now)).toBeNull();
    }
  });

  it('rejects excess events, oversized envelopes, extra top-level fields, invalid consent and stale times', () => {
    expect(validateWindowsAnalyticsBatch({ ...body(), events: Array(21).fill(body().events[0]) }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), raw: 'x'.repeat(40_000) }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), token: 'private' }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), consentVersion: 0 }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), events: [{ ...body().events[0], eventTimestampMs: now - 73 * 60 * 60_000 }] }, now)).toBeNull();
  });

  it('rejects invalid numerics, forged platforms and duplicate IDs within a batch', () => {
    expect(validateWindowsAnalyticsBatch({ ...body(), clientId: { toString: {} } }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), sessionId: NaN }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), clientPlatform: 'web' }, now)).toBeNull();
    expect(validateWindowsAnalyticsBatch({ ...body(), events: [body().events[0], body().events[0]] }, now)).toBeNull();
    const value = body(); value.events[0].params.startup_ms = -1;
    expect(validateWindowsAnalyticsBatch(value, now)).toBeNull();
  });

  it('discards invalid checkout attribution without changing checkout semantics', () => {
    expect(validateAnalyticsAttribution(undefined)).toBeNull();
    expect(validateAnalyticsAttribution({ consentVersion: 1, clientPlatform: 'web', clientId: '12345.67890', sessionId: 12345 })).toEqual({ consentVersion: 1, clientPlatform: 'web', clientId: '12345.67890', sessionId: 12345 });
    expect(validateAnalyticsAttribution({ consentVersion: 1, clientPlatform: 'pwa', clientId, sessionId: 12345 })).not.toBeNull();
    expect(validateAnalyticsAttribution({ consentVersion: 1, clientPlatform: 'web', clientId: 'fixture', sessionId: 12345 })).toBeNull();
    expect(validateAnalyticsAttribution({ consentVersion: 1, clientPlatform: 'web', clientId: '12345.67890', sessionId: 12345, accountCode: 'private' })).toBeNull();
  });
});
