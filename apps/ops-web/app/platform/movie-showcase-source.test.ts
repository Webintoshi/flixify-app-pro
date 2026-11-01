import { describe, expect, it, vi } from 'vitest';
import { clearMovieShowcaseSourceCache, loadMovieShowcaseSeeds, movieShowcaseQueries } from './movie-showcase-source';
import type { Catalog, MediaItem } from './types';

describe('bounded account-scoped legacy movie seeds',()=>{
  it('plans at most12 targeted first-page queries and prefers a dedicated fantasy group',()=>{
    const queries=movieShowcaseQueries([{title:'TR | Aksiyon - Macera Filmleri',count:90},{title:'TR | Bilim Kurgu - Fantastik Filmler',count:80},{title:'Fantastik',count:12}]);
    expect(queries).toHaveLength(12);expect(queries.every(x=>x.page===1&&x.pageSize<=300)).toBe(true);
    expect(queries.find(x=>x.group.includes('Fantastik'))?.group).toBe('Fantastik');
    expect(queries.map(x=>x.search)).toEqual(expect.arrayContaining(['2026','Avengers','Örümcek','Harry Potter','Yüzüklerin','Hobbit']));
  });
  it('publishes progressively, caps concurrency3 and reuses only the matching account/revision cache',async()=>{
    clearMovieShowcaseSourceCache();let active=0,max=0;const snapshots:number[]=[];
    const request=vi.fn(async(query:any):Promise<Catalog>=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return{items:[{id:query.search||query.group,title:query.search||query.group,kind:'movie'} as MediaItem],total:50000};});
    const options={account:'A',revision:0,groups:[],signal:new AbortController().signal,request,onItems:(items:MediaItem[])=>snapshots.push(items.length)};
    const first=await loadMovieShowcaseSeeds(options);expect(max).toBeLessThanOrEqual(3);expect(request).toHaveBeenCalledTimes(10);expect(snapshots.length).toBeGreaterThan(1);expect(first).toHaveLength(10);
    await loadMovieShowcaseSeeds({...options,signal:new AbortController().signal});expect(request).toHaveBeenCalledTimes(10);
    await loadMovieShowcaseSeeds({...options,revision:1,signal:new AbortController().signal});expect(request).toHaveBeenCalledTimes(20);
    await loadMovieShowcaseSeeds({...options,account:'B',signal:new AbortController().signal});expect(request).toHaveBeenCalledTimes(30);
  });
  it('aborts further acquisition and never publishes a late response into another owner',async()=>{
    clearMovieShowcaseSourceCache();const controller=new AbortController();const publish=vi.fn();const finishes:((data:Catalog)=>void)[]=[];
    const request=vi.fn(()=>new Promise<Catalog>(resolve=>{finishes.push(resolve);}));
    const pending=loadMovieShowcaseSeeds({account:'old',revision:0,groups:[],signal:controller.signal,request,onItems:publish});
    controller.abort();for(const finish of finishes)finish({items:[{id:'old',title:'Old',kind:'movie'}],total:50000});
    await expect(pending).rejects.toThrow();expect(publish).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(3);
  });
  it('distinguishes an entirely failed acquisition from a genuinely empty catalog',async()=>{
    clearMovieShowcaseSourceCache();const request=vi.fn(async()=>{throw new Error('offline');});
    await expect(loadMovieShowcaseSeeds({account:'failed',revision:0,groups:[],signal:new AbortController().signal,request})).rejects.toThrow('movie_showcase_unavailable');
    expect(request).toHaveBeenCalledTimes(10);
    await expect(loadMovieShowcaseSeeds({account:'empty',revision:0,groups:[],signal:new AbortController().signal,request:async()=>({items:[],total:0})})).resolves.toEqual([]);
  });
});
