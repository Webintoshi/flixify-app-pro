export type ProviderErrorCode = 'PROVIDER_UNAVAILABLE' | 'PROVIDER_INVALID' | 'PROVIDER_IDENTITY' | 'PROVIDER_AMBIGUOUS' | 'SYNC_CONFLICT';
export class ProviderEntitlementError extends Error {
    constructor(public readonly code: ProviderErrorCode) { super(code); this.name = 'ProviderEntitlementError'; }
}
export type ProviderEntitlement = {
    lineId: string;
    username: string;
    password: string;
    packageId: string;
    isTrial: boolean;
    enabled: boolean;
    adminEnabled: boolean;
    expiresAt: string;
};
export type ProviderLookup = {
    username: string;
    password: string;
    providerLineId?: string | null;
};
const invalid = () => new ProviderEntitlementError('PROVIDER_INVALID');
function identifier(value: unknown): string { const s = String(value ?? ''); if (!/^\d{1,20}$/.test(s))
    throw invalid(); return s; }
function flag(value: unknown): boolean { if (value !== '0' && value !== '1' && value !== 0 && value !== 1)
    throw invalid(); return String(value) === '1'; }
export function createProviderEntitlementClient(options: {
    url: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    async function request(action: 'get_lines' | 'get_line', params: Record<string, string>): Promise<unknown> {
        try {
            const response = await fetchImpl(options.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ api_key: options.apiKey, action, ...params }), signal: AbortSignal.timeout(20000) });
            if (!response.ok)
                throw new ProviderEntitlementError('PROVIDER_UNAVAILABLE');
            // Stream bounds also cover chunked responses without Content-Length.
            const reader = response.body?.getReader();
            if (!reader)
                throw invalid();
            let size = 0;
            const chunks: Uint8Array[] = [];
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.byteLength;
                if (size > 262144) {
                    await reader.cancel();
                    throw invalid();
                }
                chunks.push(part.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            const envelope = JSON.parse(new TextDecoder().decode(bytes));
            if (!envelope || envelope.status !== 'STATUS_SUCCESS')
                throw invalid();
            return envelope.data;
        }
        catch (error) {
            if (error instanceof ProviderEntitlementError)
                throw error;
            throw new ProviderEntitlementError('PROVIDER_UNAVAILABLE');
        }
    }
    return { async lookup(input: ProviderLookup): Promise<ProviderEntitlement> {
            let id = input.providerLineId ? identifier(input.providerLineId) : null;
            if (!id) {
                const list = await request('get_lines', { line_username: input.username, start: '0', limit: '20' });
                if (!Array.isArray(list))
                    throw invalid();
                const matches = list.filter(x => x && typeof x === 'object' && x.username === input.username);
                if (list.length >= 20 || matches.length !== 1)
                    throw new ProviderEntitlementError('PROVIDER_AMBIGUOUS');
                id = identifier(matches[0].id);
            }
            const value = await request('get_line', { id });
            if (!value || typeof value !== 'object')
                throw invalid();
            const line = value as Record<string, unknown>;
            if (identifier(line.id) !== id || line.username !== input.username || line.password !== input.password)
                throw new ProviderEntitlementError('PROVIDER_IDENTITY');
            if (!/^[0-9]{1,12}$/.test(String(line.exp_date ?? '')))
                throw invalid();
            const seconds = Number(line.exp_date);
            if (!Number.isSafeInteger(seconds) || seconds > 253402300799)
                throw invalid();
            return { lineId: id, username: input.username, password: input.password, packageId: identifier(line.package_id), isTrial: flag(line.is_trial), enabled: flag(line.enabled), adminEnabled: flag(line.admin_enabled), expiresAt: new Date(seconds * 1000).toISOString() };
        } };
}
