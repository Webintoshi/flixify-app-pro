import test from 'node:test';
import assert from 'node:assert/strict';
import helpers from './personal-live.ts';
const { mapPersonalLive, liveTransport, selectedProgrammes, createLiveRequestScope } = helpers;
test('personal mapping retains namespaced identity and ref without movie filtering', () => {
 const ref = {source:'personal', sourceVersion:'a', kind:'live', id:'12', extension:'ts'} as const;
 const result=mapPersonalLive({id:'personal:a:live:12',title:'BBC',kind:'live',groupTitle:'UK News',posterUrl:null,personalRef:ref});
 assert.equal(result.id,'personal:a:live:12'); assert.equal(result.personalRef,ref); assert.equal(result.transport,'ts'); assert.equal(result.playbackAllowed,true);
});
test('final URL transport ignores query extension',()=> {assert.equal(liveTransport('https://example.com/live/a.ts?x=.m3u8'),'ts');assert.equal(liveTransport('https://example.com/live/a.m3u8'),'hls');});
test('selected schedule excludes ended rows and sorts current before upcoming',()=> {
 const rows=[{title:'future',description:'',start:200,end:300},{title:'past',description:'',start:0,end:100},{title:'now',description:'',start:100,end:200}];
 assert.deepEqual(selectedProgrammes(rows,150).map(r=>r.title),['now','future']);
});
test('account/channel replacement invalidates prior asynchronous results',()=> {const scope=createLiveRequestScope();const old=scope.begin();assert.equal(scope.current(old),true);scope.begin();assert.equal(scope.current(old),false);const next=scope.begin();scope.clear();assert.equal(scope.current(next),false);});
