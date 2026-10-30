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
for (const operation of ['playback','catalog','detail','epg'] as const) {
 test(`unchanged bootstrap refresh preserves overlapping ${operation}`,async()=>{
  let release:()=>void=()=>{};let entered:()=>void=()=>{};const blocked=new Promise<void>(r=>entered=r);let hold=false;let held=false;let loads=0;
  const blockedAction={playback:'get_vod_streams',catalog:'get_vod_streams',detail:'get_series_info',epg:'get_short_epg'}[operation];
  const client=createPersonalProviderClient({loadBootstrap:async()=>{loads++;return {...bootstrap};},fetch:async(url)=>{
   const action=new URL(String(url)).searchParams.get('action');
   if(hold && !held && action===blockedAction){held=true;entered();await new Promise<void>(r=>release=r);}
   const data=action==='get_live_categories'||action==='get_series_categories'?[]:action==='get_vod_categories'?[{category_id:'1',category_name:'Aile'}]:action==='get_live_streams'?[{stream_id:7,name:'Channel'}]:action==='get_vod_streams'?[{stream_id:12,name:'Film',category_id:'1',container_extension:'mp4'}]:action==='get_series'?[{series_id:3,name:'Show'}]:action==='get_series_info'?{episodes:{'1':[{id:4,title:'Part',season:1,episode_num:1,container_extension:'mkv'}]}}:{epg_listings:[]};
   return new Response(JSON.stringify(data));
  }});
  const liveRef={source:'personal',sourceVersion:'v1',kind:'live',id:'7'};
  await client.catalog('live');hold=true;
  const ongoing=operation==='playback'?client.playback(ref):operation==='catalog'?client.catalog('movie'):operation==='detail'?client.series({source:'personal',sourceVersion:'v1',kind:'series',id:'3'}):client.shortEpg(liveRef);
  await blocked;await client.playback(liveRef);release();
  const result=await ongoing;
  if(operation==='epg') assert.equal((result as {status:string}).status,'empty');
  else assert.ok(result);
  assert.equal(loads,operation==='playback'?3:2);client.clear();
 });
}
for (const shortened of [true,false]) {
 test(`unchanged identity refresh applies ${shortened?'shorter':'longer'} expiry to pending metadata`,async()=>{
  let now=Date.parse('2026-01-01T00:00:00Z');let expiry='2026-01-01T00:02:00Z';let release:()=>void=()=>{};let entered:()=>void=()=>{};const blocked=new Promise<void>(r=>entered=r);
  const client=createPersonalProviderClient({now:()=>now,loadBootstrap:async()=>({...bootstrap,expiresAt:expiry}),fetch:async(url)=>{
   const action=new URL(String(url)).searchParams.get('action');
   if(action==='get_short_epg'){entered();await new Promise<void>(r=>release=r);return new Response('{"epg_listings":[]}');}
   return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:7,name:'Channel'}]));
  }});
  const liveRef={source:'personal',sourceVersion:'v1',kind:'live',id:'7'};await client.catalog('live');const ongoing=client.shortEpg(liveRef);await blocked;
  expiry=shortened?'2026-01-01T00:01:00Z':'2026-01-01T00:04:00Z';const playback=await client.playback(liveRef);assert.equal(playback.expiresAt,expiry);
  now=Date.parse('2026-01-01T00:03:00Z');release();assert.equal((await ongoing).status,shortened?'error':'empty');client.clear();
 });
}
for (const prerequisite of ['bootstrap','catalog'] as const) {
 test(`cancelled EPG waiting for ${prerequisite} never starts provider guide request`,async()=>{
  let release:()=>void=()=>{};let entered:()=>void=()=>{};
  const blocked=new Promise<void>(r=>entered=r);const gate=new Promise<void>(r=>release=r);const actions:string[]=[];
  const client=createPersonalProviderClient({loadBootstrap:async()=>{if(prerequisite==='bootstrap'){entered();await gate;}return bootstrap;},fetch:async(url)=>{
   const action=new URL(String(url)).searchParams.get('action')!;actions.push(action);
   if(prerequisite==='catalog' && action==='get_live_streams'){entered();await gate;}
   return new Response(JSON.stringify(action==='get_live_categories'?[]:action==='get_live_streams'?[{stream_id:7,name:'Channel'}]:{epg_listings:[]}));
  }});
  const controller=new AbortController();const ongoing=client.shortEpg({source:'personal',sourceVersion:'v1',kind:'live',id:'7'},controller.signal);
  await blocked;controller.abort();release();assert.equal((await ongoing).status,'error');assert.equal(actions.includes('get_short_epg'),false);
  assert.equal((await client.catalog('live')).length,1);client.clear();
 });
}
test('cancelling selected EPG aborts its fetch and preserves the shared live catalog',async()=>{
 let entered:()=>void=()=>{};const blocked=new Promise<void>(r=>entered=r);let epgSignal:AbortSignal|undefined;let catalogRequests=0;
 const client=createPersonalProviderClient({loadBootstrap:async()=>bootstrap,fetch:async(url,init)=>{
  const action=new URL(String(url)).searchParams.get('action');
  if(action==='get_short_epg') {epgSignal=init!.signal as AbortSignal;entered();return new Promise<Response>((_,reject)=>epgSignal!.addEventListener('abort',()=>reject(new Error('private transport detail')),{once:true}));}
  catalogRequests++;return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:7,name:'Channel'}]));
 }});
 const controller=new AbortController();const ongoing=client.shortEpg({source:'personal',sourceVersion:'v1',kind:'live',id:'7'},controller.signal);
 await blocked;controller.abort();assert.equal(epgSignal!.aborted,true);
 assert.deepEqual(await ongoing,{status:'error',programmes:[],error:'Program bilgisi alınamadı'});
 assert.equal((await client.catalog('live')).length,1);assert.equal(catalogRequests,2);client.clear();
});
test('forced metadata refresh coalesces, preserves catalog cache and retries after transient failure',async()=>{
 let loads=0, calls=0, outage=false; let current={...bootstrap};
 const client=createPersonalProviderClient({loadBootstrap:async()=>{loads++; if(outage)throw new Error('offline');return current;},fetch:async()=>{calls++;return new Response(JSON.stringify([]));}});
 await client.catalog('live'); assert.equal(loads,1); assert.equal(calls,2);
 current={...current,expiresAt:'2031-01-01T00:00:00Z'};
 const [a,b]=await Promise.all([client.refreshMetadata(),client.refreshMetadata()]);
 assert.equal(loads,2);assert.equal(a.expiresAt,current.expiresAt);assert.equal(a,b);
 await client.catalog('live');assert.equal(calls,2);
 outage=true;await assert.rejects(client.refreshMetadata());
 await client.catalog('live');assert.equal(calls,2);
 client.clear();
});
test('live selection waits for fresh access but skips slow catalog downloads already verified for this source',async()=>{
 let loads=0;let blockAccess=false;let accessEntered!:()=>void;let releaseAccess!:()=>void;let releaseCatalog!:()=>void;
 const entered=new Promise<void>(done=>accessEntered=done);const accessGate=new Promise<void>(done=>releaseAccess=done);const catalogGate=new Promise<void>(done=>releaseCatalog=done);
 const actions:string[]=[];let result:unknown;let warmed=false;
 const client=createPersonalProviderClient({loadBootstrap:async()=>{loads++;if(blockAccess){accessEntered();await accessGate;}return {...bootstrap};},fetch:async(url)=>{
  const action=new URL(String(url)).searchParams.get('action')!;actions.push(action);if(warmed)await catalogGate;
  return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:7,name:'Channel',container_extension:'m3u8'}]));
 }});
 const liveRef={source:'personal',sourceVersion:'v1',kind:'live',id:'7',extension:'mp4'};
 await client.catalog('live');warmed=true;blockAccess=true;
 const ongoing=client.playback(liveRef).then(value=>{result=value;return value;});
 try{
  await entered;assert.equal(result,undefined,'fresh entitlement must finish before media is authorized');releaseAccess();await new Promise(done=>setImmediate(done));
  assert.ok(result,'a cached live selection must not wait for the slow provider catalog');assert.equal(loads,2);
  assert.deepEqual(actions,['get_live_categories','get_live_streams']);
  assert.equal((result as {url:string}).url,'https://provider.test/live/u%2Fa/p%3F%23/7.m3u8');
 }finally{releaseAccess();releaseCatalog();await ongoing;client.clear();}
});
test('a mutated cached live reference cannot forge membership or its verified stream extension',async()=>{
 let requests=0;const client=createPersonalProviderClient({loadBootstrap:async()=>({...bootstrap}),fetch:async(url)=>{
  requests++;const action=new URL(String(url)).searchParams.get('action');return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:7,name:'Channel',container_extension:'m3u8'}]));
 }});
 const rows=await client.catalog('live');rows[0].personalRef.id='999';await assert.rejects(client.playback(rows[0].personalRef));
 const response=await client.playback({...rows[0].personalRef,id:'7',extension:'mp4'});assert.equal(response.url,'https://provider.test/live/u%2Fa/p%3F%23/7.m3u8');assert.equal(requests,2);client.clear();
});
test('cached live playback still refuses a failed fresh access check before contacting the provider',async()=>{
 let denied=false,requests=0;const client=createPersonalProviderClient({loadBootstrap:async()=>{if(denied)throw new Error('private failure');return {...bootstrap};},fetch:async(url)=>{
  requests++;const action=new URL(String(url)).searchParams.get('action');return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:7,name:'Channel'}]));
 }});
 await client.catalog('live');denied=true;await assert.rejects(client.playback({source:'personal',sourceVersion:'v1',kind:'live',id:'7'}));assert.equal(requests,2);client.clear();
});
test('a credential change invalidates cached live membership even if the source version was reused',async()=>{
 let current={...bootstrap};let requests=0;const client=createPersonalProviderClient({loadBootstrap:async()=>({...current}),fetch:async(url)=>{
  requests++;const action=new URL(String(url)).searchParams.get('action');return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:current.username===bootstrap.username?7:8,name:'Channel'}]));
 }});
 await client.catalog('live');current={...current,username:'replacement'};await assert.rejects(client.playback({source:'personal',sourceVersion:'v1',kind:'live',id:'7'}));assert.equal(requests,4);
 const response=await client.playback({source:'personal',sourceVersion:'v1',kind:'live',id:'8'});assert.ok(response.url.includes('/replacement/'));assert.equal(requests,4);client.clear();
});

