export type LiveCatalogQuality = "fhd" | "hd" | "raw" | "unknown" | "sd" | "uhd";
export type LiveChannelDescription = {
  displayName: string; groupKey: string; countryCode: string | null;
  quality: LiveCatalogQuality; hevc: boolean; eventOnly: boolean; lowBandwidth: boolean; raw: boolean;
};
export type CuratableLiveChannel = {
  id: string; title: string; groupTitle?: string | null; sourceTitle?: string; providerId?: string;
  available?: boolean; playbackAllowed?: boolean; lookupFailed?: boolean;
};

const COUNTRIES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const COUNTRY_ALIASES: Record<string, string> = { UK: "GB", USA: "US", TUR: "TR", GER: "DE", FRA: "FR", ITA: "IT", ESP: "ES", POR: "PT", GRE: "GR", NED: "NL", RUS: "RU", BRA: "BR", COL: "CO", KSA: "SA", UAE: "AE" };
const COUNTRY_NAMES: Array<[string, string]> = [
  ["GB", "united kingdom|great britain|britain|england|ingiltere"], ["US", "united states|united states of america|america|abd"],
  ["TR", "turkey|turkiye"], ["DE", "germany|deutschland|almanya"], ["FR", "france|fransa"], ["IT", "italy|italia|italya"],
  ["ES", "spain|espana|ispanya"], ["PT", "portugal|portekiz"], ["BR", "brazil|brasil|brezilya"],
  ["SE", "sweden|sverige|isvec"], ["NO", "norway|norge|norvec"], ["DK", "denmark|danmark|danimarka"], ["FI", "finland|finlandiya"],
  ["NL", "netherlands|nederland|holland|hollanda"], ["BE", "belgium|belgique|belgien|belcika"], ["CH", "switzerland|schweiz|suisse|isvicre"],
  ["AT", "austria|osterreich|avusturya"], ["RU", "russia|rusya"], ["UA", "ukraine|ukrayna"], ["BY", "belarus|beyaz rusya"],
  ["MX", "mexico|meksika"], ["CO", "colombia|kolombiya"], ["CA", "canada|kanada"], ["AU", "australia|avustralya"], ["NZ", "new zealand|yeni zelanda"],
  ["PL", "poland|polska|polonya"], ["RO", "romania|romanya"], ["GR", "greece|ellada|yunanistan"], ["BG", "bulgaria|bulgaristan"],
  ["HU", "hungary|macaristan"], ["HR", "croatia|hirvatistan"], ["RS", "serbia|sirbistan"], ["BA", "bosnia|bosna"], ["AL", "albania|arnavutluk"],
  ["AZ", "azerbaijan|azerbaycan"], ["GE", "georgia|gurcistan"], ["AM", "armenia|ermenistan"], ["CZ", "czech republic|czechia|cekya"],
  ["SK", "slovakia|slovakya"], ["SI", "slovenia|slovenya"], ["MK", "macedonia|makedonya"], ["ME", "montenegro|karadag"], ["MD", "moldova"],
  ["IR", "iran"], ["IQ", "iraq|irak"], ["SA", "saudi arabia|suudi arabistan"], ["AE", "united arab emirates|birlesik arap emirlikleri"],
  ["QA", "qatar|katar"], ["EG", "egypt|misir"], ["IL", "israel|israil"], ["MA", "morocco|fas"], ["TN", "tunisia|tunus"], ["DZ", "algeria|cezayir"],
  ["IN", "india|hindistan"], ["PK", "pakistan"], ["BD", "bangladesh"], ["AF", "afghanistan|afganistan"], ["NP", "nepal"], ["LK", "sri lanka"],
  ["CN", "china|cin"], ["JP", "japan|japonya"], ["KR", "south korea|korea|guney kore"], ["ID", "indonesia|endonezya"], ["MY", "malaysia|malezya"],
  ["SG", "singapore|singapur"], ["TH", "thailand|tayland"], ["VN", "vietnam"], ["PH", "philippines|filipinler"],
  ["ZA", "south africa|guney afrika"], ["NG", "nigeria|nijerya"], ["KE", "kenya"], ["GH", "ghana"],
  ["AR", "argentina|arjantin"], ["CL", "chile|sili"], ["PE", "peru"], ["VE", "venezuela|venezüella"], ["EC", "ecuador|ekvador"],
  ["UY", "uruguay"], ["PY", "paraguay"], ["BO", "bolivia|bolivya"], ["CR", "costa rica"], ["PA", "panama"], ["DO", "dominican republic|dominik cumhuriyeti"],
  ["IE", "ireland|irlanda"], ["IS", "iceland|izlanda"], ["EE", "estonia|estonya"], ["LV", "latvia|letonya"], ["LT", "lithuania|litvanya"],
  ["CY", "cyprus|kibris"], ["MT", "malta"], ["UZ", "uzbekistan|ozbekistan"], ["KZ", "kazakhstan|kazakistan"], ["KG", "kyrgyzstan|kirgizistan"],
  ["TJ", "tajikistan|tacikistan"], ["TM", "turkmenistan"]
];
const SMALLCAPS: Record<string, string> = { "ꜰ": "F", "ʜ": "H", "ᴅ": "D", "ᴇ": "E", "ᴠ": "V", "ᴄ": "C", "ʀ": "R", "ᴀ": "A", "ᴡ": "W", "ꜱ": "S", "ᴘ": "P", "ᴛ": "T", "ɪ": "I", "ɴ": "N", "ᴏ": "O", "ᴜ": "U", "ʟ": "L", "ᴋ": "K", "ᴍ": "M", "ʙ": "B", "ɢ": "G", "ᴊ": "J" };
const QUALITIES: LiveCatalogQuality[] = ["fhd", "hd", "raw", "unknown", "sd", "uhd"];
const FHD = /\b(?:fhd|full[\s_-]*hd|1080[pi])\b/i;
const UHD = /\b(?:4k|uhd|2160[pi]?)\b/i;
const SD = /\b(?:sd|480[pi]?|576[pi]?)\b/i;
const HEVC = /\b(?:hevc|h[.\s_-]?265|x265)\b/i;
const EVENT = /\b(?:macta(?:\s+aktif)?|sadece\s+(?:ist(?:anbul)?[.\s]*)?mac(?:lari)?|mac(?:lar)?\s*(?:zamani|saatinde|gunu|aktif)|yayin\s*(?:zamani|sirasinda)\s*(?:aktif|acik)?|event[\s_-]*only|live[\s_-]*events?[\s_-]*only|only\s+(?:during\s+)?events?|only\s+matches|matches\s+only)\b/i;
const LOW = /\b(?:kota\s*dostu|low(?:\s+(?:bitrate|bandwidth))?|dusuk(?:\s+(?:bitrate|bant))?)\b/i;
const TECHNICAL = /\b(?:full[\s_-]*hd|fhd|1080[pi]|720[pi]?|480[pi]?|576[pi]?|2160[pi]?|4k|uhd|hd|sd|raw|hevc|h[.\s_-]?26[45]|x26[45]|avc|mpeg[\s_-]*ts|m3u8|hls|(?:25|30|50|60|100|120)\s*(?:fps|hz)|\d+(?:[.,]\d+)?\s*(?:kbps|mbps|mbit))\b/gi;
const EVENT_DISPLAY = /(?:ma[çc]ta(?:\s+akt[iıİ]f)?|sadece\s+(?:[iıİ]st(?:anbul)?[.\s]*)?ma[çc](?:lar[ıi])?|ma[çc](?:lar)?\s*(?:zaman[ıi]|saat[iıİ]nde|g[üu]n[üu]|akt[iıİ]f)|yay[ıi]n\s*(?:zaman[ıi]|s[ıi]ras[ıi]nda)\s*(?:akt[iıİ]f|a[çc][ıi]k)?|event[\s_-]*only|live[\s_-]*events?[\s_-]*only|only\s+(?:during\s+)?events?|only\s+matches|matches\s+only)/giu;
const LOW_DISPLAY = /\b(?:kota\s*dostu|low(?:\s+(?:bitrate|bandwidth))?|d[üu][şs][üu]k(?:\s+(?:bitrate|bant))?)\b/giu;
const LANGUAGE_PATTERNS: Array<[string, RegExp]> = [
  ["ar", /\b(?:arabic|arapca)\b/], ["de", /\b(?:german|deutsch|almanca)\b/],
  ["en", /\b(?:english|ingilizce|eng)\b/], ["es", /\b(?:spanish|espanol|ispanyolca)\b/],
  ["fr", /\b(?:french|francais|fransizca)\b/], ["it", /\b(?:italian|italiano|italyanca)\b/],
  ["ku", /\b(?:kurdish|kurtce)\b/], ["pt", /\b(?:portuguese|portugues|portekizce)\b/],
  ["ru", /\b(?:russian|rusca)\b/], ["tr", /\b(?:turkish|turkce)\b/]
];

