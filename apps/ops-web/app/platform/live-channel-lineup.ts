import { describeLiveChannel } from './live-channel-presentation';

type DirectoryChannel = { id?: string; title: string; sourceTitle?: string; groupTitle?: string | null };
export type LiveChannelOrder = readonly [section: number, position: number, name: string, id: string];
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
const fold = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase();
const compact = (value: string) => fold(value).replace(/[^\p{L}\p{N}]/gu, '');

// These sets describe the friendly filters; reference positions below do not change those categories.
const NATIONAL = ['trt1','kanald','atv','showtv','now','startv','kanal7','tv8','beyaztv','cnbce','diyanettv','a2','teve2','tv85','trt2','360','tlc','dmax','trt4k'];
const NEWS = ['trthaber','cnnturk','ntv','ahaber','haberturk','sozcutv','halktv','tele1','tv100','24','tgrthaber','apara','ekoturk','bloomberght','ulusal1','ulusalkanal'];
const NAMES: Record<string,string> = { trtbir:'trt1', show:'showtv', nowtv:'now', star:'startv', kanal7tv:'kanal7', tv2:'teve2', tv8int:'tv8int', '24tv':'24', cnnturktv:'cnnturk', trtsporyildiztv:'trtsporyildiz' };
const COUNTRY: Record<string,string> = { TR:'tr', DE:'de', FR:'fr', GB:'gb', US:'us', IT:'it', ES:'es', PT:'pt', BG:'bg', GR:'gr', SE:'se', DK:'dk', RU:'ru', BR:'br', CO:'latam' };

