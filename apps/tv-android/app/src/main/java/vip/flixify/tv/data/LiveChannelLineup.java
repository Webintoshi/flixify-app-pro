package vip.flixify.tv.data;

import java.text.Collator;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.*;
import vip.flixify.tv.TvModels.Item;

/** Presentation order and friendly filters from the website's reviewed TV+ reference. */
public final class LiveChannelLineup {
    private LiveChannelLineup(){}
    private static final Map<Item,Info> CACHE=Collections.synchronizedMap(new WeakHashMap<>());
    private static final java.util.concurrent.ConcurrentMap<String,Pattern> PATTERNS=new java.util.concurrent.ConcurrentHashMap<>();
    private static final Map<String,String> NAMES=new HashMap<>(),COUNTRIES=new LinkedHashMap<>(),ALIASES=new HashMap<>();
    private static final Map<String,Double> POSITIONS=new HashMap<>();
    private static final Set<String> NATIONAL=new HashSet<>(Arrays.asList("trt1","kanald","atv","showtv","now","startv","kanal7","tv8","beyaztv","cnbce","diyanettv","a2","teve2","tv85","trt2","360","tlc","dmax","trt4k"));
    private static final Set<String> NEWS=new HashSet<>(Arrays.asList("trthaber","cnnturk","ntv","ahaber","haberturk","sozcutv","halktv","tele1","tv100","24","tgrthaber","apara","ekoturk","bloomberght","ulusal1","ulusalkanal"));
    private static final String[] BEIN={"beinsport1","beinsport2","beinsport3","beinsport4","beinsport5","beinsportmax1","beinsportmax2","beinsport4k"};
    public static final String[] CATEGORY_IDS={"national","news","sports","kids","documentary","music","local","themed","radio"};
    private static final String[] CATEGORY_TITLES={"Ulusal","Haber","Spor","Çocuk","Belgesel","Müzik","Yerel","7/24","Radyo"};
    static {
        String[][] names={{"trtbir","trt1"},{"show","showtv"},{"nowtv","now"},{"star","startv"},{"kanal7tv","kanal7"},{"tv2","teve2"},{"24tv","24"},{"cnnturktv","cnnturk"},{"trtsporyildiztv","trtsporyildiz"}};
        for(String[] pair:names)NAMES.put(pair[0],pair[1]);
        String[][] countries={{"tr","Türkiye"},{"de","Almanya"},{"fr","Fransa"},{"gb","İngiltere"},{"us","ABD"},{"it","İtalya"},{"es","İspanya"},{"pt","Portekiz"},{"bg","Bulgaristan"},{"gr","Yunanistan"},{"se","İsveç"},{"dk","Danimarka"},{"ru","Rusya"},{"br","Brezilya"},{"latam","Latin Amerika"},{"arabic","Arapça"},{"kurdish","Kürtçe"},{"other","Diğer"}};
        for(String[] pair:countries)COUNTRIES.put(pair[0],pair[1]);
        position(1,"TV+ Keşfet Aksiyon");
        position(2,"TV+ Keşfet Drama");
        position(3,"FX");
        position(7,"tabii TV");
        position(9,"SİNEMA YERLİ");
        position(10,"SİNEMA TV");
        position(11,"SİNEMA TV AKSİYON");
        position(12,"SİNEMA KOMEDİ");
        position(13,"SİNEMA AİLE");
        position(14,"SİNEMA TV 1001");
        position(15,"SİNEMA YERLİ 2");
        position(16,"SİNEMA TV 2");
        position(17,"SİNEMA AKSİYON 2");
        position(18,"SİNEMA AİLE 2");
        position(19,"SİNEMA 1002");
        position(20,"COSMO EN");
        position(21,"TRT1");
        position(22,"KANAL D");
        position(23,"STAR TV");
        position(24,"ATV");
        position(25,"SHOW TV");
        position(26,"NOW");
        position(27,"TV8");
        position(28,"360");
        position(29,"A2");
        position(30,"TLC");
        position(31,"CNBC-E");
        position(32,"TV2");
        position(34,"KANAL 7");
        position(36,"BEYAZ TV");
        position(37,"TV100");
        position(38,"FLASH HABER");
        position(39,"DMAX");
        position(40,"BİZİM EV TV");
        position(41,"TV8,5");
        position(42,"GZT TV");
        position(43,"VAV TV");
        position(44,"TRT 2");
        position(45,"TV 4");
        position(46,"AS TV");
        position(47,"EKOL TV");
        position(48,"TURKHABER");
        position(49,"CNN TÜRK");
        position(50,"NTV");
        position(51,"HABERTÜRK");
        position(52,"A HABER");
        position(53,"TRT HABER");
        position(54,"24");
        position(55,"BLOOMBERG HT");
        position(56,"A PARA");
        position(57,"HALK TV");
        position(58,"TELE1");
        position(59,"HABER GLOBAL");
        position(60,"EKOTÜRK");
        position(61,"ÜLKE TV");
        position(62,"TGRT HABER");
        position(63,"TVNET");
        position(64,"AKİT TV");
        position(65,"BENGÜTÜRK");
        position(66,"ULUSAL KANAL");
        position(67,"KRT TV");
        position(68,"TV5");
        position(69,"SÖZCÜ TV");
        position(70,"TRT SPOR");
        position(71,"TRT SPOR YILDIZ");
        position(72,"A SPOR");
        position(73,"HT SPOR");
        position(74,"FB TV");
        position(75,"tabii spor");
        position(77,"S SPORT");
        position(78,"S SPORT 2");
        position(79,"EUROSPORT 1");
        position(80,"EUROSPORT 2");
        position(92,"SPORTS TV");
        position(94,"TV+ Ekstra");
        position(95,"TRT BELGESEL");
        position(96,"TARIH TV");
        position(97,"VIASAT EXPLORE");
        position(98,"NATIONAL GEOGRAPHIC");
        position(99,"BBC EARTH");
        position(100,"VIASAT HISTORY");
        position(101,"DISCOVERY CHANNEL");
        position(104,"NATIONAL GEOGRAPHIC WILD");
        position(105,"LOVE NATURE");
        position(106,"ENGLISH CLUB TV");
        position(118,"BABYTV");
        position(119,"DUCK TV");
        position(120,"DISNEY JUNIOR");
        position(121,"CBEEBIES");
        position(122,"MOONBUG KIDS TV");
        position(123,"CARTOONITO");
        position(125,"Nick JR");
        position(126,"NICKELODEON");
        position(127,"NICKTOONS");
        position(128,"AZOOMEE");
        position(129,"DA VINCI");
        position(130,"CARTOON NETWORK");
        position(131,"TRT ÇOCUK");
        position(132,"MİNİKA ÇOCUK");
        position(133,"MİNİKA GO");
        position(134,"SPACETOON");
        position(135,"TRT DIYANET COCUK");
        position(136,"TRT GENÇ");
        position(137,"CNN International");
        position(138,"BBC News");
        position(139,"Bloomberg");
        position(140,"A NEWS");
        position(141,"TRT World");
        position(142,"AL JAZEERA ENGLISH");
        position(143,"DEUTSCHE WELLE ENGLISH");
        position(144,"FRANCE 24 ENGLISH");
        position(145,"EURONEWS");
        position(146,"AL JAZEERA ARABIC");
        position(147,"FRANCE 24 ARABIC");
        position(148,"SKY NEWS ARABIA");
        position(149,"TV5 MONDE");
        position(170,"NUMBER1 TV");
        position(171,"POWER TV");
        position(172,"DREAM TÜRK");
        position(173,"NUMBER1 TURK");
        position(174,"POWER TURK");
        position(175,"TRT MÜZİK");
        position(177,"NR1 RAP");
        position(179,"TMB TV");
        position(181,"TİVİ6");
        position(182,"TYT TÜRK");
        position(183,"Bi Kanal");
        position(184,"MELTEM TV");
        position(203,"TRT 3");
        position(204,"TRT TÜRK");
        position(205,"TRT ARABI");
        position(206,"TRT AVAZ");
        position(207,"TRT KURDİ");
        position(208,"DİYANET TV");
        position(209,"SEMERKAND");
        position(211,"FM TV");
        position(213,"AL QURAN AL KAREEM");
        position(214,"AL SUNNAH AL NABAWIYAH");
        position(215,"TARIM TV");
        position(216,"ÇİFTÇİ TV");
        position(218,"AGRO TV");
        position(221,"TRT EBA");
        position(248,"KADIRGA TV");
        position(250,"KONTV");
        position(251,"KANAL 23");
        position(253,"KANAL V");
        position(256,"KANAL 26");
        position(260,"KANAL 33");
        position(261,"ON6");
        position(280,"BRT 1");
        position(281,"BRT 2");
        position(282,"KIBRIS GENC TV");
        position(283,"KIBRIS TV");
        position(284,"KANAL T");
        position(285,"KIBRIS ADA TV");
        position(300,"ŞÖMİNE PLUS");
        alias("Ulusal TV","Ulusal Kanal");
        alias("Sözcü SZC TV","Sözcü TV");
        alias("SZC TV","Sözcü TV");
        alias("S Sport 1","S Sport");
        alias("Nat Geo","National Geographic");
        alias("NatGeo","National Geographic");
        alias("Nat Geo Wild","National Geographic Wild");
        alias("NatGeo Wild","National Geographic Wild");
        alias("Disney JR","Disney Junior");
        alias("Da Vinci Kids","Da Vinci");
        alias("NUMBER 1","NUMBER1 TV");
        alias("Power Türk TV","POWER TURK");
        alias("Tivi6 (Ankaraİç Anadolu)","TİVİ6");
        alias("TRT 3 SPOR","TRT 3");
        alias("TRT 3 TBMM TV","TRT 3");
        alias("Çiftçi Tv (İstanbulMarmara)","ÇİFTÇİ TV");
        alias("KONYA KON TV","KONTV");
        alias("Kanal 23 (ElazığDoğu Anadolu)","KANAL 23");
        alias("ELAZIG Kanal 23","KANAL 23");
        alias("Kanal V (AntalyaAkdeniz)","KANAL V");
        alias("ANTALYA Kanal V","KANAL V");
        alias("Kanal 26 (Eskişehirİç Anadolu)","KANAL 26");
        alias("ON6TV (BursaMarmara)","ON6");
        alias("Sinema Aksiyon","SİNEMA TV AKSİYON");
        alias("Sinema 2","SİNEMA TV 2");
        alias("Sinema 1001","SİNEMA TV 1001");
    }
    public static String fold(String value){return Normalizer.normalize(value==null?"":value,Normalizer.Form.NFKD).replaceAll("[\\u0300-\\u036f]","").replace('ı','i').toLowerCase(Locale.ROOT);}
    public static String search(String value){return fold(value).replaceAll("[^\\p{L}\\p{N}]","");}
    private static String station(String value){String key=search(value);return NAMES.containsKey(key)?NAMES.get(key):key;}
    private static void position(int rank,String title){POSITIONS.put(station(title),(double)rank);}
    private static void alias(String source,String target){ALIASES.put(station(source),station(target));}
    private static boolean has(String value,String regex){Pattern prior=PATTERNS.get(regex);if(prior==null){Pattern next=Pattern.compile(regex);prior=PATTERNS.putIfAbsent(regex,next);if(prior==null)prior=next;}return prior.matcher(value).find();}
    public static final class Info {
        public final String countryId,categoryId,name,id;public final int section;public final double position;
        Info(String country,String category,String name,String id,int section,double position){countryId=country;categoryId=category;this.name=name;this.id=id;this.section=section;this.position=position;}
    }
    private static String country(String code,String group,String source){
        if(code!=null){String key=code.equals("CO")?"latam":code.toLowerCase(Locale.ROOT);if(COUNTRIES.containsKey(key))return key;}
        if(has(group,"^(?:arabic|arabia|middle east)(?:\\W|$)"))return "arabic";
        if(has(group,"^(?:kurdish|ku)(?:\\W|$)"))return "kurdish";
        if(has(group,"^(?:latin america|latam)(?:\\W|$)"))return "latam";
        if(code!=null)return "other";
        if(has(group,"^(?:turkish|turkce|turkiye|turkey)(?:\\W|$)"))return "tr";
        Matcher leading=Pattern.compile("^(tr|de|fr|uk|gb|us|usa|it|es|pt|bg|gr|se|dk|ru|br|col|ku)(?=[\\s•·|:\\-])",Pattern.CASE_INSENSITIVE).matcher(source.trim());
        if(!leading.find())return "other";String key=leading.group(1).toLowerCase(Locale.ROOT);
        if(key.equals("uk"))key="gb";if(key.equals("usa"))key="us";if(key.equals("col"))key="latam";if(key.equals("ku"))key="kurdish";return key;
    }
    private static String category(String group,String name,String title){
        if(NATIONAL.contains(name))return "national";
        if(has(group,"radyo|radio"))return "radio";if(has(group,"muzik|music"))return "music";
        if(has(group,"yoresel|yerel|local|regional"))return "local";
        if(has(group,"7\\s*[/x]\\s*24|sinema|cinema|yerli dizi|yabanci dizi|ambiyans"))return "themed";
        String text=group+" "+title;
        if(has(text,"belgesel|documenta(?:ry|ire)|nature|discovery|nat geo"))return "documentary";
        if(has(text,"cocuk|kids?|child|cartoon|nick(?:elodeon)?|minika|baby"))return "kids";
        if(NEWS.contains(name)||has(text,"haber|news|cnn|bbc world|bulten"))return "news";
        if(has(text,"spor|sport|futbol|football|bein|dazn|nfl|nba|laliga|liga de campeones|eurosport"))return "sports";
        return "national";
    }
    private static int section(double p){return p<21?0:p<49?1:p<70?2:p<95?3:p<118?4:p<137?5:p<170?6:p<200?7:p<248?8:p<300?9:10;}
    private static double rank(String name,String category,String group){
        Double exact=POSITIONS.get(ALIASES.containsKey(name)?ALIASES.get(name):name);if(exact!=null)return exact;
        if(name.equals("trt4k"))return 44.5;
        if(category.equals("sports")){
            for(int i=0;i<BEIN.length;i++)if(name.equals(BEIN[i]))return 76+(i+1)/100.0;
            if(name.matches("beinsport(?:max|plus)?[0-9]+"))return 76.9;
            Matcher tivibu=Pattern.compile("^tivibusport?([0-9]+|4k)?$").matcher(name);if(tivibu.matches())return 84+("4k".equals(tivibu.group(1))?.9:tivibu.group(1)==null?0:Double.parseDouble(tivibu.group(1))/100);
            if(name.matches("ssportplus[0-9]+"))return 88.5;if(name.matches("exxen(?:sports?)?[0-9]+"))return 89.5;
            if(has(name,"^beinconne?ct|^beinconnet"))return 91.5;
        }
        if(has(group,"dini|religio|diyanet"))return 247.5;
        switch(category){case "national":return 48.9;case "news":return 69.9;case "sports":return 94.9;case "documentary":return 117.9;case "kids":return 136.9;case "music":return 199.9;case "local":return 299.9;default:return 1000;}
    }
    public static Info info(Item item){
        Info prior=CACHE.get(item);if(prior!=null)return prior;
        String source=item.sourceTitle.isEmpty()?item.title:item.sourceTitle;LiveChannelCuration.Description d=LiveChannelCuration.describe(source,item.categoryName);
        String group=fold(item.categoryName),title=fold(d.displayName),name=station(title),category=category(group,name,title);double rank=rank(name,category,group);
        int section=rank==1000?(category.equals("radio")?12:11):section(rank);
        Info result=new Info(country(d.countryCode,group,source),category,d.displayName,item.id,section,rank);CACHE.put(item,result);return result;
    }
    public static String countryTitle(String id){return COUNTRIES.containsKey(id)?COUNTRIES.get(id):"Diğer";}
    public static List<String> countries(){return Collections.unmodifiableList(new ArrayList<>(COUNTRIES.keySet()));}
    public static String categoryTitle(String id){for(int i=0;i<CATEGORY_IDS.length;i++)if(CATEGORY_IDS[i].equals(id))return CATEGORY_TITLES[i];return "Tümü";}
    private static int natural(String a,String b,Collator collator){
        int i=0,j=0;while(i<a.length() && j<b.length()){
            if(Character.isDigit(a.charAt(i)) && Character.isDigit(b.charAt(j))){int x=i,y=j;while(i<a.length() && Character.isDigit(a.charAt(i)))i++;while(j<b.length() && Character.isDigit(b.charAt(j)))j++;String left=a.substring(x,i).replaceFirst("^0+(?!$)",""),right=b.substring(y,j).replaceFirst("^0+(?!$)","");int c=Integer.compare(left.length(),right.length());if(c==0)c=left.compareTo(right);if(c!=0)return c;}
            else{int x=i,y=j;while(i<a.length() && !Character.isDigit(a.charAt(i)))i++;while(j<b.length() && !Character.isDigit(b.charAt(j)))j++;int c=collator.compare(a.substring(x,i),b.substring(y,j));if(c!=0)return c;}
        }return Integer.compare(a.length()-i,b.length()-j);
    }
    public static List<Item> sort(List<Item> items){
        List<Item> result=new ArrayList<>(items);Map<Item,Info> infos=new IdentityHashMap<>();for(Item item:items)infos.put(item,info(item));
        final Collator collator=Collator.getInstance(new Locale("tr","TR"));collator.setStrength(Collator.PRIMARY);
        Collections.sort(result,(a,b)->{Info x=infos.get(a),y=infos.get(b);int c=Boolean.compare(y.countryId.equals("tr"),x.countryId.equals("tr"));if(c!=0)return c;if(!x.countryId.equals("tr"))return 0;c=Integer.compare(x.section,y.section);if(c==0)c=Double.compare(x.position,y.position);if(c==0)c=natural(x.name,y.name,collator);if(c==0)c=natural(x.id,y.id,collator);return c;});return result;
    }
}
