import { homepageReleaseYear } from './catalog-release-year';
import { itemKey, type MediaItem } from './types';

export function movieText(value:string):string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
const eligible=(item:MediaItem)=>item.kind==='movie'&&item.available!==false&&item.playbackAllowed!==false&&!item.lookupFailed;
const identity=(item:MediaItem)=>item.personalRef?`${item.personalRef.kind}:${item.personalRef.id}`:itemKey(item);
const titleIdentity=(item:MediaItem)=>item.title.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const art=(item:MediaItem)=>Boolean(item.posterUrl?.trim());

export function isMarvelMovie(item:MediaItem):boolean {
  return eligible(item)&&/\b(?:marvel|avengers|yenilmezler|iron man|ironman|thor|captain america|kaptan amerika|spider man|spiderman|orumcek adam|hulk|doctor strange|doktor strange|black panther|kara panter|ant man|karinca adam|guardians of the galaxy|galaksinin koruyuculari|black widow|kara dul|shang chi|eternals|deadpool|wolverine|x men|venom)\b/.test(movieText(item.title));
}
export function isActionMovie(item:MediaItem):boolean {
  return eligible(item)&&art(item)&&/\b(?:aksiyon|action)\b/.test(movieText(item.groupTitle??''));
}
export function isDedicatedFantasyGroup(group:string):boolean {
  const text=movieText(group);
  return /\b(?:fantastik|fantasy)\b/.test(text)&&!/\b(?:bilim kurgu|science fiction|sci fi|scifi)\b/.test(text);
}
export function isFantasyMovie(item:MediaItem):boolean {
  if(!eligible(item))return false;
  return /\b(?:harry potter|fantastic beasts|fantastik canavarlar|lord of the rings|yuzuklerin efendisi|hobbit|narnia)\b/.test(movieText(item.title))||isDedicatedFantasyGroup(item.groupTitle??'');
}

export function buildMovieShowcase(items:readonly MediaItem[],options:{failedPosters?:ReadonlySet<string>;limit?:number}={}) {
  const blockedIds=new Set<string>(),blockedTitles=new Set<string>();
  for(const item of items)if(options.failedPosters?.has(itemKey(item))){blockedIds.add(identity(item));blockedTitles.add(titleIdentity(item));}
  const ids=new Map<string,number>(),titles=new Map<string,number>();const pool:MediaItem[]=[];
  for(const item of items){
    const id=identity(item),title=titleIdentity(item);
    if(!eligible(item)||blockedIds.has(id)||blockedTitles.has(title))continue;
    const existing=ids.get(id)??titles.get(title);
    if(existing!==undefined){if(!art(pool[existing])&&art(item))pool[existing]=item;ids.set(id,existing);titles.set(title,existing);continue;}
    ids.set(id,pool.length);titles.set(title,pool.length);pool.push(item);
  }
  const current=pool.filter(item=>homepageReleaseYear(item)===2026);
  const hero=current.filter(art).slice(0,Math.min(5,Math.max(1,Math.floor(current.length/3))));
  const used=new Set(hero.map(identity));const limit=Math.max(0,options.limit??18);
  const take=(entries:MediaItem[])=>{
    const covered=entries.filter(art),missing=entries.filter(item=>!art(item));
    const ordered=[...covered,...missing];
    const unique=ordered.filter(item=>!used.has(identity(item)));
    const selected=(unique.length?unique:ordered).slice(0,limit);
    for(const item of selected)used.add(identity(item));return selected;
  };
  return{hero,current:take(current),marvel:take(pool.filter(isMarvelMovie)),action:take(pool.filter(isActionMovie)),fantasy:take(pool.filter(isFantasyMovie))};
}
