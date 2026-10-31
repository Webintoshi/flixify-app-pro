import { personalItemId, validatePersonalRef, validatePersonalBootstrap, type PersonalProviderBootstrap, type PersonalRef } from './personal-provider';
import type { createPersonalProviderClient } from './personal-provider';
import type { Catalog, MediaItem, Episode, Kind } from './types';
export function sessionIdentity(session: {accessToken: string; refreshToken?: string; kryptoniteCode?: string | null; user?: {kryptoniteCode?: string | null}} | null): string {
 if (!session) return '';
 try { const claims = JSON.parse(atob(session.accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (typeof claims.sub === 'string' && claims.sub) return claims.sub; } catch {}
 return session.kryptoniteCode ?? session.user?.kryptoniteCode ?? session.refreshToken ?? session.accessToken;
}
export function personalRefKey(ref: PersonalRef): string { return personalItemId(validatePersonalRef(ref)); }
export function pagePersonalCatalog(items: MediaItem[], page: number, search = '', group = ''): Catalog {
 const groups = new Map<string,number>();
 for (const item of items) if(item.groupTitle) groups.set(item.groupTitle,(groups.get(item.groupTitle) ?? 0)+1);
 const needle = search.toLocaleLowerCase('tr');
 const filtered = items.filter(item => (!group || item.groupTitle === group) && item.title.toLocaleLowerCase('tr').includes(needle));
 return {items:filtered.slice((page-1)*48,page*48), total:filtered.length,groups:Array.from(groups,([title,count])=>({title,count}))};
}
export function hydratePersonalFavorites(refs: PersonalRef[], catalogs: MediaItem[], isExcluded: (ref: PersonalRef)=>boolean = ()=>false, resolveLive?: (ref: PersonalRef)=>MediaItem | undefined): MediaItem[] {
 const current = new Map(catalogs.filter(i=>i.personalRef).map(i=>[personalRefKey(i.personalRef!),i]));
 const result:MediaItem[]=[];const liveIndexes=new Map<string,number>();
 for(const value of refs) { try {
  const ref=validatePersonalRef(value);if(ref.kind==='episode' || (ref.kind==='live' && isExcluded(ref)))continue;
  const id=personalRefKey(ref);let item=current.get(id);
  if(!item && ref.kind==='live') {
   const resolved=resolveLive?.(ref);
   if(resolved?.kind==='live' && resolved.personalRef?.sourceVersion===ref.sourceVersion)item=resolved;
  }
  item ??= {id,kind:ref.kind,title:'Kullanılamayan favori',personalRef:ref,available:false};
  if(ref.kind!=='live'){result.push(item);continue;}
  const key=item.id,index=liveIndexes.get(key);
  if(index===undefined){liveIndexes.set(key,result.length);result.push({...item,personalFavoriteRefs:[ref]});}
  else if(!result[index].personalFavoriteRefs!.some(saved=>personalRefKey(saved)===id))result[index]={...result[index],personalFavoriteRefs:[...result[index].personalFavoriteRefs!,ref]};
 } catch { /* Invalid saved references cannot rebind a channel. */ } }
 return result;
}
export function personalFavoriteMutationRefs(item:MediaItem, existing?:MediaItem):PersonalRef[] {
 if(!item.personalRef)throw new Error('Unavailable reference');
 const canonical=validatePersonalRef(item.personalRef);
 const stored=existing?.personalFavoriteRefs?.length ? existing.personalFavoriteRefs : [existing?.personalRef ?? canonical];
 const unique=new Map<string,PersonalRef>();
 for(const value of existing ? stored : [canonical]) {
  const ref=validatePersonalRef(value);
  if(ref.sourceVersion!==canonical.sourceVersion || ref.kind!==canonical.kind)throw new Error('Favorite source changed');
  unique.set(personalRefKey(ref),ref);
 }
 return [...unique.values()];
}
export function hydratePersonalWatched(refs: PersonalRef[], episodes: Episode[]): Set<string> {
 const keys = new Set(refs.flatMap(ref=> {try {return [personalRefKey(ref)];} catch {return [];}}));
 return new Set(episodes.filter(ep=>ep.personalRef && keys.has(personalRefKey(ep.personalRef))).map(ep=>ep.id));
}
export function personalPlayback(record: {url:string;expiresAt:string}, now=Date.now()) {
 const url = new URL(record.url); const extension = url.pathname.split('.').pop()?.toLowerCase();
 if(url.protocol !== 'https:' || url.username || url.password || !['m3u8','mp4','mkv'].includes(extension ?? '') || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt)<=now) throw new Error('Bu içerik tarayıcıda oynatılamıyor. Başka bir içerik seçebilirsin.');
 return {url:record.url,expiresAt:record.expiresAt,canPlay:true,deliveryMode:'direct_provider',transport:extension === 'm3u8' ? 'hls' : extension!,errorMessage:null};
}

type PersonalProvider = ReturnType<typeof createPersonalProviderClient>;
export async function resolvePersonalDetail(provider: PersonalProvider, selectedId: string, kind: Kind): Promise<MediaItem> {
 const items = await provider.catalog(kind);
 const current = items.find(item=>item.id === selectedId);
 if(!current?.personalRef) throw new Error('İçerik şu anda kullanılamıyor.');
 return current.kind === 'series' ? {...current,...await provider.series(current.personalRef)} : current;
}
export async function requestPersonalPlayback(provider: PersonalProvider, ref: PersonalRef | undefined) {
 if (!ref) throw new Error('İçerik şu anda kullanılamıyor.');
 return personalPlayback(await provider.playback(ref));
}

/** Only the newest completed bootstrap may change the visible line/deadline. */
export function createScopedBootstrapLoader(load: (signal: AbortSignal) => Promise<unknown>, publish: (bootstrap: PersonalProviderBootstrap) => void, isCurrent: () => boolean) {
 let sequence = 0;
 return async (signal: AbortSignal) => {
  const request = ++sequence;
  const value = validatePersonalBootstrap(await load(signal));
  if (signal.aborted || !isCurrent() || request !== sequence) throw new Error('Session changed');
  publish(value);
  return value;
 };
}

export type WatchedState = { confirmed: Set<string>; optimistic: Map<string, number> };
type WatchedAction = { type: 'hydrate'; ids: Iterable<string> } | { type: 'begin' | 'success' | 'failure'; id: string; attempt: number };
export function createWatchedState(ids: Iterable<string>): WatchedState { return { confirmed: new Set(ids), optimistic: new Map() }; }
export function watchedIds(state: WatchedState): Set<string> { return new Set([...state.confirmed, ...state.optimistic.keys()]); }
/** A failed write removes only its own optimistic addition, never server confirmation. */
export function updateWatchedState(state: WatchedState, action: WatchedAction): WatchedState {
 const confirmed = new Set(state.confirmed); const optimistic = new Map(state.optimistic);
 if (action.type === 'hydrate') for (const id of action.ids) confirmed.add(id);
 else if (action.type === 'begin') optimistic.set(action.id, action.attempt);
 else {
  if (action.type === 'success') confirmed.add(action.id);
  if (optimistic.get(action.id) === action.attempt) optimistic.delete(action.id);
 }
 return { confirmed, optimistic };
}