function smallcaps(value: string): string { return value.normalize("NFKC").replace(/[ꜰʜᴅᴇᴠᴄʀᴀᴡꜱᴘᴛɪɴᴏᴜʟᴋᴍʙɢᴊ]/g, character => SMALLCAPS[character]); }
function folded(value: string): string { return smallcaps(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").toLowerCase(); }
function country(value: string): string | null { const code = value.toUpperCase(); return COUNTRY_ALIASES[code] ?? (COUNTRIES.has(code) ? code : null); }
function prefix(value: string): { countryCode: string | null; quality: string; rest: string } {
  const compound = /^([a-z]{2,3}?)\s*(fhd|fullhd|hd|sd|uhd|4k|1080[pi]|720p)(?:\s*[•·|:\-]+\s*|\s+)/i.exec(value);
  if (compound && country(compound[1])) return { countryCode: country(compound[1]), quality: compound[2], rest: value.slice(compound[0].length) };
  const regular = /^([a-z]{2,3})\s*[•·|:\-]+\s*/i.exec(value);
  return regular && country(regular[1]) ? { countryCode: country(regular[1]), quality: "", rest: value.slice(regular[0].length) } : { countryCode: null, quality: "", rest: value };
}
function groupCountry(value: string): string | null {
  const known = prefix(value).countryCode;
  if (known) return known;
  const leading = /^([a-z]{2,3})(?:\s|$)/i.exec(value);
  const code = leading ? country(leading[1]) : null;
  if (code) return code;
  const normalized = folded(value).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  for (const [countryCode, names] of COUNTRY_NAMES) for (const name of names.split("|")) if (normalized === name || normalized.startsWith(`${name} `)) return countryCode;
  return null;
}
function removableNote(value: string): boolean {
  const normalized = folded(value).trim();
  if (/^(?:fubotv|fibra|sat|orange|live\s*events?)$/.test(normalized) || EVENT.test(normalized) || LOW.test(normalized)) return true;
  return Boolean(normalized) && !normalized.replace(TECHNICAL, " ").replace(/\b7\s*[/x]\s*24(?:\s+canli)?\b/g, " ").replace(/[\s.,:;_\-/]+/g, "");
}
function canonicalBrand(value: string, sportsContext: boolean): string {
  let result = value.replace(/^be[iıİ]n\s*sports?\s*(?=\d|MAX\b|PLUS\b|$)/iu, "BEIN Sport ")
    .replace(/^s\s*sport\s*(?=\d|MAX\b|PLUS\b|$)/i, "S Sport ");
  const compact = folded(result).replace(/\s+/g, "");
  const brands: Record<string, string> = { aspor: "A Spor", trtspor: "TRT Spor", kanald: "Kanal D", beyaztv: "Beyaz TV", tv8: "TV8", "tv8.5": "TV8.5", halktv: "Halk TV", ahaber: "A Haber" };
  if (brands[compact]) return brands[compact];
  if (/^atv$/i.test(result.trim())) return "ATV";
  if (/^360\s*(?:tv)?$/i.test(result.trim())) return "360";
  const exxen = /^exxen\s*(sport\s*)?(\d+)(.*)$/i.exec(result.trim());
  if (exxen && (exxen[1] || sportsContext)) result = `EXXEN Sport ${exxen[2]}${exxen[3]}`;
  return result.replace(/\s+/g, " ").trim();
}

export function describeLiveChannel(title: string, groupTitle?: string | null): LiveChannelDescription {
  const original = smallcaps(title ?? "").replace(/<br\s*\/?\s*>/gi, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
  const withoutDistributionPrefix = original.replace(/^\s*\[\s*fubotv\s*\]\s*/i, "")
    .replace(/\b(fhd|uhd|hevc|hd|sd)(?=7\s*\/\s*24)/gi, "$1 ").replace(/(7\s*\/\s*24)(?=canl[ıi])/giu, "$1 ");
  const titlePrefix = prefix(withoutDistributionPrefix);
  const countryFromGroup = groupCountry(smallcaps(groupTitle ?? ""));
  const countryCode = titlePrefix.countryCode ?? countryFromGroup;
  const analysis = folded(`${titlePrefix.quality} ${titlePrefix.rest}`);
  const hevc = HEVC.test(analysis), raw = /\braw\b/.test(analysis);
  const quality: LiveCatalogQuality = UHD.test(analysis) ? "uhd" : SD.test(analysis) ? "sd"
    : /\b720[pi]?\b/.test(analysis) ? "hd" : FHD.test(analysis) ? "fhd"
      : /\bhd\b/.test(analysis) ? "hd" : raw ? "raw" : "unknown";
  let displayName = titlePrefix.rest.replace(/\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}/g, (match, square, round, curly) => removableNote(square ?? round ?? curly ?? "") ? " " : match)
    .replace(/^VIP\s+(?=be[iıİ]n\s*sports?|s\s*sport|exxen\b)/iu, "");
  const branded4k = /^\s*(trt|bein\s*sports?)\s*4k(?:\s|$)/i.exec(displayName);
  displayName = displayName.replace(EVENT_DISPLAY, " ").replace(LOW_DISPLAY, " ").replace(TECHNICAL, " ")
    .replace(/\b7\s*[/x]\s*24(?:\s+canl[ıi])?\b/giu, " ").replace(/\b(?:canl[ıi]\s*yay[ıi]n|canl[ıi])\s*$/giu, " ")
    .replace(/^[\s•·|:\-]+|[\s•·|:\-]+$/g, "").replace(/\s+/g, " ").trim();
  displayName = canonicalBrand(displayName, /\b(?:spor|sport|sports)\b/.test(folded(groupTitle ?? "")));
  if (branded4k && /^(?:trt|bein\s*sport)$/i.test(displayName)) displayName = /^trt$/i.test(displayName) ? "TRT 4K" : "BEIN Sport 4K";
  const languageText = folded(`${displayName} ${groupTitle ?? ""}`);
  const languages = LANGUAGE_PATTERNS.filter(([, expression]) => expression.test(languageText)).map(([code]) => code);
  const normalizedName = folded(displayName).replace(/[’'`\"]/g, "").replace(/[^\p{L}\p{N}+\s]/gu, " ").replace(/\s+/g, " ").trim();
  const conflict = titlePrefix.countryCode && countryFromGroup && titlePrefix.countryCode !== countryFromGroup ? `!${countryFromGroup}` : "";
  const unknownScope = folded(groupTitle ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return { displayName, groupKey: `${countryCode ?? `unknown:${unknownScope}`}${conflict}|${languages.join(",")}|${normalizedName}`, countryCode, quality, hevc, eventOnly: EVENT.test(analysis) || /[\[({]\s*live\s*events?\s*[\])}]/i.test(analysis), lowBandwidth: LOW.test(analysis), raw };
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function compareId(left: string, right: string): number {
  if (/^[0-9]+$/.test(left) && /^[0-9]+$/.test(right)) {
    const a = left.replace(/^0+(?=\d)/, ""), b = right.replace(/^0+(?=\d)/, "");
    return a.length - b.length || compareText(a, b) || compareText(left, right);
  }
  return compareText(left, right);
}
type Candidate<T> = { row: T; sourceTitle: string; description: LiveChannelDescription };
function compareCandidates<T extends CuratableLiveChannel>(left: Candidate<T>, right: Candidate<T>): number {
  const a = left.description, b = right.description;
  return Number(a.hevc) - Number(b.hevc) || QUALITIES.indexOf(a.quality) - QUALITIES.indexOf(b.quality)
    || Number(a.eventOnly) - Number(b.eventOnly) || Number(a.lowBandwidth) - Number(b.lowBandwidth) || Number(a.raw) - Number(b.raw)
    || compareId(left.row.providerId ?? left.row.id, right.row.providerId ?? right.row.id) || compareText(left.row.id, right.row.id)
    || compareText(left.sourceTitle, right.sourceTitle) || compareText(left.row.groupTitle ?? "", right.row.groupTitle ?? "");
}

export function curateLiveChannels<T extends CuratableLiveChannel>(rows: readonly T[], excludedIds: ReadonlySet<string> = new Set()): { items: Array<T & { sourceTitle: string }>; canonicalById: Map<string, string> } {
  const groups = new Map<string, Array<Candidate<T>>>();
  for (const row of rows) {
    if (excludedIds.has(row.id) || (row.providerId && excludedIds.has(row.providerId))) continue;
    const sourceTitle = row.sourceTitle ?? row.title;
    const description = describeLiveChannel(sourceTitle, row.groupTitle);
    if (!description.displayName || !description.groupKey.split("|").at(-1)) continue;
    const bucket = groups.get(description.groupKey) ?? [];
    bucket.push({ row, sourceTitle, description }); groups.set(description.groupKey, bucket);
  }
  const items: Array<T & { sourceTitle: string }> = [], canonicalById = new Map<string, string>();
  for (const [, bucket] of [...groups.entries()].sort(([a], [b]) => compareText(a, b))) {
    const candidates = bucket.filter(({ row }) => row.available !== false && row.playbackAllowed !== false && !row.lookupFailed).sort(compareCandidates);
    const selected = candidates[0];
    if (!selected) continue;
    items.push({ ...selected.row, title: selected.description.displayName, sourceTitle: selected.sourceTitle });
    for (const { row } of [...bucket].sort((a, b) => compareText(a.row.id, b.row.id))) canonicalById.set(row.id, selected.row.id);
  }
  return { items, canonicalById };
}
