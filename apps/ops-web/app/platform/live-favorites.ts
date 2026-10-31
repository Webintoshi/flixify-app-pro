import type { MediaItem } from './types';

export function hydrateLegacyLiveFavorites(saved:readonly MediaItem[], catalog:readonly MediaItem[], aliases:ReadonlyMap<string,string>):MediaItem[] {
 const selected=new Map(catalog.map(item=>[item.id,item]));
 const hydrated=new Map<string,MediaItem>();const items:MediaItem[]=[];
 for(const item of saved) {
  if(item.kind!=='live') {items.push(item);continue;}
  const target=selected.get(aliases.get(item.id) ?? '');
  if(!target || target.kind!=='live') {items.push({...item,available:false,playbackAllowed:false});continue;}
  const existing=hydrated.get(target.id);
  if(existing) {if(!existing.legacyFavoriteIds!.includes(item.id))existing.legacyFavoriteIds!.push(item.id);continue;}
  const next={...target,legacyFavoriteIds:[item.id]};hydrated.set(target.id,next);items.push(next);
 }
 return items;
}

export function legacyFavoriteMutationIds(item:MediaItem, existing?:MediaItem):string[] {
 return [...new Set(existing?.legacyFavoriteIds?.length ? existing.legacyFavoriteIds : [existing?.id ?? item.id])];
}
