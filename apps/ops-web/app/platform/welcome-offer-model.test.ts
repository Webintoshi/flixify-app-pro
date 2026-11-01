import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWelcomeOffer, welcomeEndpointMissing, welcomeMonthlyOffer, welcomeUsers } from './welcome-offer-model';
import { apiRequest } from '../../lib/api';

const quote = () => ({ campaign: 'welcome-monthly-50-v1', state: 'dismissed', eligible: true, catalogue: { movies: 11955, live: 12677, series: 1675 }, offers: [
  { id: 'welcome-monthly-50-v1', packageSlug: '1-ay', users: 1, durationMonths: 1, amountMinor: 12500, regularAmountMinor: 25000, currency: 'try' },
  { id: 'welcome-monthly-50-v1', packageSlug: '1-ay-2-kullanici', users: 2, durationMonths: 1, amountMinor: 19950, regularAmountMinor: 39900, currency: 'try' }
] });
afterEach(() => vi.unstubAllGlobals());
describe('authoritative welcome quote', () => {
  it('retains both exact monthly prices after dismissal and never fabricates missing eligibility', () => {
    const status = parseWelcomeOffer(quote()); expect(welcomeMonthlyOffer(status, 1)?.amountMinor).toBe(12500); expect(welcomeMonthlyOffer(status, 2)?.amountMinor).toBe(19950);
    expect(welcomeMonthlyOffer({ ...status, eligible: false }, 2)).toBeNull(); expect(welcomeMonthlyOffer({ ...status, state: 'redeemed' }, 1)).toBeNull();
  });
  it('rejects malformed prices, duplicate users, counts and non-string states', () => {
    const malformed = quote(); malformed.offers[1].amountMinor = 19900; expect(() => parseWelcomeOffer(malformed)).toThrow();
    const duplicate = quote(); duplicate.offers[1] = { ...duplicate.offers[0] }; expect(() => parseWelcomeOffer(duplicate)).toThrow();
    expect(() => parseWelcomeOffer({ ...quote(), catalogue: { movies: NaN, live: 1, series: 2 } })).toThrow();
    expect(() => parseWelcomeOffer({ ...quote(), state: { toString: () => 'pending' } })).toThrow();
  });
  it('only accepts explicit native user modes without turning query values into checkout commands', () => {
    expect(welcomeUsers('?welcome=1&users=2')).toBe(2); expect(welcomeUsers('?users=1')).toBe(1); expect(welcomeUsers('?users=200&checkout=1')).toBe(1);
  });
  it('preserves actual HTTP status and existing message text for safe old-API fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Route not found' }), { status: 404 })));
    const missing = await apiRequest('/me/welcome-offer').catch(error => error);
    expect(missing).toMatchObject({ status: 404, message: 'Route not found' }); expect(welcomeEndpointMissing(missing)).toBe(true);
    expect(welcomeEndpointMissing(new Error('404 not found'))).toBe(false);
    expect(welcomeEndpointMissing(Object.assign(new Error('Route not found'), { status: 503 }))).toBe(false);
  });
});
