import {describe,it,expect} from 'vitest';
import {liveChannelDirectoryInfo,compareLiveChannelOrder, normalizeLiveChannelSearch, pageLiveChannelCatalog} from './live-channel-lineup';

const row=(id:string,title:string,groupTitle='TR:ULUSAL')=>({id,title,groupTitle});
const ordered=(rows:ReturnType<typeof row>[])=>rows.map(channel=>({channel,...liveChannelDirectoryInfo(channel)})).sort((a,b)=>compareLiveChannelOrder(a.order,b.order)).map(value=>value.channel);

describe('Turkish TV directory order',()=>{
 it('ranks RAW TRT1 by its station identity and keeps region and numbered brands separate',()=>{
  const original=[row('music','AAA','TR:MUZIK'),row('atv-eu','ATV Avrupa'),row('star','TR • Star Tv FHD'),row('trt4','TR • TRT 4K'),row('raw','TR • Trt 1 RAW','TR:RAW'),row('atv','ATV'),row('tv85','TV8.5'),row('tv8','TV8')];
  const result=ordered(original);
  expect(result.map(x=>x.id)).toEqual(['raw','star','atv','tv8','tv85','trt4','atv-eu','music']);
  expect(original[0].id).toBe('music');expect(result.find(x=>x.id==='raw')).toBe(original[4]);
 });
 it('groups news, sports, kids and documentaries before radio and themed loops with natural numeric order',()=>{
  const rows=[row('radio','AAA','TR:RADIO'),row('themed','AAA','TR:7/24 YERLI DIZI'),row('local','AAA','TR:YORESEL TV'),row('music','AAA','TR:MUZIK'),row('doc','TRT Belgesel','TR:BELGESEL'),row('kids','TRT Çocuk','TR:COCUK'),row('sports-10','BEIN Sport 10','TR:SPOR'),row('sports-2','BEIN Sport 2','TR:SPOR'),row('sports-1','BEIN Sport 1','TR:SPOR'),row('news','TRT Haber','TR:HABER')];
  expect(ordered(rows).map(x=>x.id)).toEqual(['news','sports-1','sports-2','sports-10','doc','kids','music','local','themed','radio']);
 });
 it.each([
  ['ALB: Tring Turkish','ALBANIA','other'],['French Radio','GERMANY','de'],['English Film','TR:YABANCI DIZI','tr'],['TR • TRT 1','TR:RAW','tr'],['UK • BBC News','UK:NEWS','gb'],['USA: CNN','USA NEWS','us'],['AR: MBC','ARABIC','arabic'],['Kurdistan TV','KURDISH','kurdish']
 ])('uses source country metadata for %s/%s',(title,groupTitle,countryId)=>{
  expect(liveChannelDirectoryInfo(row('fixture',title,groupTitle)).countryId).toBe(countryId);
 });
});

 it('finds lowercase BEIN, accentless names and TRT1 without a space while retaining global groups',()=>{
 const channels=[row('trt','Trt 1','TR:RAW'),row('bein','BEIN Sport 1','TR:BEINSPORT'),row('yesil','Yeşilçam','TR:SINEMA')];
 expect(normalizeLiveChannelSearch('BEIN')).toBe('bein');
 for(const [query,id] of [['trt1','trt'],['bein','bein'],['yesilcam','yesil']]){
  const result=pageLiveChannelCatalog(channels,1,query);expect(result.items.map(x=>x.id)).toEqual([id]);expect(result.total).toBe(1);expect(result.groups).toHaveLength(3);
 }
});

 it('uses TV+ order independently of friendly categories and skips missing reference stations',()=>{
  const channels=[row('kids','TRT Çocuk','TR:COCUK'),row('doc','TRT Belgesel','TR:BELGESEL'),row('sports','TRT Spor','TR:SPOR'),row('cnn','CNN TÜRK','TR:HABER'),row('tv100','TV100','TR:HABER'),row('star','Star TV'),row('atv','ATV'),row('trt','TRT 1','TR:RAW'),row('intl','CNN International','TR:HABER'),row('music','NUMBER1 TV','TR:MUZIK')];
  expect(ordered(channels).map(item=>item.id)).toEqual(['trt','star','atv','tv100','cnn','sports','doc','kids','intl','music']);
  expect(liveChannelDirectoryInfo(channels[4]).categoryId).toBe('news');
  expect(liveChannelDirectoryInfo(channels[8]).categoryId).toBe('news');
  expect(ordered(channels)).toHaveLength(channels.length);expect(new Set(ordered(channels).map(item=>item.id)).size).toBe(channels.length);
 });
 it('groups additional sports inside the sports block without relabeling or inventing stations',()=>{
  const channels=[row('doc','TRT Belgesel','TR:BELGESEL'),row('s2','S Sport 2','TR:SPOR'),row('b2','BEIN Sport 2','TR:SPOR'),row('b1','BEIN Sport 1','TR:SPOR'),row('tivibu','Tivibu Spor 1','TR:SPOR'),row('trt','TRT Spor','TR:SPOR'),row('exxen','EXXEN Sport 1','TR:SPOR')];
  expect(ordered(channels).map(item=>item.id)).toEqual(['trt','b1','b2','s2','tivibu','exxen','doc']);
  expect(ordered(channels).every(item=>channels.includes(item))).toBe(true);
 });
 it('matches reference abbreviations only for ordering and preserves distinct branded channels',()=>{
  const channels=[row('wild','Nat Geo Wild','TR:BELGESEL'),row('natgeo','Nat Geo','TR:BELGESEL'),row('ssport','S Sport 1','TR:SPOR'),row('tv2','Teve 2'),row('tv85','TV8.5'),row('tv8','TV8'),row('trt4','TRT 4K')];
  expect(ordered(channels).map(item=>item.id)).toEqual(['tv8','tv2','tv85','trt4','ssport','natgeo','wild']);
  expect(channels[0].title).toBe('Nat Geo Wild');
 });

 it('keeps equivalent Power Türk names together at the reference music position',()=>{
  const channels=[row('trt','TRT Müzik','TR:MUZIK'),row('power-tv','Power Türk Tv','TR:MUZIK'),row('power','Power Turk','TR:MUZIK')];
  expect(ordered(channels).map(item=>item.id)).toEqual(['power','power-tv','trt']);
 });
 it('groups plural EXXEN sports labels while retaining the original source IDs',()=>{
  const channels=[row('sports-tv','Sports TV','TR:SPOR'),row('exxen-plural','EXXEN SPORTS 1','TR:SPOR'),row('exxen','EXXEN Sport 1','TR:SPOR')];
  expect(ordered(channels).map(item=>item.id)).toEqual(['exxen','exxen-plural','sports-tv']);
 });
 it('does not confuse similarly named movie or series loops with additional sports channels',()=>{
  const channels=[row('loop','EXXEN 1','TR:7/24 YERLI DIZI'),row('movie','BEIN CONNECT Movies','TR:SINEMA'),row('local','Local','TR:YORESEL TV')];
  expect(ordered(channels)[0].id).toBe('local');
  expect(liveChannelDirectoryInfo(channels[0]).categoryId).toBe('themed');
 });
