import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from './db.js';
import { derivePersonalProviderSession } from './personal-provider-session.js';
const decimal = z.string().regex(/^[1-9][0-9]{0,14}$/);
const reference = z.object({ source: z.literal('personal'), sourceVersion: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), kind: z.enum(['movie', 'series', 'live', 'episode']), id: decimal, seriesId: decimal.optional(), extension: z.enum(['mp4', 'mkv', 'avi', 'm3u8', 'ts']).optional() }).strict().superRefine((r, c) => { if ((r.kind === 'episode') !== (r.seriesId !== undefined))
    c.addIssue({ code: 'custom', message: 'Invalid parent' }); });
const bodySchema = z.object({ ref: reference }).strict();
let schema: Promise<unknown> | undefined;
function ensureSchema() {
    if (!schema)
        schema = query(`CREATE TABLE IF NOT EXISTS personal_library_refs (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 source_version text NOT NULL, list_type text NOT NULL CHECK (list_type IN ('favorites','watched')),
 kind text NOT NULL CHECK (kind IN ('movie','series','live','episode')), provider_id text NOT NULL,
 parent_series_id text NOT NULL DEFAULT '',
 PRIMARY KEY(user_id, source_version, list_type, kind, provider_id, parent_series_id)
 )`).catch(e => { schema = undefined; throw e; });
    return schema;
}
type Dependencies = {
    authenticate: (authorization?: string) => Promise<{
        userId: string;
    }>;
    context: (id: string) => Promise<any>;
    secret: string;
    demo: boolean;
    classify: (error: unknown) => {
        statusCode: number;
        statusClass: string;
        message: string;
    };
};
/** Stores opaque identities only; membership remains the browser provider adapter's responsibility. */
export function registerPersonalLibrary(app: FastifyInstance, deps: Dependencies) {
    for (const route of [{ method: 'GET', url: '/me/personal-library', list: null }, { method: 'PUT', url: '/me/personal-library/favorites', list: 'favorites' }, { method: 'DELETE', url: '/me/personal-library/favorites', list: 'favorites' }, { method: 'PUT', url: '/me/personal-library/watched', list: 'watched' }] as const) {
        app.route({ method: route.method, url: route.url, handler: async (request, reply) => {
                reply.header('cache-control', 'private, no-store, max-age=0').header('pragma', 'no-cache').header('vary', 'Authorization, Origin');
                try {
                    const auth = await deps.authenticate(request.headers.authorization);
                    if (deps.demo)
                        return reply.status(403).send({ message: 'Kisisel kitaplik kullanilamiyor.' });
                    const context = await deps.context(auth.userId);
                    const session = derivePersonalProviderSession(auth.userId, context, deps.secret);
                    // Historical deletion still requires a valid, authenticated account context.
                    if (context.summary.id !== auth.userId || (route.method !== 'DELETE' && !session))
                        return reply.status(403).send({ message: 'Kisisel kitaplik kullanilamiyor.' });
                    if (route.method === 'GET') {
                        await ensureSchema();
                        const result = await query(`SELECT source_version, list_type, kind, provider_id, parent_series_id FROM (
 (SELECT source_version, list_type, kind, provider_id, parent_series_id FROM personal_library_refs WHERE user_id=$1 AND list_type='favorites' ORDER BY source_version,kind,provider_id,parent_series_id LIMIT 500)
 UNION ALL
 (SELECT source_version, list_type, kind, provider_id, parent_series_id FROM personal_library_refs WHERE user_id=$1 AND list_type='watched' ORDER BY source_version,kind,provider_id,parent_series_id LIMIT 20000)) refs`, [auth.userId]);
                        const output: {
                            favorites: any[];
                            watched: any[];
                        } = { favorites: [], watched: [] };
                        for (const row of result.rows) {
                            const ref = { source: 'personal', sourceVersion: row.source_version, kind: row.kind, id: row.provider_id, ...(row.parent_series_id ? { seriesId: row.parent_series_id } : {}) };
                            output[row.list_type as 'favorites' | 'watched'].push(ref);
                        }
                        return output;
                    }
                    const parsed = bodySchema.safeParse(request.body);
                    if (!parsed.success || (route.list === 'favorites' ? parsed.data.ref.kind === 'episode' : parsed.data.ref.kind !== 'episode'))
                        return reply.status(400).send({ message: 'Gecersiz kitaplik kaydi.' });
                    const ref = parsed.data.ref;
                    if (route.method === 'PUT' && ref.sourceVersion !== session!.sourceVersion)
                        return reply.status(403).send({ message: 'Kisisel kitaplik kullanilamiyor.' });
                    await ensureSchema();
                    const values = [auth.userId, ref.sourceVersion, route.list, ref.kind, ref.id, ref.seriesId ?? ''];
                    const identity = 'user_id=$1 AND source_version=$2 AND list_type=$3 AND kind=$4 AND provider_id=$5 AND parent_series_id=$6';
                    if (route.method === 'DELETE') {
                        await query(`DELETE FROM personal_library_refs WHERE ${identity}`, values);
                        return { ok: true };
                    }
                    const accepted = await withTransaction(async (client) => {
                        // Account row locking serializes all inserts across processes and source versions.
                        await client.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE', [auth.userId]);
                        const existing = await client.query(`SELECT 1 FROM personal_library_refs WHERE ${identity}`, values);
                        if (existing.rows.length)
                            return true;
                        const count = await client.query('SELECT count(*) AS count FROM personal_library_refs WHERE user_id=$1 AND list_type=$2', [auth.userId, route.list]);
                        if (Number(count.rows[0].count) >= (route.list === 'favorites' ? 500 : 20000))
                            return false;
                        await client.query('INSERT INTO personal_library_refs (user_id,source_version,list_type,kind,provider_id,parent_series_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', values);
                        return true;
                    });
                    return accepted ? { ok: true } : reply.status(409).send({ message: 'Kitaplik sinirina ulasildi.' });
                }
                catch (error) {
                    const classified = deps.classify(error);
                    request.log.warn({ statusClass: classified.statusClass }, 'Personal library unavailable');
                    return reply.status(classified.statusCode).send({ message: classified.message });
                }
            } });
    }
}
