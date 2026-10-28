import { isJunkVodCatalogTitle, isValidMovieCatalogEntry, isValidSeriesEpisodeCatalogEntry } from '@flixify/contracts';
import type { MediaItem, Episode, Kind } from './types';

export type PersonalProviderBootstrap = { accountId: string; sourceVersion: string; providerOrigin: string; username: string; password: string; expiresAt: string; moviePolicy: 'general-audience-only' };
export type PersonalRef = { source: 'personal'; sourceVersion: string; kind: Kind | 'episode'; id: string; extension?: string; seriesId?: string };
export type PersonalMediaItem = MediaItem & { personalRef: PersonalRef };
export type PersonalEpisode = Episode & { personalRef: PersonalRef };
export type PersonalProgramme = { title: string; description: string; start: number; end: number };
export type PersonalEpgResult = { status: 'ready' | 'empty'; programmes: PersonalProgramme[] } | { status: 'error'; programmes: []; error: string };
const MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'm3u8', 'ts']);
const ACTIONS = new Set(['get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series', 'get_live_categories', 'get_live_streams', 'get_series_info', 'get_short_epg']);
const fail = (): never => { throw new Error('Personal provider data unavailable'); };
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(); }
function list(value: unknown, max = 50000): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(); }
function text(value: unknown, max = 512): string { return typeof value === 'string' && value.length <= max ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function id(value: unknown): string | undefined { const s = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value; return typeof s === 'string' && /^[1-9]\d{0,14}$/.test(s) ? s : undefined; }
function ext(value: unknown): string | undefined { return typeof value === 'string' && EXTENSIONS.has(value.toLowerCase()) ? value.toLowerCase() : undefined; }
function art(value: unknown): string | null { const s = text(value, 2048); try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }
function label(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[İIı]/g, 'i').toLowerCase().replace(/^tr\s*[|:]\s*/, '').replace(/\s+/g, ' ').trim(); }
const SAFE_MOVIE_NAMES = new Set([
 'Vizyondaki Filmler','Yüksek Puanlı Filmler','Yerli Filmler','Yeşilçam Filmleri','Kemal Sunal Filmleri','Film Serileri / Box Setler','Aksiyon - Macera Filmleri','Macera','Komedi','Dram - Romantik','Romantik','Korku - Gerilim','Suç / Polisiye','Bilim Kurgu - Fantastik Filmler','Fantastik','Tarih / Savaş','Gerçek Hikâye / Biyografi','Vahşi Batı / Western','Müzikal','Belgesel','Aile','Animasyon / Çizgi Film','Anime',
 'Aksiyon (Yabancı)','Aksiyon (Yerli)','Amazon','Animasyon','Apple TV+','Bilim Kurgu','Disney+','Dram (Yabancı)','Dram (Yerli)','Filmler','Gerilim (Yabancı)','HBO Max','Komedi (Yabancı)','Komedi (Yerli)','Korku (Yabancı)','Korku (Yerli)','MUBI FILMLER','Müzik','Netflix','Savaş','Seri Filmler','Sinema','Suç','Tabii'
].map(label));
export function personalItemId(ref: PersonalRef): string { validatePersonalRef(ref); return `personal:${encodeURIComponent(ref.sourceVersion)}:${ref.kind}:${ref.seriesId ? ref.seriesId + ':' : ''}${ref.id}`; }
export function validatePersonalRef(value: unknown): PersonalRef {
 const r = record(value);
 if (r.source !== 'personal' || (!text(r.sourceVersion, 256) || text(r.sourceVersion, 256) !== r.sourceVersion) || !['live','movie','series','episode'].includes(String(r.kind)) || !id(r.id) || (r.extension !== undefined && !ext(r.extension)) || (r.kind === 'episode' ? !id(r.seriesId) : r.seriesId !== undefined)) fail();
 return {source:'personal',sourceVersion:r.sourceVersion as string,kind:r.kind as PersonalRef['kind'],id:r.id as string,...(r.extension ? {extension:ext(r.extension)} : {}),...(r.kind === 'episode' ? {seriesId:r.seriesId as string} : {})};
}
export function validatePersonalBootstrap(value: unknown, now = Date.now()): PersonalProviderBootstrap {
 const b = record(value);
 for (const key of ['accountId','sourceVersion','username','password']) if (typeof b[key] !== 'string' || !(b[key] as string).length || (b[key] as string).length > (key === 'password' ? 2048 : 256) || /[\u0000-\u001f\u007f]/.test(b[key] as string)) fail();
 let origin: URL; try { origin = new URL(String(b.providerOrigin)); } catch { return fail(); }
 if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== b.providerOrigin) fail();
 if (b.moviePolicy !== 'general-audience-only' || typeof b.expiresAt !== 'string' || b.expiresAt.length > 64 || !Number.isFinite(Date.parse(b.expiresAt)) || Date.parse(b.expiresAt) <= now) fail();
 return {accountId:b.accountId as string,sourceVersion:b.sourceVersion as string,providerOrigin:origin.origin,username:b.username as string,password:b.password as string,expiresAt:b.expiresAt as string,moviePolicy:'general-audience-only'};
}
export function buildPersonalMediaUrl(bootstrap: unknown, value: unknown, now = Date.now()): string {
 const b = validatePersonalBootstrap(bootstrap, now); const r = validatePersonalRef(value);
 if (r.sourceVersion !== b.sourceVersion || r.kind === 'series' || (r.kind !== 'live' && !r.extension)) fail();
 const path = r.kind === 'episode' ? 'series' : r.kind;
 return `${b.providerOrigin}/${path}/${encodeURIComponent(b.username)}/${encodeURIComponent(b.password)}/${r.id}.${r.extension ?? 'm3u8'}`;
}
export function normalizeCatalog(kind: Kind, raw: unknown, categories: unknown, sourceVersion: string): PersonalMediaItem[] {
 const groups = new Map<string,string>();
 for (const row of list(categories)) { try { const c = record(row); const key = id(c.category_id); const name = text(c.category_name,256); if (key && name) { if (groups.has(key) && groups.get(key) !== name) fail(); groups.set(key,name); } } catch { return fail(); } }
 const result: PersonalMediaItem[] = []; const seen = new Set<string>();
 for (const rawRow of list(raw)) {
  if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) continue;
  const r = record(rawRow); const providerId = id(kind === 'series' ? r.series_id : r.stream_id); const title = text(r.name); const groupTitle = groups.get(id(r.category_id) ?? '') ?? null;
  if (!providerId || !title || isJunkVodCatalogTitle(title) || seen.has(providerId)) continue;
  const extension = ext(r.container_extension) ?? (kind === 'live' ? 'm3u8' : undefined);
  if (kind === 'movie' && (!groupTitle || !SAFE_MOVIE_NAMES.has(label(groupTitle)) || !extension || !isValidMovieCatalogEntry({title,groupTitle,source:`/movie/${providerId}.${extension}`}))) continue;
  const personalRef: PersonalRef = {source:'personal',sourceVersion,kind,id:providerId,...(extension ? {extension} : {})};
  seen.add(providerId); result.push({id:personalItemId(personalRef),title,kind,groupTitle,posterUrl:art(r.stream_icon ?? r.cover),logoUrl:kind === 'live' ? art(r.stream_icon) : null,playbackAllowed:true,available:true,personalRef});
 }
 return result;
}
function positive(value: unknown, max: number): number | undefined { const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : NaN; return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined; }
export function normalizeEpisodes(raw: unknown, sourceVersion: string, seriesId: string, seriesTitle: string): PersonalEpisode[] {
 if (!id(seriesId) || isJunkVodCatalogTitle(seriesTitle)) fail();
 const groups = record(record(raw).episodes); const buckets = Object.values(groups); if (buckets.length > 5000) fail();
 let count = 0; for (const bucket of buckets) { count += list(bucket,5000).length; if (count > 5000) fail(); }
 const episodes: PersonalEpisode[] = []; const seen = new Set<string>();
 for (const bucket of buckets) for (const value of bucket as unknown[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
  const r = record(value); const providerId = id(r.id); const title = text(r.title); const seasonNumber = positive(r.season,999); const episodeNumber = positive(r.episode_num,9999); const extension = ext(r.container_extension);
  if (!providerId || seen.has(providerId) || !title || !seasonNumber || !episodeNumber || !extension || !isValidSeriesEpisodeCatalogEntry({seriesTitle,title,source:`/series/${providerId}.${extension}`})) continue;
  const personalRef: PersonalRef = {source:'personal',sourceVersion,kind:'episode',id:providerId,seriesId,extension};
  seen.add(providerId); episodes.push({id:personalItemId(personalRef),title,seasonNumber,episodeNumber,playbackAllowed:true,personalRef});
 }
 return episodes.sort((a,b)=>a.seasonNumber-b.seasonNumber || a.episodeNumber-b.episodeNumber);
}
function decode(value: unknown, max: number): string {
 if (typeof value !== 'string' || !value.length || value.length > max * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return '';
 try { const bytes = Uint8Array.from(atob(value), c=>c.charCodeAt(0)); return text(new TextDecoder('utf-8',{fatal:true}).decode(bytes), max); } catch { return ''; }
}
export function normalizeEpg(raw: unknown): PersonalProgramme[] {
 const rows = list(record(raw).epg_listings,24); const out: PersonalProgramme[] = [];
 for (const value of rows) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
  const r = record(value); const start = Number(r.start_timestamp); const end = Number(r.stop_timestamp ?? r.end_timestamp); const title = decode(r.title,512); const description = decode(r.description,8192);
  if (!title || !Number.isInteger(start) || !Number.isInteger(end) || start < 946684800 || end > 4102444800 || end <= start || end-start > 86400) continue;
  out.push({title,description,start:start*1000,end:end*1000});
 }
 return out.sort((a,b)=>a.start-b.start);
}

export function createPersonalProviderClient(options: { loadBootstrap: (signal: AbortSignal) => Promise<unknown>; fetch?: typeof fetch; now?: ()=>number }) {
 const fetcher = options.fetch ?? globalThis.fetch; const now = options.now ?? Date.now;
 let pendingRefresh: Promise<{b:PersonalProviderBootstrap;g:number}> | undefined;
 let generation = 0; let bootstrapSequence = 0; let pendingBootstrap: Promise<{b:PersonalProviderBootstrap;g:number}> | undefined; let session: PersonalProviderBootstrap | undefined; let expiryTimer: ReturnType<typeof setTimeout> | undefined;
 const controllers = new Set<AbortController>(); const cache = new Map<Kind, PersonalMediaItem[]>();
 function clear() { pendingRefresh = undefined; generation++; bootstrapSequence++; pendingBootstrap = undefined; session = undefined; cache.clear(); if (expiryTimer) clearTimeout(expiryTimer); expiryTimer = undefined; for (const c of controllers) c.abort(); controllers.clear(); }
 function active(g: number, b: PersonalProviderBootstrap) { if (g !== generation || !session || session !== b) fail(); if (Date.parse(b.expiresAt) <= now()) { clear(); fail(); } }
 async function bootstrapRaw(force = false) {
  if (session && Date.parse(session.expiresAt) <= now()) clear();
  if (session && !force) return {b:session,g:generation};
  const g = generation; const sequence = ++bootstrapSequence; const controller = new AbortController(); controllers.add(controller);
  try {
   let b = validatePersonalBootstrap(await options.loadBootstrap(controller.signal),now()); if (g !== generation || sequence !== bootstrapSequence || controller.signal.aborted) fail();
   if (session && (session.accountId !== b.accountId || session.sourceVersion !== b.sourceVersion || session.providerOrigin !== b.providerOrigin || session.username !== b.username || session.password !== b.password)) clear();
   // Keep active operations on the same identity; refreshed access may shorten or extend its deadline.
   if (session) { session.expiresAt = b.expiresAt; b = session; }
   session = b; if (expiryTimer) clearTimeout(expiryTimer);
   const schedule = () => { if (session !== b) return; const remaining = Date.parse(b.expiresAt)-now(); if (remaining <= 0) clear(); else { expiryTimer = setTimeout(schedule,Math.min(remaining,2147483647)); (expiryTimer as unknown as {unref?:()=>void}).unref?.(); } }; schedule();
   return {b,g:generation};
  } catch { return fail(); } finally { controllers.delete(controller); }
 }
 function bootstrap(force = false): Promise<{b:PersonalProviderBootstrap;g:number}> {
  if (pendingBootstrap && !force) return pendingBootstrap;
  const promise = bootstrapRaw(force); pendingBootstrap = promise;
  void promise.then(()=>{if(pendingBootstrap === promise) pendingBootstrap=undefined;},()=>{if(pendingBootstrap === promise) pendingBootstrap=undefined;});
  return promise;
 }
 async function request(b: PersonalProviderBootstrap,g: number,action: string,providerId?: string,signal?: AbortSignal) {
  active(g,b); if (signal?.aborted) fail(); if (!ACTIONS.has(action) || (['get_series_info','get_short_epg'].includes(action) && !id(providerId))) fail();
  const url = new URL('/player_api.php',b.providerOrigin); url.searchParams.set('username',b.username); url.searchParams.set('password',b.password); url.searchParams.set('action',action);
  if (action === 'get_series_info') url.searchParams.set('series_id',providerId!);
  if (action === 'get_short_epg') {url.searchParams.set('stream_id',providerId!);url.searchParams.set('limit','24');}
  const controller = new AbortController(); controllers.add(controller); const timeout = setTimeout(()=>controller.abort(),15000);
  const abort = () => controller.abort(); signal?.addEventListener('abort',abort,{once:true});
  try {
   if (signal?.aborted) fail();
   const response = await fetcher(url.toString(),{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'}); active(g,b);
   if (!response.ok || response.redirected || Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) fail();
   const reader = response.body!.getReader(); const decoder = new TextDecoder('utf-8',{fatal:true}); let size=0; let body='';
   try { while (true) { const chunk = await reader.read(); active(g,b); if (controller.signal.aborted) fail(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_BYTES) fail(); body += decoder.decode(chunk.value,{stream:true}); } body += decoder.decode(); } catch { await reader.cancel().catch(()=>{}); return fail(); } finally { reader.releaseLock(); }
   active(g,b); return JSON.parse(body) as unknown;
  } catch { return fail(); } finally { clearTimeout(timeout);signal?.removeEventListener('abort',abort);controllers.delete(controller); }
 }
 async function catalogFor(kind: Kind,b: PersonalProviderBootstrap,g: number,force = false) {
  active(g,b); if (!['live','movie','series'].includes(kind)) fail(); if (!force && cache.has(kind)) return structuredClone(cache.get(kind)!);
  const prefix = kind === 'movie' ? 'vod' : kind;
  const [categories,rows] = await Promise.all([request(b,g,`get_${prefix}_categories`),request(b,g,kind === 'series' ? 'get_series' : `get_${prefix}_streams`)]);
  const items = normalizeCatalog(kind,rows,categories,b.sourceVersion);active(g,b);cache.set(kind,items);return structuredClone(items);
 }
 async function seriesFor(ref: PersonalRef,b: PersonalProviderBootstrap,g: number,force = false) {
  if (ref.sourceVersion !== b.sourceVersion || ref.kind !== 'series') fail();
  const items = await catalogFor('series',b,g,force);const parent = items.find(i=>i.personalRef.id === ref.id); if (!parent) fail();
  const episodes = normalizeEpisodes(await request(b,g,'get_series_info',ref.id),b.sourceVersion,ref.id,parent!.title);active(g,b);
  const seasons = [...new Set(episodes.map(e=>e.seasonNumber))].map(seasonNumber=>({seasonNumber,title:`${seasonNumber}. Sezon`,episodes:episodes.filter(e=>e.seasonNumber === seasonNumber)}));
  return {...parent,seasons,episodeCount:episodes.length,seasonCount:seasons.length};
 }
 return {
  clear,
  refreshMetadata() { if (pendingRefresh) return pendingRefresh.then(({b})=>b); const promise = bootstrap(true); pendingRefresh = promise; void promise.then(()=>{if(pendingRefresh===promise)pendingRefresh=undefined;},()=>{if(pendingRefresh===promise)pendingRefresh=undefined;}); return promise.then(({b})=>b); },
  async catalog(kind: Kind) { const {b,g} = await bootstrap();return catalogFor(kind,b,g); },
  async series(value: unknown) {const ref=validatePersonalRef(value);const {b,g}=await bootstrap();return seriesFor(ref,b,g);},
  async shortEpg(value: unknown, signal?: AbortSignal): Promise<PersonalEpgResult> {
   try {
    if (signal?.aborted) fail();
    const ref=validatePersonalRef(value); const {b,g}=await bootstrap();
    if (signal?.aborted) fail();
    if (ref.kind !== 'live' || ref.sourceVersion !== b.sourceVersion) fail();
    const items=await catalogFor('live',b,g);
    if (signal?.aborted || !items.some(i=>i.personalRef.id===ref.id)) fail();
    const programmes=normalizeEpg(await request(b,g,'get_short_epg',ref.id,signal));
    return {status:programmes.length?'ready':'empty',programmes};
   } catch {return {status:'error',programmes:[],error:'Program bilgisi alınamadı'};}
  },
  async playback(value: unknown) {
   const ref = validatePersonalRef(value);const {b,g}=await bootstrap(true);if(ref.sourceVersion !== b.sourceVersion) fail();let verified: PersonalRef | undefined;
   if(ref.kind === 'episode') {const detail=await seriesFor({source:'personal',sourceVersion:ref.sourceVersion,kind:'series',id:ref.seriesId!},b,g,true);verified=detail.seasons.flatMap(s=>s.episodes).find(e=>e.personalRef.id===ref.id)?.personalRef;}
   // Access is freshly revalidated above. A live channel's membership can reuse the
   // catalog already verified for this exact source; on identity changes clear()
   // discards it before a new source can authorize a stream.
   else if(ref.kind !== 'series') verified=(await catalogFor(ref.kind,b,g,ref.kind !== 'live')).find(i=>i.personalRef.id===ref.id)?.personalRef;
   if(!verified) fail();active(g,b);return {url:buildPersonalMediaUrl(b,verified,now()),expiresAt:b.expiresAt};
  }
 };
}
