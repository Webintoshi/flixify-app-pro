import { it, expect } from 'vitest';
import { runProviderEntitlementSyncBatch, type EntitlementJob } from './provider-entitlement-sync.js';
import { ProviderEntitlementError } from './provider-entitlement.js';
it('limits batch to five and concurrency to two, isolates lookup and failure-write errors', async () => {
    const jobs = Array.from({ length: 8 }, (_, i) => ({ id: String(i), username: String(i) }) as EntitlementJob);
    let active = 0, max = 0, lookups = 0;
    const applied: string[] = [];
    const failed: string[] = [];
    await runProviderEntitlementSyncBatch({ discover: async () => { }, claim: async () => jobs, apply: async (j) => { applied.push(j.id); }, fail: async (j, code) => { failed.push(code); if (j.id === '0')
            throw Error('db'); } }, { lookup: async (j) => {
            active++;
            max = Math.max(max, active);
            lookups++;
            await new Promise(r => setTimeout(r, 2));
            active--;
            if (j.username === '0')
                throw new ProviderEntitlementError('PROVIDER_UNAVAILABLE');
            return {} as never;
        } });
    expect(lookups).toBe(5);
    expect(max).toBe(2);
    expect(applied).toHaveLength(4);
    expect(failed).toEqual(['PROVIDER_UNAVAILABLE']);
});
