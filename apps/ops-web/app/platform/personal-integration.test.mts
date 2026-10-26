import {test} from 'node:test';
import assert from 'node:assert/strict';
import integration from './personal-integration.ts';
const {hydratePersonalFavorites,hydratePersonalWatched,pagePersonalCatalog,personalPlayback,sessionIdentity} = integration;
const ref={source:'personal' as const,sourceVersion:'line-a',kind:'movie' as const,id:'1'};
test('favorites retain missing line as unavailable and cannot rebind numeric IDs',()=>{
 const items=[{id:'personal:line-b:movie:1',title:'new',kind:'movie' as const,personalRef:{...ref,sourceVersion:'line-b'}}];
 const [missing]=hydratePersonalFavorites([ref],items); assert.equal(missing.available,false);assert.equal(missing.title,'Kullanılamayan favori');assert.equal(missing.personalRef?.sourceVersion,'line-a');
});
test('filtered pagination and groups derive from current provider catalog',()=>{
 const items=Array.from({length:70},(_,n)=>({id:String(n),title:'İçerik '+n,kind:'movie' as const,groupTitle:n%2?'A':'B'}));
 assert.equal(pagePersonalCatalog(items,2,'içerik').items.length,22);assert.equal(pagePersonalCatalog(items,1,'','A').total,35);assert.equal(pagePersonalCatalog(items,1).groups?.length,2);
});
test('watched matches line, parent and provider episode only',()=>{
 const epRef={...ref,kind:'episode' as const,seriesId:'7'};
 const ep={id:'ep',title:'ep',seasonNumber:1,episodeNumber:1,playbackAllowed:true,personalRef:epRef};
 assert.equal(hydratePersonalWatched([{...epRef,seriesId:'8'}],[ep]).size,0);assert.deepEqual([...hydratePersonalWatched([epRef],[ep])],['ep']);
});
test('playback derives actual path and keeps absolute expiry, rejecting unsupported paths',()=>{
 const expiresAt=new Date(Date.now()+60000).toISOString();
 assert.equal(personalPlayback({url:'https://example.test/movie/u/p/1.m3u8?x=.mp4',expiresAt}).transport,'hls');
 assert.equal(personalPlayback({url:'https://example.test/movie/u/p/1.mkv',expiresAt}).expiresAt,expiresAt);
 for(const ext of ['avi','ts','mp4/else']) assert.throws(()=>personalPlayback({url:'https://example.test/1.'+ext,expiresAt}));
 assert.throws(()=>personalPlayback({url:'https://example.test/1.mp4',expiresAt},Date.now()+120000));
});
test('token refresh keeps identity but account changes replace it',()=>{
 const token=(sub:string,n:number)=>'x.'+btoa(JSON.stringify({sub,n}))+'.y';
 assert.equal(sessionIdentity({accessToken:token('a',1)}),sessionIdentity({accessToken:token('a',2)}));assert.notEqual(sessionIdentity({accessToken:token('a',1)}),sessionIdentity({accessToken:token('b',1)}));
});
test('detail query resolves only exact current namespaced item and loads current parent',async()=>{
 const current={id:'personal:line-a:series:7',title:'Show',kind:'series' as const,personalRef:{...ref,kind:'series' as const,id:'7'}};
 let detailCalls=0;
 const provider={catalog:async()=>[current],series:async()=>{detailCalls++;return {...current,seasons:[]};}};
 const {resolvePersonalDetail}=integration;
 await assert.rejects(()=>resolvePersonalDetail(provider as any,'7','series'));
 await assert.rejects(()=>resolvePersonalDetail(provider as any,'personal:line-b:series:7','series'));
 assert.equal(detailCalls,0);assert.equal((await resolvePersonalDetail(provider as any,current.id,'series')).id,current.id);assert.equal(detailCalls,1);
});
test('start retry and next each obtain a new provider playback record',async()=>{
 let calls=0;const provider={playback:async(value:any)=>{calls++;return {url:'https://provider.test/movie/u/p/'+value.id+'.mp4',expiresAt:new Date(Date.now()+60000-calls*1000).toISOString()};}};
 const {requestPersonalPlayback}=integration;
 const start=await requestPersonalPlayback(provider as any,ref);
 const retry=await requestPersonalPlayback(provider as any,ref);
 const next=await requestPersonalPlayback(provider as any,{...ref,id:'2'});
 assert.equal(calls,3);assert.notEqual(start.expiresAt,retry.expiresAt);assert.notEqual(next.url,retry.url);
 await assert.rejects(()=>requestPersonalPlayback(provider as any,undefined));assert.equal(calls,3);
});
test('late bootstrap cannot publish an older line or revive a cleared UI identity',async()=>{
 const {createScopedBootstrapLoader}=integration;
 const pending:Array<(value:any)=>void>=[];const published:string[]=[];let active=true;
 const loader=createScopedBootstrapLoader(()=>new Promise(resolve=>pending.push(resolve)),value=>published.push(value.sourceVersion),()=>active);
 const bootstrap={accountId:'a',sourceVersion:'a',providerOrigin:'https://provider.test',username:'u',password:'p',expiresAt:'2030-01-01T00:00:00Z',moviePolicy:'general-audience-only'};
 const first=loader(new AbortController().signal);const firstRejected=assert.rejects(()=>first);
 const second=loader(new AbortController().signal);pending[1]({...bootstrap,sourceVersion:'b'});await second;
 pending[0](bootstrap);await firstRejected;assert.deepEqual(published,['b']);
 const third=loader(new AbortController().signal);active=false;pending[2](bootstrap);await assert.rejects(()=>third);assert.deepEqual(published,['b']);
});
test('failed optimistic completion preserves later hydrated confirmation',()=>{
 const {createWatchedState,updateWatchedState,watchedIds}=integration;
 let state=createWatchedState([]);
 state=updateWatchedState(state,{type:'begin',id:'ep',attempt:1});
 assert.equal(watchedIds(state).has('ep'),true);
 state=updateWatchedState(state,{type:'hydrate',ids:['ep']});
 state=updateWatchedState(state,{type:'failure',id:'ep',attempt:1});
 assert.equal(watchedIds(state).has('ep'),true);
 assert.equal(state.optimistic.has('ep'),false);
 let unconfirmed=updateWatchedState(createWatchedState([]),{type:'begin',id:'ep',attempt:1});
 unconfirmed=updateWatchedState(unconfirmed,{type:'failure',id:'ep',attempt:1});
 assert.equal(watchedIds(unconfirmed).has('ep'),false);
 let saved=updateWatchedState(createWatchedState([]),{type:'begin',id:'ep',attempt:1});
 saved=updateWatchedState(saved,{type:'success',id:'ep',attempt:1});
 saved=updateWatchedState(saved,{type:'hydrate',ids:[]});
 assert.equal(watchedIds(saved).has('ep'),true);
 let newer=updateWatchedState(createWatchedState([]),{type:'begin',id:'ep',attempt:1});
 newer=updateWatchedState(newer,{type:'begin',id:'ep',attempt:2});
 newer=updateWatchedState(newer,{type:'failure',id:'ep',attempt:1});
 assert.equal(watchedIds(newer).has('ep'),true);
});
