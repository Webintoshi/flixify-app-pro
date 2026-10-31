import {describe,it,expect} from 'vitest';
import {liveChannelDirectoryInfo,compareLiveChannelOrder, normalizeLiveChannelSearch, pageLiveChannelCatalog} from './live-channel-lineup';

const row=(id:string,title:string,groupTitle='TR:ULUSAL')=>({id,title,groupTitle});
const ordered=(rows:ReturnType<typeof row>[])=>rows.map(channel=>({channel,...liveChannelDirectoryInfo(channel)})).sort((a,b)=>compareLiveChannelOrder(a.order,b.order)).map(value=>value.channel);

describe('Turkish TV directory order',()=>{
 it('ranks RAW TRT1 by its station identity and keeps region and numbered brands separate',()=>{
  const original=[row('music','AAA','TR:MUZIK'),row('atv-eu','ATV Avrupa'),row('star','TR • Star Tv FHD'),row('trt4','TR • TRT 4K'),row('raw','TR • Trt 1 RAW','TR:RAW'),row('atv','ATV'),row('tv85','TV8.5'),row('tv8','TV8')];
  const result=ordered(original);
  expect(result.map(x=>x.id)).toEqual(['raw','atv','star','tv8','tv85','trt4','atv-eu','music']);
  expect(original[0].id).toBe('music');expect(result.find(x=>x.id==='raw')).toBe(original[4]);
 });
 it('groups news, sports, kids and documentaries before radio and themed loops with natural numeric order',()=>{
  const rows=[row('radio','AAA','TR:RADIO'),row('themed','AAA','TR:7/24 YERLI DIZI'),row('local','AAA','TR:YORESEL TV'),row('music','AAA','TR:MUZIK'),row('doc','TRT Belgesel','TR:BELGESEL'),row('kids','TRT Çocuk','TR:COCUK'),row('sports-10','BEIN Sport 10','TR:SPOR'),row('sports-2','BEIN Sport 2','TR:SPOR'),row('sports-1','BEIN Sport 1','TR:SPOR'),row('news','TRT Haber','TR:HABER')];
  expect(ordered(rows).map(x=>x.id)).toEqual(['news','sports-1','sports-2','sports-10','kids','doc','music','local','themed','radio']);
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