// Official TV+ positions checked 2026-10-31. Missing stations never create placeholder rows.
// https://tvplus.com.tr/destek/sss/tvplus-kanallari
const referenceNames: readonly (readonly [number,string])[] = [
  [1, "TV+ Keşfet Aksiyon"],
  [2, "TV+ Keşfet Drama"],
  [3, "FX"],
  [7, "tabii TV"],
  [9, "SİNEMA YERLİ"],
  [10, "SİNEMA TV"],
  [11, "SİNEMA TV AKSİYON"],
  [12, "SİNEMA KOMEDİ"],
  [13, "SİNEMA AİLE"],
  [14, "SİNEMA TV 1001"],
  [15, "SİNEMA YERLİ 2"],
  [16, "SİNEMA TV 2"],
  [17, "SİNEMA AKSİYON 2"],
  [18, "SİNEMA AİLE 2"],
  [19, "SİNEMA 1002"],
  [20, "COSMO EN"],
  [21, "TRT1"],
  [22, "KANAL D"],
  [23, "STAR TV"],
  [24, "ATV"],
  [25, "SHOW TV"],
  [26, "NOW"],
  [27, "TV8"],
  [28, "360"],
  [29, "A2"],
  [30, "TLC"],
  [31, "CNBC-E"],
  [32, "TV2"],
  [34, "KANAL 7"],
  [36, "BEYAZ TV"],
  [37, "TV100"],
  [38, "FLASH HABER"],
  [39, "DMAX"],
  [40, "BİZİM EV TV"],
  [41, "TV8,5"],
  [42, "GZT TV"],
  [43, "VAV TV"],
  [44, "TRT 2"],
  [45, "TV 4"],
  [46, "AS TV"],
  [47, "EKOL TV"],
  [48, "TURKHABER"],
  [49, "CNN TÜRK"],
  [50, "NTV"],
  [51, "HABERTÜRK"],
  [52, "A HABER"],
  [53, "TRT HABER"],
  [54, "24"],
  [55, "BLOOMBERG HT"],
  [56, "A PARA"],
  [57, "HALK TV"],
  [58, "TELE1"],
  [59, "HABER GLOBAL"],
  [60, "EKOTÜRK"],
  [61, "ÜLKE TV"],
  [62, "TGRT HABER"],
  [63, "TVNET"],
  [64, "AKİT TV"],
  [65, "BENGÜTÜRK"],
  [66, "ULUSAL KANAL"],
  [67, "KRT TV"],
  [68, "TV5"],
  [69, "SÖZCÜ TV"],
  [70, "TRT SPOR"],
  [71, "TRT SPOR YILDIZ"],
  [72, "A SPOR"],
  [73, "HT SPOR"],
  [74, "FB TV"],
  [75, "tabii spor"],
  [77, "S SPORT"],
  [78, "S SPORT 2"],
  [79, "EUROSPORT 1"],
  [80, "EUROSPORT 2"],
  [92, "SPORTS TV"],
  [94, "TV+ Ekstra"],
  [95, "TRT BELGESEL"],
  [96, "TARIH TV"],
  [97, "VIASAT EXPLORE"],
  [98, "NATIONAL GEOGRAPHIC"],
  [99, "BBC EARTH"],
  [100, "VIASAT HISTORY"],
  [101, "DISCOVERY CHANNEL"],
  [104, "NATIONAL GEOGRAPHIC WILD"],
  [105, "LOVE NATURE"],
  [106, "ENGLISH CLUB TV"],
  [118, "BABYTV"],
  [119, "DUCK TV"],
  [120, "DISNEY JUNIOR"],
  [121, "CBEEBIES"],
  [122, "MOONBUG KIDS TV"],
  [123, "CARTOONITO"],
  [125, "Nick JR"],
  [126, "NICKELODEON"],
  [127, "NICKTOONS"],
  [128, "AZOOMEE"],
  [129, "DA VINCI"],
  [130, "CARTOON NETWORK"],
  [131, "TRT ÇOCUK"],
  [132, "MİNİKA ÇOCUK"],
  [133, "MİNİKA GO"],
  [134, "SPACETOON"],
  [135, "TRT DIYANET COCUK"],
  [136, "TRT GENÇ"],
  [137, "CNN International"],
  [138, "BBC News"],
  [139, "Bloomberg"],
  [140, "A NEWS"],
  [141, "TRT World"],
  [142, "AL JAZEERA ENGLISH"],
  [143, "DEUTSCHE WELLE ENGLISH"],
  [144, "FRANCE 24 ENGLISH"],
  [145, "EURONEWS"],
  [146, "AL JAZEERA ARABIC"],
  [147, "FRANCE 24 ARABIC"],
  [148, "SKY NEWS ARABIA"],
  [149, "TV5 MONDE"],
  [170, "NUMBER1 TV"],
  [171, "POWER TV"],
  [172, "DREAM TÜRK"],
  [173, "NUMBER1 TURK"],
  [174, "POWER TURK"],
  [175, "TRT MÜZİK"],
  [177, "NR1 RAP"],
  [179, "TMB TV"],
  [181, "TİVİ6"],
  [182, "TYT TÜRK"],
  [183, "Bi Kanal"],
  [184, "MELTEM TV"],
  [203, "TRT 3"],
  [204, "TRT TÜRK"],
  [205, "TRT ARABI"],
  [206, "TRT AVAZ"],
  [207, "TRT KURDİ"],
  [208, "DİYANET TV"],
  [209, "SEMERKAND"],
  [211, "FM TV"],
  [213, "AL QURAN AL KAREEM"],
  [214, "AL SUNNAH AL NABAWIYAH"],
  [215, "TARIM TV"],
  [216, "ÇİFTÇİ TV"],
  [218, "AGRO TV"],
  [221, "TRT EBA"],
  [248, "KADIRGA TV"],
  [250, "KONTV"],
  [251, "KANAL 23"],
  [253, "KANAL V"],
  [256, "KANAL 26"],
  [260, "KANAL 33"],
  [261, "ON6"],
  [280, "BRT 1"],
  [281, "BRT 2"],
  [282, "KIBRIS GENC TV"],
  [283, "KIBRIS TV"],
  [284, "KANAL T"],
  [285, "KIBRIS ADA TV"],
  [300, "ŞÖMİNE PLUS"],
];
const stationKey = (value:string) => {const key=compact(value);return NAMES[key] ?? key;};
const referencePosition = new Map(referenceNames.map(([position,name])=>[stationKey(name),position]));
const rankAliases = new Map([
  ['Ulusal TV','Ulusal Kanal'],['Sözcü SZC TV','Sözcü TV'],['SZC TV','Sözcü TV'],['S Sport 1','S Sport'],
  ['Nat Geo','National Geographic'],['NatGeo','National Geographic'],['Nat Geo Wild','National Geographic Wild'],['NatGeo Wild','National Geographic Wild'],
  ['Disney JR','Disney Junior'],['Da Vinci Kids','Da Vinci'],['NUMBER 1','NUMBER1 TV'],['Power Türk TV','POWER TURK'],
  ['Tivi6 (Ankaraİç Anadolu)','TİVİ6'],['TRT 3 SPOR','TRT 3'],['TRT 3 TBMM TV','TRT 3'],
  ['Çiftçi Tv (İstanbulMarmara)','ÇİFTÇİ TV'],['KONYA KON TV','KONTV'],
  ['Kanal 23 (ElazığDoğu Anadolu)','KANAL 23'],['ELAZIG Kanal 23','KANAL 23'],
  ['Kanal V (AntalyaAkdeniz)','KANAL V'],['ANTALYA Kanal V','KANAL V'],
  ['Kanal 26 (Eskişehirİç Anadolu)','KANAL 26'],['ON6TV (BursaMarmara)','ON6'],
  ['Sinema Aksiyon','SİNEMA TV AKSİYON'],['Sinema 2','SİNEMA TV 2'],['Sinema 1001','SİNEMA TV 1001']
].map(([source,target])=>[stationKey(source),stationKey(target)]));
const extraBein = ['beinsport1','beinsport2','beinsport3','beinsport4','beinsport5','beinsportmax1','beinsportmax2','beinsport4k'];
function referenceSection(position:number):number {
  if(position<21)return 0;if(position<49)return 1;if(position<70)return 2;if(position<95)return 3;
  if(position<118)return 4;if(position<137)return 5;if(position<170)return 6;if(position<200)return 7;
  if(position<248)return 8;if(position<300)return 9;return 10;
}
function lineupRank(name:string,categoryId:string,group:string):readonly [number,number] {
  const exact=referencePosition.get(rankAliases.get(name) ?? name);
  if(exact!==undefined)return [referenceSection(exact),exact];
  if(name==='trt4k')return [1,44.5];
  if(categoryId==='sports') {
    const bein=extraBein.indexOf(name);
    if(bein>=0)return [3,76+(bein+1)/100];
    if(/^beinsport(?:max|plus)?\d+$/.test(name))return [3,76.9];
    const tivibu=/^tivibusport?(\d+|4k)?$/.exec(name);
    if(tivibu)return [3,84+(tivibu[1]==='4k'?0.9:Number(tivibu[1] ?? 0)/100)];
    if(/^ssportplus\d+$/.test(name))return [3,88.5];
    if(/^exxen(?:sports?)?\d+$/.test(name))return [3,89.5];
    if(/^beinconne?ct|^beinconnet/.test(name))return [3,91.5];
  }
  if(/dini|religio|diyanet/.test(group))return [8,247.5];
  const extras:Record<string,readonly [number,number]>={national:[1,48.9],news:[2,69.9],sports:[3,94.9],documentary:[4,117.9],kids:[5,136.9],music:[7,199.9],local:[9,299.9],themed:[11,1000],radio:[12,1000]};
  return extras[categoryId] ?? [11,1000];
}

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
  const [section,position]=lineupRank(name,categoryId,group);
  return {
    countryId: directoryCountry(description.countryCode, group, originalTitle), categoryId,
    order: [section, position, description.displayName, channel.id ?? '']
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
