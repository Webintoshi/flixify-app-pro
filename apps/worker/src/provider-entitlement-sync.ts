import { ProviderEntitlementError, type ProviderEntitlement, type ProviderLookup, type ProviderErrorCode } from './provider-entitlement.js';
export type EntitlementJob = ProviderLookup & {
    id: string;
    userId: string;
    credentialId: string;
    credentialVersion: string;
    leaseToken: string;
};
export interface EntitlementStore {
    discover(): Promise<void>;
    claim(): Promise<EntitlementJob[]>;
    apply(job: EntitlementJob, line: ProviderEntitlement): Promise<void>;
    fail(job: EntitlementJob, code: ProviderErrorCode): Promise<void>;
}
export async function runProviderEntitlementSyncBatch(store: EntitlementStore, provider: {
    lookup(input: ProviderLookup): Promise<ProviderEntitlement>;
}) {
    await store.discover();
    const queue = (await store.claim()).slice(0, 5);
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length) {
            const job = queue.shift()!;
            try {
                await store.apply(job, await provider.lookup(job));
            }
            catch (error) {
                try {
                    await store.fail(job, error instanceof ProviderEntitlementError ? error.code : 'SYNC_CONFLICT');
                }
                catch { /* A lost lease or database outage must not block other claims. */ }
            }
        }
    }));
}
