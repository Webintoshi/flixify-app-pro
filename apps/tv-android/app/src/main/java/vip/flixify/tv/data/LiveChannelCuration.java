package vip.flixify.tv.data;

import java.text.Normalizer;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import vip.flixify.tv.TvModels.*;

/** Java port of packages/contracts/src/live-catalog-curation.ts; shared JSON cases guard parity. */
public final class LiveChannelCuration {
    private LiveChannelCuration() {}
    private static final Set<String> COUNTRIES=new HashSet<>(Arrays.asList(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ")));
    private static final Map<String,String> COUNTRY_ALIASES=new HashMap<>();
    static {for(String pair:"UK:GB USA:US TUR:TR GER:DE FRA:FR ITA:IT ESP:ES POR:PT GRE:GR NED:NL RUS:RU BRA:BR COL:CO KSA:SA UAE:AE".split(" ")){String[] p=pair.split(":");COUNTRY_ALIASES.put(p[0],p[1]);}}
    private static final String[][] COUNTRY_NAMES={{"GB","united kingdom|great britain|britain|england|ingiltere"},{"US","united states|united states of america|america|abd"},{"TR","turkey|turkiye"},{"DE","germany|deutschland|almanya"},{"FR","france|fransa"},{"IT","italy|italia|italya"},{"ES","spain|espana|ispanya"},{"PT","portugal|portekiz"},{"BR","brazil|brasil|brezilya"},{"SE","sweden|sverige|isvec"},{"NO","norway|norge|norvec"},{"DK","denmark|danmark|danimarka"},{"FI","finland|finlandiya"},{"NL","netherlands|nederland|holland|hollanda"},{"BE","belgium|belgique|belgien|belcika"},{"CH","switzerland|schweiz|suisse|isvicre"},{"AT","austria|osterreich|avusturya"},{"RU","russia|rusya"},{"UA","ukraine|ukrayna"},{"BY","belarus|beyaz rusya"},{"MX","mexico|meksika"},{"CO","colombia|kolombiya"},{"CA","canada|kanada"},{"AU","australia|avustralya"},{"NZ","new zealand|yeni zelanda"},{"PL","poland|polska|polonya"},{"RO","romania|romanya"},{"GR","greece|ellada|yunanistan"},{"BG","bulgaria|bulgaristan"},{"HU","hungary|macaristan"},{"HR","croatia|hirvatistan"},{"RS","serbia|sirbistan"},{"BA","bosnia|bosna"},{"AL","albania|arnavutluk"},{"AZ","azerbaijan|azerbaycan"},{"GE","georgia|gurcistan"},{"AM","armenia|ermenistan"},{"CZ","czech republic|czechia|cekya"},{"SK","slovakia|slovakya"},{"SI","slovenia|slovenya"},{"MK","macedonia|makedonya"},{"ME","montenegro|karadag"},{"MD","moldova"},{"IR","iran"},{"IQ","iraq|irak"},{"SA","saudi arabia|suudi arabistan"},{"AE","united arab emirates|birlesik arap emirlikleri"},{"QA","qatar|katar"},{"EG","egypt|misir"},{"IL","israel|israil"},{"MA","morocco|fas"},{"TN","tunisia|tunus"},{"DZ","algeria|cezayir"},{"IN","india|hindistan"},{"PK","pakistan"},{"BD","bangladesh"},{"AF","afghanistan|afganistan"},{"NP","nepal"},{"LK","sri lanka"},{"CN","china|cin"},{"JP","japan|japonya"},{"KR","south korea|korea|guney kore"},{"ID","indonesia|endonezya"},{"MY","malaysia|malezya"},{"SG","singapore|singapur"},{"TH","thailand|tayland"},{"VN","vietnam"},{"PH","philippines|filipinler"},{"ZA","south africa|guney afrika"},{"NG","nigeria|nijerya"},{"KE","kenya"},{"GH","ghana"},{"AR","argentina|arjantin"},{"CL","chile|sili"},{"PE","peru"},{"VE","venezuela|venezüella"},{"EC","ecuador|ekvador"},{"UY","uruguay"},{"PY","paraguay"},{"BO","bolivia|bolivya"},{"CR","costa rica"},{"PA","panama"},{"DO","dominican republic|dominik cumhuriyeti"},{"IE","ireland|irlanda"},{"IS","iceland|izlanda"},{"EE","estonia|estonya"},{"LV","latvia|letonya"},{"LT","lithuania|litvanya"},{"CY","cyprus|kibris"},{"MT","malta"},{"UZ","uzbekistan|ozbekistan"},{"KZ","kazakhstan|kazakistan"},{"KG","kyrgyzstan|kirgizistan"},{"TJ","tajikistan|tacikistan"},{"TM","turkmenistan"}};
    private static final String SMALL="ꜰʜᴅᴇᴠᴄʀᴀᴡꜱᴘᴛɪɴᴏᴜʟᴋᴍʙɢᴊ",LARGE="FHDEVCRAWSPTINOULKMBGJ";
    private static final List<String> QUALITIES=Arrays.asList("fhd","hd","raw","unknown","sd","uhd");
    private static final String BOUNDARY="(?:(?<![A-Za-z0-9_])(?=[A-Za-z0-9_])|(?<=[A-Za-z0-9_])(?![A-Za-z0-9_]))";
    private static final java.util.concurrent.ConcurrentHashMap<String,Pattern> PATTERNS=new java.util.concurrent.ConcurrentHashMap<>();
    private static Pattern pattern(String expression){
        Pattern cached=PATTERNS.get(expression);if(cached!=null)return cached;
        Pattern compiled=Pattern.compile(expression.replace("\\b",BOUNDARY).replace("\\s","[\\s\\p{Z}\\uFEFF]"),Pattern.CASE_INSENSITIVE|Pattern.UNICODE_CASE);
        Pattern previous=PATTERNS.putIfAbsent(expression,compiled);return previous==null?compiled:previous;
    }
    private static final Pattern FHD=pattern("\\b(?:fhd|full[\\s_-]*hd|1080[pi])\\b"),UHD=pattern("\\b(?:4k|uhd|2160[pi]?)\\b"),SD=pattern("\\b(?:sd|480[pi]?|576[pi]?)\\b"),HEVC=pattern("\\b(?:hevc|h[.\\s_-]?265|x265)\\b");
    private static final Pattern EVENT=pattern("\\b(?:macta(?:\\s+aktif)?|sadece\\s+(?:ist(?:anbul)?[.\\s]*)?mac(?:lari)?|mac(?:lar)?\\s*(?:zamani|saatinde|gunu|aktif)|yayin\\s*(?:zamani|sirasinda)\\s*(?:aktif|acik)?|event[\\s_-]*only|live[\\s_-]*events?[\\s_-]*only|only\\s+(?:during\\s+)?events?|only\\s+matches|matches\\s+only)\\b");
    private static final Pattern LOW=pattern("\\b(?:kota\\s*dostu|low(?:\\s+(?:bitrate|bandwidth))?|dusuk(?:\\s+(?:bitrate|bant))?)\\b");
    private static final Pattern TECHNICAL=pattern("\\b(?:full[\\s_-]*hd|fhd|1080[pi]|720[pi]?|480[pi]?|576[pi]?|2160[pi]?|4k|uhd|hd|sd|raw|hevc|h[.\\s_-]?26[45]|x26[45]|avc|mpeg[\\s_-]*ts|m3u8|hls|(?:25|30|50|60|100|120)\\s*(?:fps|hz)|\\d+(?:[.,]\\d+)?\\s*(?:kbps|mbps|mbit))\\b");
    private static final Pattern EVENT_DISPLAY=pattern("(?:ma[çc]ta(?:\\s+akt[iıİ]f)?|sadece\\s+(?:[iıİ]st(?:anbul)?[.\\s]*)?ma[çc](?:lar[ıi])?|ma[çc](?:lar)?\\s*(?:zaman[ıi]|saat[iıİ]nde|g[üu]n[üu]|akt[iıİ]f)|yay[ıi]n\\s*(?:zaman[ıi]|s[ıi]ras[ıi]nda)\\s*(?:akt[iıİ]f|a[çc][ıi]k)?|event[\\s_-]*only|live[\\s_-]*events?[\\s_-]*only|only\\s+(?:during\\s+)?events?|only\\s+matches|matches\\s+only)");
    private static final Pattern LOW_DISPLAY=pattern("\\b(?:kota\\s*dostu|low(?:\\s+(?:bitrate|bandwidth))?|d[üu][şs][üu]k(?:\\s+(?:bitrate|bant))?)\\b");
    private static final String[] LANGUAGE_CODES={"ar","de","en","es","fr","it","ku","pt","ru","tr"};
    private static final Pattern[] LANGUAGES={pattern("\\b(?:arabic|arapca)\\b"),pattern("\\b(?:german|deutsch|almanca)\\b"),pattern("\\b(?:english|ingilizce|eng)\\b"),pattern("\\b(?:spanish|espanol|ispanyolca)\\b"),pattern("\\b(?:french|francais|fransizca)\\b"),pattern("\\b(?:italian|italiano|italyanca)\\b"),pattern("\\b(?:kurdish|kurtce)\\b"),pattern("\\b(?:portuguese|portugues|portekizce)\\b"),pattern("\\b(?:russian|rusca)\\b"),pattern("\\b(?:turkish|turkce)\\b")};
    private static String smallcaps(String value){StringBuilder out=new StringBuilder();for(char c:Normalizer.normalize(value==null?"":value,Normalizer.Form.NFKC).toCharArray()){int i=SMALL.indexOf(c);out.append(i<0?c:LARGE.charAt(i));}return out.toString();}
    private static String folded(String value){return Normalizer.normalize(smallcaps(value),Normalizer.Form.NFKD).replaceAll("[\\u0300-\\u036f]","").replace('ı','i').toLowerCase(Locale.ROOT);}
    private static String join(List<String> values){StringBuilder result=new StringBuilder();for(String value:values){if(result.length()>0)result.append(',');result.append(value);}return result.toString();}
    private static String country(String value){String code=value.toUpperCase(Locale.ROOT);return COUNTRY_ALIASES.containsKey(code)?COUNTRY_ALIASES.get(code):COUNTRIES.contains(code)?code:null;}
    private static final class Prefix {final String country,quality,rest;Prefix(String c,String q,String r){country=c;quality=q;rest=r;}}
    private static Prefix prefix(String value){
        Matcher compound=pattern("^([a-z]{2,3}?)\\s*(fhd|fullhd|hd|sd|uhd|4k|1080[pi]|720p)(?:\\s*[•·|:\\-]+\\s*|\\s+)").matcher(value);
        if(compound.find() && country(compound.group(1))!=null)return new Prefix(country(compound.group(1)),compound.group(2),value.substring(compound.end()));
        Matcher regular=pattern("^([a-z]{2,3})\\s*[•·|:\\-]+\\s*").matcher(value);
        return regular.find() && country(regular.group(1))!=null?new Prefix(country(regular.group(1)),"",value.substring(regular.end())):new Prefix(null,"",value);
    }
    private static String groupCountry(String value){
        String known=prefix(value).country;if(known!=null)return known;
        Matcher leading=pattern("^([a-z]{2,3})(?:\\s|$)").matcher(value);String code=leading.find()?country(leading.group(1)):null;if(code!=null)return code;
        String normalized=pattern("[^\\p{L}\\p{N}\\s]").matcher(folded(value)).replaceAll(" ");normalized=pattern("\\s+").matcher(normalized).replaceAll(" ").trim();
        for(String[] entry:COUNTRY_NAMES)for(String name:entry[1].split("\\|"))if(normalized.equals(name) || normalized.startsWith(name+" "))return entry[0];return null;
    }
    private static boolean removableNote(String value){String n=folded(value).trim();if(n.matches("(?:fubotv|fibra|sat|orange|live\\s*events?)") || EVENT.matcher(n).find() || LOW.matcher(n).find())return true;return !n.isEmpty() && pattern("[\\s.,:;_\\-/]+").matcher(pattern("\\b7\\s*[/x]\\s*24(?:\\s+canli)?\\b").matcher(TECHNICAL.matcher(n).replaceAll(" ")).replaceAll(" ")).replaceAll("").isEmpty();}
    private static String canonicalBrand(String value,boolean sports){
        String result=pattern("^be[iıİ]n\\s*sports?\\s*(?=\\d|MAX\\b|PLUS\\b|$)").matcher(value).replaceFirst("BEIN Sport ");result=pattern("^s\\s*sport\\s*(?=\\d|MAX\\b|PLUS\\b|$)").matcher(result).replaceFirst("S Sport ");
        String compact=pattern("\\s+").matcher(folded(result)).replaceAll("");
        String[][] brands={{"aspor","A Spor"},{"trtspor","TRT Spor"},{"kanald","Kanal D"},{"beyaztv","Beyaz TV"},{"tv8","TV8"},{"tv8.5","TV8.5"},{"halktv","Halk TV"},{"ahaber","A Haber"}};
        for(String[] brand:brands)if(brand[0].equals(compact))return brand[1];
        if(pattern("^atv$").matcher(result.trim()).matches())return "ATV";if(pattern("^360\\s*(?:tv)?$").matcher(result.trim()).matches())return "360";
        Matcher exxen=pattern("^exxen\\s*(sport\\s*)?(\\d+)(.*)$").matcher(result.trim());if(exxen.find() && (exxen.group(1)!=null || sports))result="EXXEN Sport "+exxen.group(2)+exxen.group(3);
        return pattern("\\s+").matcher(result).replaceAll(" ").trim();
    }
    public static final class Description {
        public final String displayName,groupKey,countryCode,quality;public final boolean hevc,eventOnly,lowBandwidth,raw;
        Description(String name,String key,String country,String quality,boolean hevc,boolean event,boolean low,boolean raw){displayName=name;groupKey=key;countryCode=country;this.quality=quality;this.hevc=hevc;eventOnly=event;lowBandwidth=low;this.raw=raw;}
    }
    public static Description describe(String title,String groupTitle){
        String group=groupTitle==null?"":groupTitle;
        String original=pattern("<br\\s*/?\\s*>").matcher(smallcaps(title)).replaceAll(" ").replaceAll("[\\u0000-\\u001f\\u007f-\\u009f]"," ").trim();
        String distribution=pattern("^\\s*\\[\\s*fubotv\\s*\\]\\s*").matcher(original).replaceFirst("");distribution=pattern("\\b(fhd|uhd|hevc|hd|sd)(?=7\\s*/\\s*24)").matcher(distribution).replaceAll("$1 ");distribution=pattern("(7\\s*/\\s*24)(?=canl[ıi])").matcher(distribution).replaceAll("$1 ");Prefix p=prefix(distribution);String fromGroup=groupCountry(smallcaps(group)),country=p.country==null?fromGroup:p.country;
        String analysis=folded(p.quality+" "+p.rest);boolean hevc=HEVC.matcher(analysis).find(),raw=pattern("\\braw\\b").matcher(analysis).find();
        String quality=UHD.matcher(analysis).find()?"uhd":SD.matcher(analysis).find()?"sd":pattern("\\b720[pi]?\\b").matcher(analysis).find()?"hd":FHD.matcher(analysis).find()?"fhd":pattern("\\bhd\\b").matcher(analysis).find()?"hd":raw?"raw":"unknown";
        Matcher notes=pattern("\\[([^\\]]*)\\]|\\(([^)]*)\\)|\\{([^}]*)\\}").matcher(p.rest);StringBuffer display=new StringBuffer();while(notes.find()){String note=notes.group(1)!=null?notes.group(1):notes.group(2)!=null?notes.group(2):notes.group(3);notes.appendReplacement(display,Matcher.quoteReplacement(removableNote(note)?" ":notes.group()));}notes.appendTail(display);
        String name=pattern("^VIP\\s+(?=be[iıİ]n\\s*sports?|s\\s*sport|exxen\\b)").matcher(display.toString()).replaceFirst("");boolean branded4k=pattern("^\\s*(trt|bein\\s*sports?)\\s*4k(?:\\s|$)").matcher(name).find();
        name=TECHNICAL.matcher(LOW_DISPLAY.matcher(EVENT_DISPLAY.matcher(name).replaceAll(" ")).replaceAll(" ")).replaceAll(" ");
        name=pattern("\\b7\\s*[/x]\\s*24(?:\\s+canl[ıi])?\\b").matcher(name).replaceAll(" ");name=pattern("\\b(?:canl[ıi]\\s*yay[ıi]n|canl[ıi])\\s*$").matcher(name).replaceAll(" ");name=pattern("^[\\s•·|:\\-]+|[\\s•·|:\\-]+$").matcher(name).replaceAll("");name=pattern("\\s+").matcher(name).replaceAll(" ").trim();
        name=canonicalBrand(name,pattern("\\b(?:spor|sport|sports)\\b").matcher(folded(group)).find());if(branded4k && pattern("^(?:trt|bein\\s*sport)$").matcher(name).matches())name=pattern("^trt$").matcher(name).matches()?"TRT 4K":"BEIN Sport 4K";
        String languageText=folded(name+" "+group);List<String> languages=new ArrayList<>();for(int i=0;i<LANGUAGES.length;i++)if(LANGUAGES[i].matcher(languageText).find())languages.add(LANGUAGE_CODES[i]);
        String normalized=folded(name).replaceAll("[’'`\"]","");normalized=pattern("[^\\p{L}\\p{N}+\\s]").matcher(normalized).replaceAll(" ");normalized=pattern("\\s+").matcher(normalized).replaceAll(" ").trim();
        String conflict=p.country!=null && fromGroup!=null && !p.country.equals(fromGroup)?"!"+fromGroup:"";
        String unknownScope=pattern("[^\\p{L}\\p{N}\\s]").matcher(folded(group)).replaceAll(" ");unknownScope=pattern("\\s+").matcher(unknownScope).replaceAll(" ").trim();
        return new Description(name,(country==null?"unknown:"+unknownScope:country)+conflict+"|"+join(languages)+"|"+normalized,country,quality,hevc,EVENT.matcher(analysis).find() || pattern("[\\[({]\\s*live\\s*events?\\s*[\\])}]").matcher(analysis).find(),LOW.matcher(analysis).find(),raw);
    }
    public static final class Channel {
        public final String id,title,groupTitle,sourceTitle,providerId;public final boolean available,playbackAllowed,lookupFailed;
        public Channel(String id,String title,String groupTitle,String sourceTitle,String providerId,boolean available,boolean playbackAllowed,boolean lookupFailed){this.id=id;this.title=title;this.groupTitle=groupTitle==null?"":groupTitle;this.sourceTitle=sourceTitle;this.providerId=providerId==null?id:providerId;this.available=available;this.playbackAllowed=playbackAllowed;this.lookupFailed=lookupFailed;}
    }
    public static final class Selection {
        public final List<Channel> items;public final Map<String,String> canonicalById;
        Selection(List<Channel> items,Map<String,String> aliases){this.items=Collections.unmodifiableList(items);canonicalById=Collections.unmodifiableMap(aliases);}
    }
    private static final class Candidate {final Channel row;final String source;final Description description;Candidate(Channel row){this.row=row;source=row.sourceTitle==null?row.title:row.sourceTitle;description=describe(source,row.groupTitle);}}
    private static int compareIds(String left,String right){if(left.matches("[0-9]+") && right.matches("[0-9]+")){String a=left.replaceFirst("^0+(?=\\d)",""),b=right.replaceFirst("^0+(?=\\d)","");int c=Integer.compare(a.length(),b.length());if(c==0)c=a.compareTo(b);if(c!=0)return c;}return left.compareTo(right);}
    private static int compare(Candidate a,Candidate b){int c=Boolean.compare(a.description.hevc,b.description.hevc);if(c==0)c=Integer.compare(QUALITIES.indexOf(a.description.quality),QUALITIES.indexOf(b.description.quality));if(c==0)c=Boolean.compare(a.description.eventOnly,b.description.eventOnly);if(c==0)c=Boolean.compare(a.description.lowBandwidth,b.description.lowBandwidth);if(c==0)c=Boolean.compare(a.description.raw,b.description.raw);if(c==0)c=compareIds(a.row.providerId,b.row.providerId);if(c==0)c=a.row.id.compareTo(b.row.id);if(c==0)c=a.source.compareTo(b.source);if(c==0)c=a.row.groupTitle.compareTo(b.row.groupTitle);return c;}
    public static Selection curateChannels(List<Channel> rows,Set<String> excluded){
        Map<String,List<Candidate>> groups=new TreeMap<>();for(Channel row:rows){if(excluded.contains(row.id) || excluded.contains(row.providerId))continue;Candidate c=new Candidate(row);if(c.description.displayName.isEmpty() || c.description.groupKey.endsWith("|"))continue;List<Candidate> bucket=groups.get(c.description.groupKey);if(bucket==null){bucket=new ArrayList<>();groups.put(c.description.groupKey,bucket);}bucket.add(c);}
        List<Channel> output=new ArrayList<>();Map<String,String> aliases=new LinkedHashMap<>();for(List<Candidate> bucket:groups.values()){
            Candidate selected=null;for(Candidate c:bucket)if(c.row.available && c.row.playbackAllowed && !c.row.lookupFailed && (selected==null || compare(c,selected)<0))selected=c;if(selected==null)continue;
            Channel r=selected.row;output.add(new Channel(r.id,selected.description.displayName,r.groupTitle,selected.source,r.providerId,r.available,r.playbackAllowed,r.lookupFailed));Collections.sort(bucket,(a,b)->a.row.id.compareTo(b.row.id));for(Candidate c:bucket)aliases.put(c.row.id,r.id);
        }return new Selection(output,aliases);
    }
    public static final class Projection {
        public final Catalog catalog;private final Map<String,String> aliases;private final Map<String,Item> originals,selected;private final Map<String,List<String>> rawIdsBySelected;
        Projection(Catalog catalog,Map<String,String> aliases,Map<String,Item> originals,Map<String,Item> selected){
            this.catalog=catalog;this.aliases=aliases;this.originals=originals;this.selected=selected;Map<String,List<String>> groups=new HashMap<>();
            for(Map.Entry<String,String> entry:aliases.entrySet()){List<String> ids=groups.get(entry.getValue());if(ids==null){ids=new ArrayList<>();groups.put(entry.getValue(),ids);}ids.add(entry.getKey());}
            Map<String,List<String>> indexed=new HashMap<>();for(Map.Entry<String,List<String>> entry:groups.entrySet()){Collections.sort(entry.getValue(),LiveChannelCuration::compareIds);indexed.put(entry.getKey(),Collections.unmodifiableList(entry.getValue()));}rawIdsBySelected=Collections.unmodifiableMap(indexed);
        }
        public Item resolve(String id){return selected.get(aliases.get(id));}public Item original(String id){return originals.get(id);}
        public List<String> aliases(String selectedId){List<String> result=rawIdsBySelected.get(selectedId);return result==null?Collections.emptyList():result;}
    }
    public static Projection curate(Catalog raw,Set<String> excluded){
        List<Channel> rows=new ArrayList<>();Map<String,Item> originals=new HashMap<>();for(Item item:raw.items){rows.add(new Channel(item.id,item.title,item.categoryName,item.sourceTitle,item.id,true,true,false));originals.put(item.id,item);}
        Selection selection=curateChannels(rows,excluded);List<Item> items=new ArrayList<>();Map<String,Item> selected=new HashMap<>();Set<String> groups=new HashSet<>();for(Channel channel:selection.items){Item r=originals.get(channel.id);Item item=new Item(r.kind,r.id,channel.title,r.categoryId,r.categoryName,r.artwork,r.extension,r.scope,r.seriesId,r.season,r.episode,r.description,channel.sourceTitle,r.releaseYear);items.add(item);selected.put(item.id,item);groups.add(item.categoryId);}
        List<Category> categories=new ArrayList<>();for(Category category:raw.categories)if(groups.contains(category.id))categories.add(category);
        return new Projection(new Catalog(raw.kind,LiveChannelLineup.sort(items),categories),selection.canonicalById,Collections.unmodifiableMap(originals),Collections.unmodifiableMap(selected));
    }
}