for(const first of ['playback','metadata'] as const){
 test(`fresh live access survives overlapping ${first}-first authorization`,async()=>{
  let hold=false,loads=0,requests=0;const pending:Array<(value:unknown)=>void>=[];
  const client=createPersonalProviderClient({loadBootstrap:()=>{loads++;return hold?new Promise(resolve=>pending.push(resolve)):Promise.resolve({...bootstrap});},fetch:async raw=>{
   requests++;const action=new URL(String(raw)).searchParams.get('action');return new Response(JSON.stringify(action==='get_live_categories'?[]:[{stream_id:7,name:'Channel',container_extension:'m3u8'}]));
  }});
  const liveRef={source:'personal',sourceVersion:'v1',kind:'live',id:'7'};
  try{
   await client.catalog('live');hold=true;
   const selection=first==='playback'?client.playback(liveRef):undefined;
   const metadata=client.refreshMetadata();
   const outcomes=Promise.allSettled([selection??client.playback(liveRef),metadata]);
   for(const resolve of pending)resolve({...bootstrap,expiresAt:'2031-01-01T00:00:00Z'});
   const results=await outcomes;
   assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled'],'a background refresh must not supersede valid playback authorization');
   assert.equal(loads,2,'overlapping fresh authorization must share one request');assert.equal(requests,2,'verified live membership must remain cached');
   assert.deepEqual((results[0] as PromiseFulfilledResult<unknown>).value,{url:'https://provider.test/live/u%2Fa/p%3F%23/7.m3u8',expiresAt:'2031-01-01T00:00:00Z'});
  }finally{client.clear();}
 });
}

