import { isDedicatedFantasyGroup, movieText } from './movie-showcase';
import { itemKey, type Catalog, type MediaItem } from './types';

type Group={title:string;count:number};
export type MovieShowcaseQuery={page:1;pageSize:number;search:string;group:string};
const cache=new Map<string,{at:number;items:MediaItem[]}>();
let cacheAccount='';
export function clearMovieShowcaseSourceCache(){cache.clear();cacheAccount='';}

export function movieShowcaseQueries(groups:readonly Group[]):MovieShowcaseQuery[]{
  const queries:MovieShowcaseQuery[]=['2026','Marvel','Avengers','Yenilmezler','Iron Man','Thor','Örümcek','Harry Potter','Yüzüklerin','Hobbit'].map(search=>({page:1,pageSize:search==='2026'?300:48,search,group:''}));
  const action=groups.find(group=>/\b(?:aksiyon|action)\b/.test(movieText(group.title)));
  const fantasy=groups.find(group=>isDedicatedFantasyGroup(group.title))??groups.find(group=>/\b(?:fantastik|fantasy)\b/.test(movieText(group.title)));
  for(const group of [action,fantasy])if(group)queries.push({page:1,pageSize:48,search:'',group:group.title});
  return queries.slice(0,12);
}

export async function loadMovieShowcaseSeeds(options:{account:string;revision:number;groups:readonly Group[];signal:AbortSignal;request:(query:MovieShowcaseQuery)=>Promise<Catalog>;onItems?:(items:MediaItem[])=>void}):Promise<MediaItem[]>{
  const {signal}=options;signal.throwIfAborted();
  if(cacheAccount!==options.account){cache.clear();cacheAccount=options.account;}
  const queries=movieShowcaseQueries(options.groups);const rows=new Map<number,MediaItem[]>();let next=0,successes=0;
  const collected=()=>Array.from(new Map([...rows].sort(([a],[b])=>a-b).flatMap(([,items])=>items).map(item=>[itemKey(item),item])).values());
  const worker=async()=>{
    while(next<queries.length){
      signal.throwIfAborted();const index=next++,query=queries[index];
      const key=JSON.stringify([options.account,options.revision,query]);
      try{
        const saved=cache.get(key);
        const items=saved&&Date.now()-saved.at<60000?saved.items:(await options.request(query)).items;
        signal.throwIfAborted();
        if(cacheAccount!==options.account)throw new Error('Catalog changed');
        if(!Array.isArray(items))throw new Error('Invalid catalog');
        successes++;
        rows.set(index,items);
        if(!saved||Date.now()-saved.at>=60000){if(cache.size>=96)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),items});}
        options.onItems?.(collected());
      }catch(error){if(signal.aborted||cacheAccount!==options.account)throw error;}
    }
  };
  await Promise.all(Array.from({length:Math.min(3,queries.length)},worker));
  signal.throwIfAborted();if(!successes)throw new Error('movie_showcase_unavailable');return collected();
}
