import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
    Object.assign(process.env, { DATABASE_URL: 'postgresql://localhost/test', APP_JWT_SECRET: 'test-only-secret-with-at-least-thirty-two-characters', ADMIN_EMAILS: 'admin@example.test', SUPABASE_URL: 'http://localhost', SUPABASE_JWKS_URL: 'http://localhost/jwks', APP_DEMO_MODE: 'false' });
});
vi.mock('./db.js', () => ({ query: vi.fn(), withTransaction: vi.fn(), pool: { end: vi.fn() } }));
import * as db from './db.js';
import * as repo from './repository.js';
import { signAccessToken } from './security.js';
import { buildServer } from './server.js';
import { derivePersonalProviderSession } from './personal-provider-session.js';
const app = buildServer();
let token: string, context: any, ref: any;
const sql = vi.fn();
let rows: any[] = [], count = 0;
beforeAll(async () => { await app.ready(); token = `Bearer ${await signAccessToken({ userId: 'user-a', sessionId: 'session-a' })}`; });
afterAll(async () => { await app.close(); });
beforeEach(() => {
    const deadline = new Date(Date.now() + 600000).toISOString();
    context = { summary: { id: 'user-a' }, canPlay: true, accessUntil: deadline, isThreeHourTrial: false, playbackBaseUrl: 'https://provider.example/', iptvCredentials: { username: 'personal', password: 'secret' }, sharedReferenceCredentials: null };
    ref = { source: 'personal', sourceVersion: derivePersonalProviderSession('user-a', context, process.env.APP_JWT_SECRET!)!.sourceVersion, kind: 'movie', id: '12' };
    vi.spyOn(repo, 'getUserStatus').mockResolvedValue('active');
    vi.spyOn(repo, 'getSessionById').mockResolvedValue({ id: 'session-a', user_id: 'user-a', revoked_at: null } as never);
    vi.spyOn(repo, 'touchDeviceSession').mockResolvedValue(undefined);
    vi.spyOn(repo, 'getUserContext').mockImplementation(async () => context);
    rows = [];
    count = 0;
    sql.mockReset();
    sql.mockImplementation(async (text: string) => ({ rows: text.includes('count(*)') ? [{ count }] : text.includes('SELECT source_version') ? rows : [], rowCount: 0 }));
    vi.mocked(db.query).mockImplementation(sql);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn({ query: sql } as never));
    vi.stubGlobal('fetch', vi.fn(() => { throw Error('forbidden'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const call = (method: any = 'GET', body?: any, auth = token) => app.inject({ method, url: '/me/personal-library' + (method === 'GET' ? '' : '/favorites'), headers: auth ? { authorization: auth } : {}, ...(body ? { payload: body } : {}) });
it('requires authentication and returns private responses', async () => { const r = await call('GET', undefined, ''); expect(r.statusCode).toBe(401); expect(r.headers['cache-control']).toContain('private, no-store'); expect(repo.getUserContext).not.toHaveBeenCalled(); });
it('retries failed schema initialization on a subsequent request', async () => { sql.mockRejectedValueOnce(Error('database secret')); expect((await call()).statusCode).toBe(500); expect((await call()).statusCode).toBe(200); });
it('returns historical own refs and bounded parameterized reads', async () => { rows = [{ source_version: 'old', kind: 'movie', provider_id: '12', parent_series_id: '', list_type: 'favorites' }]; const r = await call(); expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ favorites: [{ source: 'personal', sourceVersion: 'old', kind: 'movie', id: '12' }], watched: [] }); expect(sql.mock.calls.some(([s, p]) => s.includes('SELECT source_version') && p[0] === 'user-a')).toBe(true); expect(fetch).not.toHaveBeenCalled(); });
it.each(['expired', 'trial', 'identity'])('rejects %s access', async (mode) => { if (mode === 'expired')
    context.accessUntil = '2020-01-01'; if (mode === 'trial')
    context.isThreeHourTrial = true; if (mode === 'identity')
    context.summary.id = 'user-b'; expect((await call()).statusCode).toBe(403); });
it.each([{ url: 'https://bad' }, { userId: 'user-b' }, { id: '0' }, { id: '1e3' }, { seriesId: '2' }, { kind: 'episode' }, { extension: 'exe' }])('rejects malformed ref %j', async (extra) => { expect((await call('PUT', { ref: { ...ref, ...extra } })).statusCode).toBe(400); });
it('rejects body account spoofing and stale writes', async () => { expect((await call('PUT', { ref, userId: 'user-b' })).statusCode).toBe(400); expect((await call('PUT', { ref: { ...ref, sourceVersion: 'old' } })).statusCode).toBe(403); });
it('stores only identity and locks account before cap check', async () => { const r = await call('PUT', { ref: { ...ref, extension: 'mp4' } }); expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true }); const insert = sql.mock.calls.find(([s]) => s.includes('INSERT INTO personal_library_refs')); expect(insert?.[1]).toEqual(['user-a', ref.sourceVersion, 'favorites', 'movie', '12', '']); expect(sql.mock.calls.findIndex(([s]) => s.includes('FOR UPDATE'))).toBeLessThan(sql.mock.calls.findIndex(([s]) => s.includes('count(*)'))); });
it('enforces cap but accepts existing duplicate', async () => { count = 500; expect((await call('PUT', { ref })).statusCode).toBe(409); sql.mockImplementation(async (s: string) => ({ rows: s.includes('count(*)') ? [{ count }] : s.includes('SELECT 1') ? [{ exists: 1 }] : [] })); expect((await call('PUT', { ref })).statusCode).toBe(200); });
it('deletes historical own ref after expired access', async () => { context.accessUntil = '2020-01-01'; expect((await call('DELETE', { ref: { ...ref, sourceVersion: 'old' } })).statusCode).toBe(200); expect(sql.mock.calls.find(([s]) => s.includes('DELETE FROM'))?.[1]?.[0]).toBe('user-a'); });
it('supports episode watched refs and rejects favorite kinds there', async () => { const request = (ref: any) => app.inject({ method: 'PUT', url: '/me/personal-library/watched', headers: { authorization: token }, payload: { ref } }); expect((await request(ref)).statusCode).toBe(400); expect((await request({ ...ref, kind: 'episode', seriesId: '3' })).statusCode).toBe(200); count = 20000; expect((await request({ ...ref, kind: 'episode', seriesId: '3' })).statusCode).toBe(409); });
it('classifies errors without exposing secrets', async () => { vi.mocked(repo.getUserContext).mockRejectedValue(Error('secret password')); const r = await call(); expect(r.statusCode).toBe(500); expect(r.body).not.toContain('secret'); });
it.each(['blocked', 'wrong-owner'])('rejects %s authenticated context before storage', async (mode) => { if (mode === 'blocked')
    vi.mocked(repo.getUserStatus).mockResolvedValue('blocked');
else
    vi.mocked(repo.getSessionById).mockResolvedValue({ user_id: 'user-b', revoked_at: null } as never); expect((await call()).statusCode).toBe(mode === 'blocked' ? 403 : 401); expect(sql).not.toHaveBeenCalled(); });
it('deletion cannot use a mismatched account context', async () => { context.summary.id = 'user-b'; expect((await call('DELETE', { ref })).statusCode).toBe(403); expect(sql).not.toHaveBeenCalled(); });
it('trial verified deadline permits writes but expiry rejects them', async () => { context.isThreeHourTrial = true; context.trialProviderExpiresAt = new Date(Date.now() + 10000).toISOString(); expect((await call('PUT', { ref })).statusCode).toBe(200); context.trialProviderExpiresAt = '2020-01-01'; expect((await call('PUT', { ref })).statusCode).toBe(403); });
