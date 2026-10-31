import { describeLiveChannel } from './live-channel-presentation';

type DirectoryChannel = { id?: string; title: string; sourceTitle?: string; groupTitle?: string | null };
export type LiveChannelOrder = readonly [section: number, position: number, name: string, id: string];
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
const fold = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase();
const compact = (value: string) => fold(value).replace(/[^\p{L}\p{N}]/gu, '');

// The national block follows the current Tivibu national directory; other stations remain available below it.
const NATIONAL = ['trt1','kanald','atv','showtv','now','startv','kanal7','tv8','beyaztv','cnbce','diyanettv','a2','teve2','tv85','trt2','360','tlc','dmax','trt4k'];
const NEWS = ['trthaber','cnnturk','ntv','ahaber','haberturk','sozcutv','halktv','tele1','tv100','24','tgrthaber','apara','ekoturk','bloomberght','ulusal1','ulusalkanal'];
const SPORTS = ['beinsport1','beinsport2','beinsport3','beinsport4','beinsport5','beinsportmax1','beinsportmax2','beinsport4k','trtspor','trtsporyildiz','aspor','ssport1','ssport2','tivibuspor','tivibuspor1','tivibuspor2','tivibuspor3','tivibuspor4'];
const KIDS = ['trtcocuk','trtdiyanetcocuk','minikago','minikacocuk','cartoonnetwork','cartoonito','nickelodeon','nickjr','disneychannel','disneyjunior','babyfirst','babytv'];
const DOCS = ['trtbelgesel','nationalgeographic','natgeowild','discoverychannel','discovery','historychannel','history','viasathistory','viasatnature','viasatexplore'];
const MUSIC = ['trtmuzik','kraltv','kralpoptv','number1turk','number1','dreamturk','dreamtv','powerturk','powertv'];
const NAMES: Record<string,string> = { trtbir:'trt1', show:'showtv', nowtv:'now', star:'startv', kanal7tv:'kanal7', tv2:'teve2', tv8int:'tv8int', '24tv':'24', cnnturktv:'cnnturk', trtsporyildiztv:'trtsporyildiz' };
const COUNTRY: Record<string,string> = { TR:'tr', DE:'de', FR:'fr', GB:'gb', US:'us', IT:'it', ES:'es', PT:'pt', BG:'bg', GR:'gr', SE:'se', DK:'dk', RU:'ru', BR:'br', CO:'latam' };
const SECTION: Record<string,number> = { national:0, news:1, sports:2, kids:3, documentary:4, music:5, local:6, themed:7, radio:8 };

function directoryCountry(countryCode: string | null, group: string, originalTitle: string): string {
  if (countryCode && COUNTRY[countryCode]) return COUNTRY[countryCode];
  if (/^(?:arabic|arabia|middle east)(?:\W|$)/.test(group)) return 'arabic';
  if (/^(?:kurdish|ku)(?:\W|$)/.test(group)) return 'kurdish';
  if (/^(?:latin america|latam)(?:\W|$)/.test(group)) return 'latam';
  if (countryCode) return 'other';
  if (/^(?:turkish|turkce|turkiye|turkey)(?:\W|$)/.test(group)) return 'tr';
  const leading = /^(tr|de|fr|uk|gb|us|usa|it|es|pt|bg|gr|se|dk|ru|br|col|ku)(?=[\s•·|:\-])/i.exec(originalTitle.trim());
  const code = leading?.[1].toUpperCase();
  return code ? ({UK:'gb',USA:'us',COL:'latam',KU:'kurdish'}[code] ?? COUNTRY[code] ?? 'other') : 'other';
}

function category(group: string, name: string, title: string): string {
  if (NATIONAL.includes(name)) return 'national';
  if (/radyo|radio/.test(group)) return 'radio';
  if (/muzik|music/.test(group)) return 'music';
  if (/yoresel|yerel|local|regional/.test(group)) return 'local';
  if (/7\s*[/x]\s*24|sinema|cinema|yerli dizi|yabanci dizi|ambiyans/.test(group)) return 'themed';
  const searchable = `${group} ${title}`;
  if (/belgesel|documenta(?:ry|ire)|nature|discovery|nat geo/.test(searchable)) return 'documentary';
  if (/cocuk|kids?|child|cartoon|nick(?:elodeon)?|minika|baby/.test(searchable)) return 'kids';
  if (NEWS.includes(name) || /haber|news|cnn|bbc world|bulten/.test(searchable)) return 'news';
  if (/spor|sport|futbol|football|bein|dazn|nfl|nba|laliga|liga de campeones|eurosport/.test(searchable)) return 'sports';
  return 'national';
}

export function liveChannelDirectoryInfo(channel: DirectoryChannel): { countryId: string; categoryId: string; order: LiveChannelOrder } {
  const originalTitle = channel.sourceTitle ?? channel.title;
  const description = describeLiveChannel(originalTitle, channel.groupTitle);
  const group = fold(channel.groupTitle ?? '');
  const title = fold(description.displayName);
  const key = compact(title), name = NAMES[key] ?? key;
  const categoryId = category(group, name, title);
  const known = ({national:NATIONAL,news:NEWS,sports:SPORTS,kids:KIDS,documentary:DOCS,music:MUSIC} as Record<string,string[]>)[categoryId];
  const index = known?.indexOf(name) ?? -1;
  return {
    countryId: directoryCountry(description.countryCode, group, originalTitle), categoryId,
    order: [SECTION[categoryId] ?? 9, index < 0 ? 1000 : index, description.displayName, channel.id ?? '']
  };
}

export function compareLiveChannelOrder(a: LiveChannelOrder, b: LiveChannelOrder): number {
  return a[0]-b[0] || a[1]-b[1] || collator.compare(a[2],b[2]) || collator.compare(a[3],b[3]);
}

export function normalizeLiveChannelSearch(value: string): string {
  return fold(value).replace(/[^\p{L}\p{N}]/gu, '');
}

export function pageLiveChannelCatalog<T extends DirectoryChannel>(items: readonly T[], page: number, search = '', group = ''): {items:T[];total:number;groups:Array<{title:string;count:number}>} {
  const groups = new Map<string,number>();
  for (const item of items) if (item.groupTitle) groups.set(item.groupTitle,(groups.get(item.groupTitle) ?? 0)+1);
  const needle = normalizeLiveChannelSearch(search);
  const filtered = items.filter(item=>(!group || item.groupTitle===group) && (!needle || normalizeLiveChannelSearch(`${item.title} ${item.groupTitle ?? ''}`).includes(needle)));
  const ranked = filtered.map(channel=>({channel,...liveChannelDirectoryInfo(channel)}));
  ranked.sort((a,b)=> Number(b.countryId==='tr')-Number(a.countryId==='tr') || (a.countryId==='tr' ? compareLiveChannelOrder(a.order,b.order) : 0));
  return {items:ranked.slice((page-1)*48,page*48).map(item=>item.channel),total:ranked.length,groups:[...groups].map(([title,count])=>({title,count}))};
}
