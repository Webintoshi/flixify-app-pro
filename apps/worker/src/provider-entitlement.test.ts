import { describe, it, expect } from 'vitest';
import { createProviderEntitlementClient, ProviderEntitlementError } from './provider-entitlement.js';
const line = { id: '12', username: 'alice', password: 'secret', exp_date: '1800000000', package_id: '8', is_trial: '0', enabled: '1', admin_enabled: '1' };
function client(data: unknown[]) { let n = 0; return createProviderEntitlementClient({ url: 'https://example.invalid', apiKey: 'key', fetchImpl: (async () => new Response(JSON.stringify({ status: 'STATUS_SUCCESS', data: data[n++] }))) as typeof fetch }); }
describe('provider entitlement reader', () => {
    it('verifies paid line and exact UTC expiry', async () => { expect(await client([[line], line]).lookup({ username: 'alice', password: 'secret' })).toMatchObject({ lineId: '12', packageId: '8', expiresAt: '2027-01-15T08:00:00.000Z', isTrial: false }); });
    it.each([[{ ...line, password: 'wrong' }], [{ ...line, enabled: 'yes' }], [{ ...line, exp_date: null }]])('rejects mismatched or malformed detail', async (detail) => { await expect(client([[detail], detail]).lookup({ username: 'alice', password: 'secret' })).rejects.toBeInstanceOf(ProviderEntitlementError); });
    it('rejects duplicate and saturated search results', async () => { for (const data of [[line, line], Array(20).fill(line)])
        await expect(client([data]).lookup({ username: 'alice', password: 'secret' })).rejects.toBeInstanceOf(ProviderEntitlementError); });
    it('does not search again for pinned identity', async () => { expect((await client([line]).lookup({ username: 'alice', password: 'secret', providerLineId: '12' })).lineId).toBe('12'); });
    it('uses fixed errors on network failure', async () => { const c = createProviderEntitlementClient({ url: 'https://example.invalid', apiKey: 'key', fetchImpl: (async () => { throw Error('secret'); }) as typeof fetch }); await expect(c.lookup({ username: 'alice', password: 'secret' })).rejects.toThrow('PROVIDER_UNAVAILABLE'); });
});