test('fresh playback cannot join a cached nonforced bootstrap',async()=>{
 let loads=0;let current={...bootstrap};
 const client=createPersonalProviderClient({loadBootstrap:async()=>{loads++;return {...current};},fetch:async raw=>new Response(JSON.stringify(new URL(String(raw)).searchParams.get('action')==='get_live_categories'?[]:[{stream_id:7,name:'Channel'}]))});
 try{
  await client.catalog('live');current={...bootstrap,expiresAt:'2031-01-01T00:00:00Z'};
  const cached=client.catalog('live');const selection=client.playback({source:'personal',sourceVersion:'v1',kind:'live',id:'7'});
  await cached;assert.equal((await selection).expiresAt,'2031-01-01T00:00:00Z');assert.equal(loads,2);
 }finally{client.clear();}
});

test('clear invalidates all shared fresh callers before a replacement account can authorize',async()=>{
 let hold=false,requests=0;let current={...bootstrap};const pending:Array<{resolve:(value:unknown)=>void;signal:AbortSignal}>=[];
 const client=createPersonalProviderClient({loadBootstrap:signal=>hold?new Promise(resolve=>pending.push({resolve,signal})):Promise.resolve({...current}),fetch:async raw=>{
  requests++;const url=new URL(String(raw));return new Response(JSON.stringify(url.searchParams.get('action')==='get_live_categories'?[]:[{stream_id:url.searchParams.get('username')==='replacement'?8:7,name:'Channel'}]));
 }});
 try{
  await client.catalog('live');hold=true;
  const old=Promise.allSettled([client.playback({source:'personal',sourceVersion:'v1',kind:'live',id:'7'}),client.refreshMetadata()]);
  const stale=[...pending];client.clear();
  current={...bootstrap,accountId:'replacement-account',sourceVersion:'v2',username:'replacement'};
  const replacement=client.refreshMetadata();
  for(const call of stale){assert.equal(call.signal.aborted,true);call.resolve({...bootstrap});}
  pending[pending.length-1].resolve({...current});
  assert.deepEqual((await old).map(result=>result.status),['rejected','rejected']);assert.equal((await replacement).accountId,'replacement-account');
  hold=false;await assert.rejects(client.playback({source:'personal',sourceVersion:'v1',kind:'live',id:'7'}));
  assert.equal(requests,2,'the revoked account cannot fetch or reuse its catalog');
  assert.equal((await client.playback({source:'personal',sourceVersion:'v2',kind:'live',id:'8'})).url,'https://provider.test/live/replacement/p%3F%23/8.m3u8');assert.equal(requests,4);
 }finally{client.clear();}
});

test('a shared failed fresh authorization refuses cached access and allows a fresh retry',async()=>{
 let hold=false,loads=0,requests=0;const pending:Array<(error:Error)=>void>=[];
 const client=createPersonalProviderClient({loadBootstrap:()=>{loads++;return hold?new Promise((_,reject)=>pending.push(reject)):Promise.resolve({...bootstrap});},fetch:async raw=>{
  requests++;return new Response(JSON.stringify(new URL(String(raw)).searchParams.get('action')==='get_live_categories'?[]:[{stream_id:7,name:'Channel'}]));
 }});
 try{
  await client.catalog('live');hold=true;
  const liveRef={source:'personal',sourceVersion:'v1',kind:'live',id:'7'};
  const failed=Promise.allSettled([client.playback(liveRef),client.refreshMetadata()]);
  for(const reject of pending)reject(new Error('fresh access denied'));
  assert.deepEqual((await failed).map(result=>result.status),['rejected','rejected']);assert.equal(loads,2);assert.equal(requests,2);
  hold=false;assert.equal((await client.playback(liveRef)).url,'https://provider.test/live/u%2Fa/p%3F%23/7.m3u8');assert.equal(loads,3);assert.equal(requests,2);
 }finally{client.clear();}
});
