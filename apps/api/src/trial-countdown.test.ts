import { describe, expect, it } from 'vitest';
import { deriveTrialCountdown, withTrialCountdown } from './trial-countdown.js';

const now = Date.parse('2026-11-07T12:00:00Z');
const trial = () => ({
  isThreeHourTrial: true, accessUntil: '2026-11-07T15:00:00Z', trialProviderExpiresAt: '2026-11-07T15:00:00Z',
  summary: { status: 'active', hasAssignedLink: true, hasActiveSubscription: true, trialProvisionStatus: null,
    activePackage: { title: '3 Saat Deneme', endsAt: '2026-11-07T15:00:00Z' } }
});

describe('trial countdown presentation contract', () => {
  it('reports the existing verified deadline and current server time without granting or extending access', () => {
    const context = trial();
    expect(deriveTrialCountdown(context, now)).toEqual({ status: 'active', serverNow: '2026-11-07T12:00:00.000Z', endsAt: '2026-11-07T15:00:00.000Z' });
    expect(deriveTrialCountdown(context, now + 3600000)).toEqual({ status: 'active', serverNow: '2026-11-07T13:00:00.000Z', endsAt: '2026-11-07T15:00:00.000Z' });
    expect(context.accessUntil).toBe('2026-11-07T15:00:00Z');
  });
  it('uses an earlier verified provider cutoff', () => {
    expect(deriveTrialCountdown({ ...trial(), trialProviderExpiresAt: '2026-11-07T14:00:00Z' }, now).endsAt).toBe('2026-11-07T14:00:00.000Z');
  });
  it.each([null, 'invalid', '2026-11-07T15:00:01Z'])('does not fabricate a countdown for unavailable or inconsistent provider expiry: %s', value => {
    expect(deriveTrialCountdown({ ...trial(), trialProviderExpiresAt: value }, now)).toEqual({ status: 'unavailable', serverNow: '2026-11-07T12:00:00.000Z', endsAt: null });
  });
  it('ends at the exact cutoff instead of starting another three hours', () => {
    expect(deriveTrialCountdown(trial(), now + 10800000)).toEqual({ status: 'expired', serverNow: '2026-11-07T15:00:00.000Z', endsAt: '2026-11-07T15:00:00.000Z' });
  });
  it('hides the counter for paid and blocked accounts, even after a past trial', () => {
    const paid = { ...trial(), isThreeHourTrial: false, summary: { ...trial().summary, activePackage: { title: '1 Ay · Tek Kullanıcı', endsAt: '2026-12-07T15:00:00Z' } } };
    expect(deriveTrialCountdown(paid, now).status).toBe('none');
    expect(deriveTrialCountdown({ ...trial(), summary: { ...trial().summary, status: 'blocked' } }, now).status).toBe('none');
  });
  it('does not start counting while provisioning is pending or being reviewed', () => {
    expect(deriveTrialCountdown({ ...trial(), summary: { ...trial().summary, trialProvisionStatus: 'pending' } }, now)).toMatchObject({ status: 'pending', endsAt: null });
    expect(deriveTrialCountdown({ ...trial(), summary: { ...trial().summary, trialProvisionStatus: 'review' } }, now)).toMatchObject({ status: 'unavailable', endsAt: null });
  });
  it.each(['pending', 'review'])('keeps a paid account out of the trial flow despite a stale job in %s', trialProvisionStatus => {
    const paid = { ...trial(), isThreeHourTrial: false, summary: { ...trial().summary, trialProvisionStatus, activePackage: { title: '1 Ay · Tek Kullanıcı', endsAt: '2026-12-07T15:00:00Z' } } };
    expect(deriveTrialCountdown(paid, now)).toEqual({ status: 'none', serverNow: '2026-11-07T12:00:00.000Z', endsAt: null });
  });
  it('keeps a legacy 24-hour entitlement at its real deadline', () => {
    const legacy = { ...trial(), isThreeHourTrial: false, trialProviderExpiresAt: null, accessUntil: '2026-11-08T12:00:00Z', summary: { ...trial().summary, activePackage: { title: '24 Saat Test', endsAt: '2026-11-08T12:00:00Z' } } };
    expect(deriveTrialCountdown(legacy, now)).toEqual({ status: 'active', serverNow: '2026-11-07T12:00:00.000Z', endsAt: '2026-11-08T12:00:00.000Z' });
  });
  it('adds presentation data without mutating the existing me user or contact contract', () => {
    const payload = { user: trial().summary, contact: { whatsapp: 'https://wa.me/905551234567', telegram: '' } };
    const result = withTrialCountdown(payload, trial(), now);
    expect(result.user).toBe(payload.user); expect(result.contact).toBe(payload.contact);
    expect(Object.keys(result).sort()).toEqual(['contact', 'trialCountdown', 'user']);
    expect('trialCountdown' in payload).toBe(false);
  });
});
