package vip.flixify.tv;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.regex.Pattern;
import vip.flixify.tv.TvModels.*;

/** Presentation-only selections; source catalogs and playback identities stay intact. */
public final class OriginalCatalogShowcase {
    private OriginalCatalogShowcase(){}
    public static final class Rail {
        public final String id,title;public final List<Item> items;
        public Rail(String id,String title,List<Item> items){this.id=id;this.title=title;this.items=Collections.unmodifiableList(new ArrayList<>(items));}
    }
    public static final class Result {
        public final List<Item> hero;public final List<Rail> rails;
        public Result(List<Item> hero,List<Rail> rails){this.hero=Collections.unmodifiableList(new ArrayList<>(hero));this.rails=Collections.unmodifiableList(new ArrayList<>(rails));}
    }
    public static String dayKey(){return dayKey(System.currentTimeMillis());}
    public static String dayKey(long now){SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);format.setTimeZone(TimeZone.getTimeZone("Europe/Istanbul"));return format.format(new Date(now));}
    private static final Pattern EDGE_SPACE=Pattern.compile("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$"),SPACE=Pattern.compile("[\\s\\p{Z}\\uFEFF]+"),MARKS=Pattern.compile("[\\u0300-\\u036f]"),MOVIE_WORDS=Pattern.compile("[^a-z0-9]+");
    private static void active(){if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();}
    private static String trim(String value){active();return EDGE_SPACE.matcher(value).replaceAll("");}
    private static String whitespace(String value){active();return SPACE.matcher(value).replaceAll(" ").trim();}
    private static String identity(Item item){active();return item.kind.name().toLowerCase(Locale.ROOT)+":"+item.id;}
    private static String title(Item item){return whitespace(Normalizer.normalize(item.title,Normalizer.Form.NFKC)).toLowerCase(Locale.ROOT);}
    private static String titleIdentity(Item item){return item.kind.name().toLowerCase(Locale.ROOT)+":"+title(item);}
    private static String group(Item item){String value=trim(item.categoryName);return value.isEmpty()?"Diğer":value;}
    private static boolean artwork(Item item){return !trim(item.artwork).isEmpty();}
    private static long hash(String value){
        int result=0x811c9dc5;
        for(int n=0;n<value.length();n++)result=(result^value.charAt(n))*16777619;
        result^=result>>>16;result*=0x85ebca6b;result^=result>>>13;return result&0xffffffffL;
    }
    private static List<Item> ranked(List<Item> items,String day){
        String key=day==null?"":day;List<Item> result=new ArrayList<>(items);
        Map<Item,Long> ranks=new IdentityHashMap<>();for(Item item:result)ranks.put(item,hash(key+"\0"+identity(item)));
        Collections.sort(result,(a,b)->{int c=Long.compare(ranks.get(a),ranks.get(b));if(c==0)c=identity(a).compareTo(identity(b));if(c==0)c=group(a).compareTo(group(b));if(c==0)c=titleIdentity(a).compareTo(titleIdentity(b));return c;});
        return result;
    }
    private static List<Item> order(List<Item> items,String day){
        List<Item> sorted=ranked(items,day);Map<String,List<Item>> buckets=new LinkedHashMap<>();
        for(Item item:sorted){String name=group(item);List<Item> bucket=buckets.get(name);if(bucket==null){bucket=new ArrayList<>();buckets.put(name,bucket);}bucket.add(item);}
        List<String> names=new ArrayList<>(buckets.keySet());String dayKey=day==null?"":day;
        Collections.sort(names,(a,b)->{int c=Long.compare(hash(dayKey+"\0group\0"+a),hash(dayKey+"\0group\0"+b));return c==0?a.compareTo(b):c;});
        Map<String,Integer> offsets=new HashMap<>();for(String name:names)offsets.put(name,0);
        List<Item> result=new ArrayList<>();
        while(result.size()<Math.min(12,items.size()))for(String name:names){
            int offset=offsets.get(name);List<Item> bucket=buckets.get(name);
            if(offset<bucket.size()){result.add(bucket.get(offset));offsets.put(name,offset+1);}
            if(result.size()>=12)break;
        }
        for(String name:names.subList(0,Math.min(4,names.size()))){
            int offset=offsets.get(name);List<Item> bucket=buckets.get(name);int end=Math.min(bucket.size(),offset+12);result.addAll(bucket.subList(offset,end));offsets.put(name,end);
        }
        Map<Item,Integer> occurrences=new IdentityHashMap<>();for(Item item:result){Integer count=occurrences.get(item);occurrences.put(item,count==null?1:count+1);}
        for(Item item:sorted){Integer count=occurrences.get(item);if(count!=null && count>0)occurrences.put(item,count-1);else result.add(item);}
        return result;
    }
    private static final class Rows {
        final List<Item> primary=new ArrayList<>(),other=new ArrayList<>();final Map<String,List<Item>> categories=new LinkedHashMap<>();
        List<Item> flattened(){List<Item> rows=new ArrayList<>(primary);for(List<Item> entries:categories.values())rows.addAll(entries);rows.addAll(other);return rows;}
    }
    private static Rows rows(List<Item> items,Kind kind,Set<String> excluded){
        Set<String> ids=new HashSet<>(),titles=new HashSet<>();
        for(Item item:items)if(excluded.contains(item.key())){ids.add(identity(item));titles.add(titleIdentity(item));}
        List<Item> visible=new ArrayList<>();
        for(Item item:items){
            if(item.kind!=kind || excluded.contains(item.key()) || ids.contains(identity(item)) || titles.contains(titleIdentity(item)))continue;
            ids.add(identity(item));titles.add(titleIdentity(item));visible.add(item);
        }
        Rows result=new Rows();result.primary.addAll(visible.subList(0,Math.min(12,visible.size())));
        for(Item item:visible.subList(result.primary.size(),visible.size())){
            String name=group(item);List<Item> bucket=result.categories.get(name);
            if(bucket==null && result.categories.size()<4){bucket=new ArrayList<>();result.categories.put(name,bucket);}
            if(bucket!=null && bucket.size()<12)bucket.add(item);else result.other.add(item);
        }
        return result;
    }
    private static List<Item> coveredFirst(List<Item> items,int limit){List<Item> ordered=new ArrayList<>();for(Item item:items)if(artwork(item))ordered.add(item);for(Item item:items)if(!artwork(item))ordered.add(item);return new ArrayList<>(ordered.subList(0,Math.min(limit,ordered.size())));}
    private static List<Item> homeCatalog(List<Item> items,Kind kind,String day){List<Item> current=new ArrayList<>();for(Item item:items)if(item!=null && item.kind==kind && item.releaseYear==2026)current.add(item);return rows(order(current,day),kind,Collections.emptySet()).flattened();}
    public static Result home(List<Item> items,String dayKey){return home(items,dayKey,Collections.emptySet());}
    public static Result home(List<Item> items,String dayKey,Set<String> failedArtworkKeys){
        List<Item> available=new ArrayList<>();for(Item item:items)if(item!=null && !failedArtworkKeys.contains(item.key()))available.add(item);
        List<Item> pool=homeCatalog(available,Kind.MOVIE,dayKey);pool.addAll(homeCatalog(available,Kind.SERIES,dayKey));
        List<Item> hero=new ArrayList<>();Set<String> ids=new HashSet<>(),titles=new HashSet<>();int limit=Math.min(5,Math.max(1,pool.size()/3));
        for(Item item:ranked(pool,dayKey)){
            if(hero.size()>=limit)break;
            if(!artwork(item) || ids.contains(identity(item)) || titles.contains(titleIdentity(item)))continue;
            ids.add(identity(item));titles.add(titleIdentity(item));hero.add(item);
        }
        Set<String> excluded=new HashSet<>();for(Item item:hero)excluded.add(item.key());
        List<Item> live=new ArrayList<>();Set<String> liveIds=new HashSet<>();for(Item item:items)if(item!=null && item.kind==Kind.LIVE && liveIds.add(item.key()) && live.size()<12)live.add(item);
        return new Result(hero,Arrays.asList(new Rail("home-movies","2026 Filmleri",coveredFirst(rows(pool,Kind.MOVIE,excluded).flattened(),18)),new Rail("home-series","2026 Dizileri",coveredFirst(rows(pool,Kind.SERIES,excluded).flattened(),18)),new Rail("home-live","Canlı TV",live)));
    }
    private static String movieText(String value){active();return MOVIE_WORDS.matcher(MARKS.matcher(Normalizer.normalize(value,Normalizer.Form.NFKD)).replaceAll("").replace('ı','i').toLowerCase(Locale.ROOT)).replaceAll(" ").trim();}
    private static final Pattern MARVEL=Pattern.compile("\\b(?:marvel|avengers|yenilmezler|iron man|ironman|thor|captain america|kaptan amerika|spider man|spiderman|orumcek adam|hulk|doctor strange|doktor strange|black panther|kara panter|ant man|karinca adam|guardians of the galaxy|galaksinin koruyuculari|black widow|kara dul|shang chi|eternals|deadpool|wolverine|x men|venom)\\b");
    private static final Pattern FANTASY=Pattern.compile("\\b(?:harry potter|fantastic beasts|fantastik canavarlar|lord of the rings|yuzuklerin efendisi|hobbit|narnia)\\b");
    private static final Pattern ACTION_GROUP=Pattern.compile("\\b(?:aksiyon|action)\\b"),FANTASY_GROUP=Pattern.compile("\\b(?:fantastik|fantasy)\\b"),SCIENCE_FICTION_GROUP=Pattern.compile("\\b(?:bilim kurgu|science fiction|sci fi|scifi)\\b");
    private static List<Item> take(List<Item> items,Set<String> used){
        List<Item> ordered=coveredFirst(items,items.size()),unique=new ArrayList<>();for(Item item:ordered)if(!used.contains(identity(item)))unique.add(item);
        List<Item> chosen=unique.isEmpty()?ordered:unique;List<Item> result=new ArrayList<>(chosen.subList(0,Math.min(18,chosen.size())));for(Item item:result)used.add(identity(item));return result;
    }
    public static Result movies(List<Item> items,String dayKey){return movies(items,dayKey,Collections.emptySet());}
    public static Result movies(List<Item> items,String dayKey,Set<String> failedArtworkKeys){
        Set<String> blockedIds=new HashSet<>(),blockedTitles=new HashSet<>();for(Item item:items)if(item!=null && item.kind==Kind.MOVIE && failedArtworkKeys.contains(item.key())){blockedIds.add(identity(item));blockedTitles.add(title(item));}
        List<Item> candidates=new ArrayList<>();for(Item item:items)if(item!=null && item.kind==Kind.MOVIE)candidates.add(item);
        Map<String,Integer> ids=new HashMap<>(),titles=new HashMap<>();List<Item> pool=new ArrayList<>();
        for(Item item:order(candidates,dayKey)){
            String id=identity(item),name=title(item);
            if(blockedIds.contains(id) || blockedTitles.contains(name))continue;
            Integer existing=ids.get(id);if(existing==null)existing=titles.get(name);
            if(existing!=null){if(!artwork(pool.get(existing)) && artwork(item))pool.set(existing,item);ids.put(id,existing);titles.put(name,existing);continue;}
            ids.put(id,pool.size());titles.put(name,pool.size());pool.add(item);
        }
        List<Item> current=new ArrayList<>(),marvel=new ArrayList<>(),action=new ArrayList<>(),fantasy=new ArrayList<>();
        for(Item item:pool){String name=movieText(item.title),category=movieText(item.categoryName);if(item.releaseYear==2026)current.add(item);if(MARVEL.matcher(name).find())marvel.add(item);if(artwork(item) && ACTION_GROUP.matcher(category).find())action.add(item);if(FANTASY.matcher(name).find() || FANTASY_GROUP.matcher(category).find() && !SCIENCE_FICTION_GROUP.matcher(category).find())fantasy.add(item);}
        List<Item> hero=new ArrayList<>();int limit=Math.min(5,Math.max(1,current.size()/3));for(Item item:current)if(artwork(item) && hero.size()<limit)hero.add(item);
        Set<String> used=new HashSet<>();for(Item item:hero)used.add(identity(item));
        return new Result(hero,Arrays.asList(new Rail("movies-2026","2026 Filmleri",take(current,used)),new Rail("movies-marvel","Çok İzlenenler · Marvel",take(marvel,used)),new Rail("movies-action","Aksiyon Filmleri",take(action,used)),new Rail("movies-fantasy","Fantastik Filmler",take(fantasy,used))));
    }
    public static Result series(List<Item> items,String dayKey){
        List<Item> selected=new ArrayList<>();for(Item item:items)if(item!=null && item.kind==Kind.SERIES)selected.add(item);
        Rows rows=rows(order(selected,dayKey),Kind.SERIES,Collections.emptySet());List<Rail> rails=new ArrayList<>();rails.add(new Rail("series-primary","Günün Seçkisi",rows.primary));int n=0;
        for(Map.Entry<String,List<Item>> category:rows.categories.entrySet())rails.add(new Rail("series-category-"+(n++),category.getKey(),category.getValue()));
        if(!rows.other.isEmpty())rails.add(new Rail("series-other","Diğer Diziler",rows.other));return new Result(Collections.emptyList(),rails);
    }
}
