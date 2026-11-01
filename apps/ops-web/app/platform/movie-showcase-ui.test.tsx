import React,{act}from'react';
import{createRoot,type Root}from'react-dom/client';
import{parseHTML}from'linkedom';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import CatalogPage from'./catalog';
import{clearMovieShowcaseSourceCache}from'./movie-showcase-source';
import*as showcase from'./catalog-showcase';
import type{MediaItem}from'./types';
import homeStyles from'./homepage.module.css';
const state=vi.hoisted(()=>({platform:{}as any,params:new URLSearchParams(),api:vi.fn(),push:vi.fn(),infinite:{}as any}));
vi.mock('./session',()=>({usePlatform:()=>state.platform}));
vi.mock('../../lib/api',()=>({apiRequest:(...args:any[])=>state.api(...args)}));
vi.mock('next/navigation',()=>({useSearchParams:()=>state.params,useRouter:()=>({push:state.push,back:vi.fn(),replace:vi.fn()})}));
vi.mock('next/link',()=>({default:(props:any)=><a{...props}/>}));
vi.mock('./use-infinite-scroll',()=>({useInfiniteScroll:(options:any)=>{state.infinite=options;return()=>{};}}));
vi.mock('./artwork',()=>({Artwork:({item}:any)=><img src={item.posterUrl} alt=""/>,FavoriteButton:()=>null}));
vi.mock('./detail',()=>({Detail:()=>null}));
vi.mock('./adult-movie-toggle',()=>({AdultMovieToggle:()=>null}));
vi.mock('./categories',()=>({CategorySidebar:({onSelect,onClose}:any)=><dialog open><button onClick={()=>{onSelect('Aksiyon');onClose();}}>Select action</button><button onClick={onClose}>Close category</button></dialog>}));
let root:Root,container:HTMLElement;let scope=0;
const movie=(id:string,title:string,groupTitle='Drama',releaseYear=2018):MediaItem=>({id,title,groupTitle,releaseYear,kind:'movie',posterUrl:'/poster.jpg',available:true,playbackAllowed:true,personalRef:{source:'personal',sourceVersion:'fixture',kind:'movie',id,extension:'mp4'}});
const pool=()=>[...Array.from({length:110},(_,i)=>movie(String(i+1),`Archive ${i}`)),...Array.from({length:12},(_,i)=>movie(String(i+200),`New ${i} (2026)`,'Drama',2026)),movie('300','Thor (2011)'),...Array.from({length:21},(_,i)=>movie(String(i+400),`Action ${i}`,'Aksiyon')),movie('500','Harry Potter (2001)','TR | Bilim Kurgu - Fantastik Filmler')];
const settle=async(action=()=>{})=>act(async()=>{action();});
const render=async(props={})=>settle(()=>root.render(<CatalogPage kind="movie"{...props}/>));
const archive=()=>[...container.querySelectorAll('[data-catalog-archive] strong')].map(x=>x.textContent);
const rail=(label:string)=>[...container.querySelectorAll('section')].find(x=>x.querySelector('h2')?.textContent===label)!;
const next=()=>settle(()=>state.infinite.onLoadNext());
beforeEach(()=>{
  clearMovieShowcaseSourceCache();scope++;const dom=parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('Event',dom.window.Event);vi.stubGlobal('HTMLElement',dom.window.HTMLElement);vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  (dom.window.HTMLElement.prototype as any).showModal=function(this:HTMLElement){this.setAttribute('open','');};
  (dom.window.HTMLElement.prototype as any).close=function(this:HTMLElement){this.removeAttribute('open');};
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});window.matchMedia=vi.fn(()=>({matches:false,addEventListener(){},removeEventListener(){}}))as any;
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));state.params=new URLSearchParams();state.push.mockReset();state.api.mockReset().mockResolvedValue({user:{status:'active',hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:'2099-01-01'}}});
  state.platform={session:{accessToken:`fixture-${scope}`},providerMode:'personal',providerScope:`scope-${scope}`,personalProvider:{catalog:vi.fn(async()=>pool())},favorites:[],favoritesReady:true,invalidateFavorites:vi.fn(),reload:vi.fn()};
  container=document.getElementById('root')!;root=createRoot(container);
});
afterEach(async()=>{await settle(()=>root.unmount());vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
describe('movie curation and owned infinite archive',()=>{
  it('reserves the movie hero before the initial catalog arrives and keeps an immediate search click out of playback',async()=>{
    let resolveCatalog!:(items:MediaItem[])=>void;
    state.platform.personalProvider.catalog=vi.fn(()=>new Promise<MediaItem[]>(resolve=>{resolveCatalog=resolve;}));
    await render();
    const placeholder=container.querySelector('[data-movie-hero-loading]')!;
    expect(placeholder).not.toBeNull();expect(placeholder.classList.contains(homeStyles.hero)).toBe(true);
    expect(placeholder.querySelector(`.${homeStyles.poster} [data-artwork-kind="movie"]`)).not.toBeNull();
    expect(placeholder.querySelector(`.${homeStyles.selectors}`)).not.toBeNull();expect(placeholder.querySelector('button')).toBeNull();
    expect(placeholder.nextElementSibling?.querySelector('[data-catalog-search-trigger]')).not.toBeNull();
    await settle(()=>container.querySelector<HTMLButtonElement>('[data-catalog-search-trigger]')!.click());
    expect(document.querySelector('#catalog-search-dialog')).not.toBeNull();expect(state.push).not.toHaveBeenCalled();
    await settle(()=>resolveCatalog(pool()));
    expect(container.querySelector('[data-movie-hero-loading]')).toBeNull();expect(container.querySelector('[data-homepage-hero]')).not.toBeNull();
    expect(document.querySelector('#catalog-search-dialog')).not.toBeNull();expect(state.push).not.toHaveBeenCalled();
  });
  it('keeps a reserved hero through legacy seed loading and replaces it when a genuine 2026 film arrives',async()=>{
    let resolveYear!:(value:unknown)=>void;
    state.platform={...state.platform,providerMode:'legacy',personalProvider:null};
    state.api.mockImplementation(async(path:string)=>{
      if(!path.startsWith('/me/catalog/'))return{user:{status:'active',hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:'2099-01-01'}}};
      const p=new URL(path,'https://fixture.invalid').searchParams;
      if(p.get('search')==='2026')return new Promise(resolve=>{resolveYear=resolve;});
      return{items:p.get('search')?[]:pool().slice(0,48),total:48,groups:[]};
    });
    await render();expect(archive()).toHaveLength(48);expect(container.querySelector('[data-movie-hero-loading]')).not.toBeNull();
    await settle(()=>resolveYear({items:[movie('year','A Real Film (2026)','Drama',2026)],total:1}));
    expect(container.querySelector('[data-movie-hero-loading]')).toBeNull();expect(container.querySelector('[data-homepage-hero]')?.textContent).toContain('A Real Film');
  });
  it('renders four real collections from the full personal pool without another acquisition and retains the48 item vertical archive',async()=>{
    await render();expect([...container.querySelectorAll('h2')].map(x=>x.textContent)).toEqual(['2026 Filmleri','Çok İzlenenler · Marvel','Aksiyon Filmleri','Fantastik Filmler','Tüm Filmler']);
    expect(rail('2026 Filmleri').querySelectorAll('strong').length).toBeGreaterThan(0);expect(rail('Çok İzlenenler · Marvel').textContent).toContain('Thor');expect(rail('Fantastik Filmler').textContent).toContain('Harry Potter');
    expect(archive()).toHaveLength(48);expect(container.textContent).not.toContain('Günün Seçkisi');expect(container.textContent).not.toContain('Daha Fazla Göster');expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
    const first=archive();await next();expect(archive()).toHaveLength(96);expect(archive().slice(0,48)).toEqual(first);
    const play=rail('Çok İzlenenler · Marvel').querySelector('button[aria-label$=" oynat"]')as HTMLButtonElement;await settle(()=>play.click());expect(state.push.mock.calls.at(-1)?.[0]).toContain('item=300');expect(state.push.mock.calls.at(-1)?.[0]).toContain('play=1');
  });
  it('keeps complete personal collections stable without sorting the full pool again when the archive appends',async()=>{
    const ordering=vi.spyOn(showcase,'orderShowcaseCatalog');
    const fullPoolSorts=()=>ordering.mock.calls.filter(([items])=>items.length===pool().length).length;
    const collectionTitles=()=>['2026 Filmleri','Çok İzlenenler · Marvel','Aksiyon Filmleri','Fantastik Filmler'].map(label=>rail(label).textContent);
    await render();const before=fullPoolSorts();const collections=collectionTitles();expect(before).toBeGreaterThan(0);
    await next();expect(archive()).toHaveLength(96);expect(collectionTitles()).toEqual(collections);expect(fullPoolSorts()).toBe(before);
  });
  it('replenishes a failed action image from the owned candidates while leaving the archive intact',async()=>{
    await render();const section=()=>rail('Aksiyon Filmleri');expect(section().querySelectorAll('strong')).toHaveLength(18);const first=section().querySelector('button[aria-label$=" oynat"]')!;const title=first.querySelector('strong')!.textContent;
    await settle(()=>first.querySelector('img')!.dispatchEvent(new Event('error',{bubbles:true})));
    expect([...section().querySelectorAll('strong')].map(x=>x.textContent)).not.toContain(title);expect(section().querySelectorAll('strong')).toHaveLength(18);expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
  });
  it('pauses while a category panel is open and resets the committed page for a new filter',async()=>{
    await render();await next();expect(archive()).toHaveLength(96);
    await settle(()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Kategori: Tümü')!.click());expect(state.infinite.enabled).toBe(false);
    await settle(()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Select action')!.click());
    expect(archive()).toEqual(pool().filter(x=>x.groupTitle==='Aksiyon').map(x=>x.title));expect(container.textContent).not.toContain('Çok İzlenenler · Marvel');expect(state.infinite.hasMore).toBe(false);
  });
  it.each(['empty','repeat'])('stops legacy pagination on a%s page despite a stale larger total',async(mode)=>{
    const rows=pool().slice(0,48);const requests:number[]=[];state.platform={...state.platform,providerMode:'legacy',personalProvider:null};
    state.api.mockImplementation(async(path:string)=>{if(!path.startsWith('/me/catalog/'))return{user:{status:'active',hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:'2099-01-01'}}};const p=new URL(path,'https://fixture.invalid').searchParams;if(p.get('search')||p.get('group'))return{items:[],total:0};const page=Number(p.get('page'));requests.push(page);return{items:page===1||mode==='repeat'?rows:[],total:999,groups:[]};});
    await render();expect(archive()).toHaveLength(48);await settle(()=>{state.infinite.onLoadNext();state.infinite.onLoadNext();});expect(requests).toEqual([1,2]);expect(state.infinite.hasMore).toBe(false);await next();expect(requests).toEqual([1,2]);expect(archive()).toHaveLength(48);
  });
  it('shows an explicit curation retry after all legacy seed queries fail while preserving the loaded archive',async()=>{
    const rows=pool().slice(0,48);let healthy=false;let seedCalls=0;state.platform={...state.platform,providerMode:'legacy',personalProvider:null};
    state.api.mockImplementation(async(path:string)=>{if(!path.startsWith('/me/catalog/'))return{user:{status:'active',hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:'2099-01-01'}}};const p=new URL(path,'https://fixture.invalid').searchParams;if(!p.get('search')&&!p.get('group'))return{items:rows,total:48,groups:[]};seedCalls++;if(!healthy)throw new Error('offline');return{items:p.get('search')==='Thor'?[pool().find(x=>x.id==='300')]:[],total:1};});
    await render();expect(archive()).toHaveLength(48);expect(container.textContent).toContain('Seçkiler yüklenemedi');expect(seedCalls).toBe(10);
    await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(seedCalls).toBe(10);
    healthy=true;await settle(()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='Seçkileri tekrar yükle')!.click());
    expect(container.textContent).not.toContain('Seçkiler yüklenemedi');expect(rail('Çok İzlenenler · Marvel').textContent).toContain('Thor');expect(archive()).toHaveLength(48);
  });
  it('uses a loading message instead of claiming a collection is empty while legacy seeds are pending',async()=>{
    state.platform={...state.platform,providerMode:'legacy',personalProvider:null};
    state.api.mockImplementation(async(path:string,options:any)=>{if(!path.startsWith('/me/catalog/'))return{user:{status:'active',hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:'2099-01-01'}}};const p=new URL(path,'https://fixture.invalid').searchParams;if(!p.get('search')&&!p.get('group'))return{items:pool().slice(0,48),total:48,groups:[]};return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));});
    await render();expect(rail('Çok İzlenenler · Marvel').textContent).toContain('Seçkiler hazırlanıyor');expect(rail('Çok İzlenenler · Marvel').textContent).not.toContain('film henüz bulunmuyor');expect(archive()).toHaveLength(48);
  });
});
