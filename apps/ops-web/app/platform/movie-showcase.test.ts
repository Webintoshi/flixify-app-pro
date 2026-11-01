import { describe, expect, it } from 'vitest';
import { buildMovieShowcase, isActionMovie, isFantasyMovie, isMarvelMovie } from './movie-showcase';
import type { MediaItem } from './types';

const movie=(id:string,title:string,groupTitle='TR | Film Serileri / Box Setler',releaseYear:number|null=2018,posterUrl:string|null='/poster.jpg'):MediaItem=>({id,title,groupTitle,releaseYear,posterUrl,kind:'movie',available:true,playbackAllowed:true,personalRef:{source:'personal',sourceVersion:'fixture',kind:'movie',id,extension:'mp4'}});
describe('real catalog movie collections',()=>{
  it('takes verified 2026 releases from beyond the initial48 and keeps older heroes out',()=>{
    const older=Array.from({length:60},(_,i)=>movie(String(i+1),`Archive ${i}`));
    const current=Array.from({length:15},(_,i)=>movie(String(i+100),`New ${i} (2026)`,'Drama',2026));
    const rows=buildMovieShowcase([...older,...current,movie('300','Conflicting (2026)','Drama',null)]);
    expect(rows.hero.every(x=>x.releaseYear===2026)).toBe(true);
    expect(rows.current.length).toBeGreaterThan(0);expect(rows.current.every(x=>x.releaseYear===2026)).toBe(true);
    expect(rows.hero.length+rows.current.length).toBe(15);expect(rows.hero.map(x=>x.id)).not.toContain('300');
  });
  it('matches genuine franchise aliases without classifying unrelated similarly named films',()=>{
    for(const title of ['Avengers: Endgame (2019)','Yenilmezler: Sonsuzluk Savaşı (2018)','Iron Man (2008)','Örümcek Adam: Eve Dönüş (2017)','Kaptan Amerika (2011)'])expect(isMarvelMovie(movie(title,title))).toBe(true);
    expect(isMarvelMovie(movie('no','Yenilmez - Undisputed (2002)'))).toBe(false);
    expect(isMarvelMovie(movie('no2','The Author (2020)'))).toBe(false);
  });
  it('requires genuine poster artwork for the action rail',()=>{
    const covered=movie('1','Action','TR | Aksiyon - Macera Filmleri',2025);
    const missing=movie('2','No poster','Aksiyon (Yerli)',2025,null);
    expect(isActionMovie(covered)).toBe(true);expect(isActionMovie(missing)).toBe(false);
    expect(buildMovieShowcase([missing,covered]).action).toEqual([covered]);
  });
  it('uses fantasy families and dedicated fantasy categories, not the whole combined sci-fi category',()=>{
    for(const title of ['Harry Potter ve Felsefe Taşı (2001)','Fantastik Canavarlar (2016)','Yüzüklerin Efendisi (2001)','The Lord of the Rings (2001)','Hobbit (2012)','Narnia Günlükleri (2005)'])expect(isFantasyMovie(movie(title,title))).toBe(true);
    expect(isFantasyMovie(movie('alien','Alien (1979)','TR | Bilim Kurgu - Fantastik Filmler'))).toBe(false);
    expect(isFantasyMovie(movie('term','Terminator (1984)','TR | Bilim Kurgu - Fantastik Filmler'))).toBe(false);
    expect(isFantasyMovie(movie('fantasy','A real fantasy film','Fantastik'))).toBe(true);
  });
  it('deduplicates real identities and titles, preserves references and replenishes failed posters',()=>{
    const first=movie('1','Avengers (2012)'),second=movie('2','Thor (2011)'),third=movie('3','Iron Man (2008)');
    const input=[first,{...first,id:'alias',personalRef:{...first.personalRef!,sourceVersion:'other'}},{...first,id:'title-copy',personalRef:undefined},second,third];
    const untouched=JSON.stringify(input);const rows=buildMovieShowcase(input,{failedPosters:new Set(['movie:1']),limit:2});
    expect(rows.marvel).toEqual([second,third]);expect(rows.marvel[0].personalRef).toBe(second.personalRef);
    expect(JSON.stringify(input)).toBe(untouched);
  });
  it('never promotes unavailable, failed or wrong-kind entries or invents popularity metrics',()=>{
    const good=movie('1','Avengers (2012)');const rows=buildMovieShowcase([good,{...movie('2','Thor'),available:false},{...movie('3','Iron Man'),lookupFailed:true},{...movie('4','Spider-Man'),kind:'series'}]);
    expect(rows.marvel).toEqual([good]);expect(Object.keys(rows)).toEqual(['hero','current','marvel','action','fantasy']);expect('views' in rows.marvel[0]).toBe(false);
  });
  it('prefers a real poster on a later playable duplicate instead of losing an eligible action film',()=>{
    const noArt=movie('1','Action duplicate','Aksiyon',2025,null),covered={...movie('2','Action duplicate','Aksiyon',2025),personalRef:{...noArt.personalRef!,id:'2'}};
    expect(buildMovieShowcase([noArt,covered]).action).toEqual([covered]);
    expect(buildMovieShowcase([noArt,{...covered,available:false}]).action).toEqual([]);
  });
  it('keeps a sole real title visible in its collection even when also featured elsewhere',()=>{
    const only=movie('1','New (2026)','Drama',2026);const current=buildMovieShowcase([only]);expect(current.hero).toEqual([only]);expect(current.current).toEqual([only]);
    const action=movie('2','Avengers (2012)','Aksiyon');const shared=buildMovieShowcase([action]);expect(shared.marvel).toEqual([action]);expect(shared.action).toEqual([action]);
  });
  it('preserves distinct non-Latin titles that share a release year',()=>{
    const first=movie('1','镖人：风起大漠 (2026)','Drama',2026),second=movie('2','流浪地球 (2026)','Drama',2026);
    const rows=buildMovieShowcase([first,second]);expect(new Set([...rows.hero,...rows.current].map(x=>x.id))).toEqual(new Set(['1','2']));
  });
});
