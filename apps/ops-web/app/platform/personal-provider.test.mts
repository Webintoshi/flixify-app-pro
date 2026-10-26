import {test} from 'node:test';
import assert from 'node:assert/strict';
import adapter from './personal-provider.ts';
const { normalizeCatalog, normalizeEpisodes, normalizeEpg, buildPersonalMediaUrl, createPersonalProviderClient } = adapter;
const bootstrap = {accountId:'a',sourceVersion:'v1',providerOrigin:'https://provider.test',username:'u/a',password:'p?#',expiresAt:'2030-01-01T00:00:00Z',moviePolicy:'general-audience-only'};
const ref = {source:'personal',sourceVersion:'v1',kind:'movie',id:'12',extension:'mp4'} as const;
test('movie categories are exact and missing/unknown/adult fail closed; IDs and artwork are untrusted',()=>{
 const rows=[{stream_id:12,name:'Film',category_id:'1',stream_icon:'javascript:alert(1)',container_extension:'mp4',direct_source:'https://evil.test/x'}, {stream_id:13,name:'Other',category_id:'2'}, {stream_id:'../4',name:'Bad',category_id:'1'}];
 const items=normalizeCatalog('movie',rows,[{category_id:'1',category_name:'TR | YÜKSEK PUANLI FİLMLER'},{category_id:'2',category_name:'Aile Adult'}],'v1');
 assert.equal(items.length,1); assert.equal(items[0].posterUrl,null); assert.equal(items[0].personalRef.id,'12'); assert.ok(!JSON.stringify(items).includes('evil')); assert.deepEqual(normalizeCatalog('movie',rows,[],'v1'),[]);
 assert.equal(normalizeCatalog('series',[{series_id:3,name:'Show'}],[],'v1').length,1);
});
test('media URL encodes credentials and rejects arbitrary IDs/extensions/origins',()=>{
 assert.equal(buildPersonalMediaUrl(bootstrap,ref),'https://provider.test/movie/u%2Fa/p%3F%23/12.mp4');
 for(const bad of [{...ref,id:'../12'},{...ref,extension:'mp4?evil'},{...ref,sourceVersion:'old'}]) assert.throws(()=>buildPersonalMediaUrl(bootstrap,bad));
 assert.throws(()=>buildPersonalMediaUrl({...bootstrap,providerOrigin:'https://provider.test/path'},ref));
});
test('episodes require parent and strict bounded numbers; EPG decodes UTF8 and rejects bad ranges',()=>{
 const episodes=normalizeEpisodes({episodes:{'1':[{id:4,title:'Part',season:1,episode_num:2,container_extension:'mkv'},{id:5,title:'Bad',season:-2,episode_num:2}]}},'v1','3','Show');
 assert.equal(episodes.length,1);assert.equal(episodes[0].personalRef.seriesId,'3');
 const epg=normalizeEpg({epg_listings:[{title:Buffer.from('Türkçe').toString('base64'),description:Buffer.from('Öykü').toString('base64'),start_timestamp:'1760000000',stop_timestamp:'1760003600'},{title:'bad',start_timestamp:5,stop_timestamp:2}]});
 assert.equal(epg.length,1);assert.equal(epg[0].title,'Türkçe');assert.equal(epg[0].description,'Öykü');
});
test('playback refreshes filtered membership, omits request credentials and refuses expiry',async()=>{
 let now=Date.parse('2026-01-01');let calls=0;let allow=true;
 const client=createPersonalProviderClient({loadBootstrap:async()=>{calls++;return bootstrap;},now:()=>now,fetch:async(url,init)=>{
 assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal(init?.referrerPolicy,'no-referrer');
 const action=new URL(String(url)).searchParams.get('action');return new Response(JSON.stringify(action==='get_vod_categories'?(allow?[{category_id:'1',category_name:'Aile'}]:[]):[{stream_id:12,name:'Film',category_id:'1',container_extension:'mp4'}]));
 }});
 await client.catalog('movie');await client.playback(ref);assert.equal(calls,2);allow=false;await assert.rejects(client.playback(ref));
 now=Date.parse('2031-01-01');await assert.rejects(client.catalog('movie'));
});
test('clear invalidates pending bootstrap and stale requests',async()=>{
 let release:(v:unknown)=>void=()=>{};let requests=0;
 const client=createPersonalProviderClient({loadBootstrap:()=>new Promise(r=>release=r),fetch:async()=>{requests++;return new Response('[]');}});
 const pending=client.catalog('movie');client.clear();release(bootstrap);await assert.rejects(pending);assert.equal(requests,0);
});
test('response and collection bounds reject without returning partial unsafe data',async()=>{
 assert.throws(()=>normalizeCatalog('live',Array(50001).fill({}),[],'v1'));
 assert.throws(()=>normalizeEpisodes({episodes:{'1':Array(5001).fill({})}},'v1','3','Show'));
 const client=createPersonalProviderClient({loadBootstrap:async()=>bootstrap,fetch:async()=>new Response('[]',{headers:{'content-length':String(21*1024*1024)}})});
 await assert.rejects(client.catalog('live'));
});
test('account change aborts old catalog responses and cannot reuse a former line ref',async()=>{
 let current=bootstrap;const releases:Array<()=>void>=[];let block=false;let aborted=false;
 const client=createPersonalProviderClient({loadBootstrap:async()=>current,fetch:async(url,init)=>{
  const action=new URL(String(url)).searchParams.get('action');
  if(block){init?.signal?.addEventListener('abort',()=>{aborted=true;});await new Promise<void>(r=>releases.push(r));}
  return new Response(JSON.stringify(action==='get_vod_categories'?[{category_id:'1',category_name:'Aile'}]:[{stream_id:12,name:'Film',category_id:'1',container_extension:'mp4'}]));
 }});
 await client.catalog('movie');block=true;const old=client.playback(ref);await new Promise(r=>setTimeout(r,0));
 current={...bootstrap,accountId:'other',sourceVersion:'v2'};await assert.rejects(client.playback(ref));releases.forEach(r=>r());await assert.rejects(old);assert.equal(aborted,true);
});
test('empty and malformed selected channel EPG stay distinguishable; catalog mutation cannot forge membership',async()=>{
 let malformed=false;const client=createPersonalProviderClient({loadBootstrap:async()=>bootstrap,fetch:async(url)=>{
 const action=new URL(String(url)).searchParams.get('action');
 return new Response(JSON.stringify(action==='get_live_categories'?[]:action==='get_live_streams'?[{stream_id:7,name:'Channel'}]:malformed?{}:{epg_listings:[]}));
 }});
 const rows=await client.catalog('live');rows[0].personalRef.id='999';
 assert.equal((await client.shortEpg({source:'personal',sourceVersion:'v1',kind:'live',id:'7'})).status,'empty');
 malformed=true;assert.equal((await client.shortEpg({source:'personal',sourceVersion:'v1',kind:'live',id:'7'})).status,'error');
 assert.equal((await client.shortEpg(rows[0].personalRef)).status,'error');
});
test('a late earlier bootstrap cannot replace the latest account identity',async()=>{
 const pending:Array<(v:unknown)=>void>=[];let providerRequests=0;
 const client=createPersonalProviderClient({loadBootstrap:()=>new Promise(r=>pending.push(r)),fetch:async()=>{providerRequests++;return new Response('[]');}});
 const earlier=client.catalog('live');const later=assert.rejects(client.playback({source:'personal',sourceVersion:'new',kind:'live',id:'7'}));
 pending[1]({...bootstrap,accountId:'new',sourceVersion:'new'});await later;
 pending[0](bootstrap);await assert.rejects(earlier);assert.equal(providerRequests,2);
});
test('episode playback resolves only current verified parent detail and ignores a caller extension',async()=>{
 let include=true;const actions:string[]=[];
 const client=createPersonalProviderClient({loadBootstrap:async()=>bootstrap,fetch:async(url)=>{
  const action=new URL(String(url)).searchParams.get('action')!;actions.push(action);
  return new Response(JSON.stringify(action==='get_series_categories'?[]:action==='get_series'?[{series_id:3,name:'Show'}]:{episodes:{'1':include?[{id:4,title:'Part',season:1,episode_num:1,container_extension:'mkv',direct_source:'https://evil.test'}]:[]}}));
 }});
 const episode={source:'personal',sourceVersion:'v1',kind:'episode',id:'4',seriesId:'3',extension:'mp4'};
 assert.equal((await client.playback(episode)).url,'https://provider.test/series/u%2Fa/p%3F%23/4.mkv');
 include=false;await assert.rejects(client.playback(episode));assert.ok(actions.includes('get_series_info'));
});
test('streaming body bound applies without a content-length header',async()=>{
 let canceled=false;
 const client=createPersonalProviderClient({loadBootstrap:async()=>bootstrap,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(20*1024*1024+1));},cancel(){canceled=true;}}))});
 await assert.rejects(client.catalog('live'));assert.equal(canceled,true);client.clear();
});
test('expired access stops provider requests even when a former catalog is cached',async()=>{
 let now=Date.parse('2026-01-01');let count=0;const client=createPersonalProviderClient({now:()=>now,loadBootstrap:async()=>bootstrap,fetch:async()=>{count++;return new Response('[]');}});
 await client.catalog('live');const before=count;now=Date.parse('2031-01-01');await assert.rejects(client.catalog('live'));assert.equal(count,before);
});
test('reference versions reject control characters and whitespace changes',()=>{
 for(const sourceVersion of ['v1\n',' v1','v1\u0000']) assert.throws(()=>adapter.validatePersonalRef({...ref,sourceVersion}));
});
