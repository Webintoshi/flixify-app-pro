package vip.flixify.tv;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.data.LiveChannelLineup;

/** Local catalogue presentation only: shared matching keeps previews, counts and results consistent. */
final class CatalogFilterData {
    private static final Locale TURKISH=new Locale("tr","TR");
    static final class CategoryOption {
        final String id,title;final int count;
        CategoryOption(String id,String title,int count){this.id=id;this.title=title;this.count=count;}
    }
    static final class SearchPreview {
        final int count;final List<Item> items;final List<String> titles;
        SearchPreview(int count,List<Item> items){
            this.count=count;this.items=Collections.unmodifiableList(new ArrayList<>(items));
            List<String> labels=new ArrayList<>(items.size());for(Item item:items)labels.add(item.title);
            this.titles=Collections.unmodifiableList(labels);
        }
    }
    private CatalogFilterData(){}
    private static String normalized(String value){return value==null?"":value.trim().toLowerCase(TURKISH);}
    private static boolean categoryMatches(Item item,String category){
        if(category==null || category.isEmpty())return true;
        if(category.startsWith("@kind/"))return item.kind.name().equals(category.substring(6));
        if(category.startsWith("@catalog/")){String[] parts=category.split("/",3);return parts.length==3 && item.kind.name().equals(parts[1]) && item.categoryId.equals(parts[2]);}
        if(category.startsWith("@live/")){
            if(item.kind!=Kind.LIVE)return false;String[] parts=category.split("/");if(parts.length!=3)return false;
            LiveChannelLineup.Info info=LiveChannelLineup.info(item);return info.countryId.equals(parts[1]) && (parts[2].equals("all") || info.categoryId.equals(parts[2]));
        }
        return category.equals(item.categoryId);
    }
    private static boolean match(Item item,String category,String query){
        return match(item,category,query,query.isEmpty()?"":LiveChannelLineup.search(query));
    }
    private static boolean match(Item item,String category,String query,String liveQuery){
        if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
        if(!categoryMatches(item,category))return false;
        if(query.isEmpty())return true;
        return item.kind==Kind.LIVE?LiveChannelLineup.search(item.title+" "+item.categoryName).contains(liveQuery):item.title.toLowerCase(TURKISH).contains(query);
    }
    static boolean matches(Item item,String category,String query){return match(item,category,normalized(query));}
    static String effectiveFavoriteCategory(Catalog catalog,String category){
        if(category==null || category.isEmpty())return "";
        for(Item item:catalog.items)if(categoryMatches(item,category))return category;
        return "";
    }
    static String effectiveCategory(Catalog catalog,String category){
        return catalog.kind==Kind.LIVE || category!=null && category.startsWith("@")?effectiveFavoriteCategory(catalog,category):category==null?"":category;
    }
    static List<Item> filtered(Catalog catalog,String category,String query){
        category=effectiveCategory(catalog,category);String text=normalized(query),liveQuery=text.isEmpty()?"":LiveChannelLineup.search(text);List<Item> result=new ArrayList<>();
        for(Item item:catalog.items)if(match(item,category,text,liveQuery))result.add(item);
        return result;
    }
    static SearchPreview preview(Catalog catalog,String category,String query){
        category=effectiveCategory(catalog,category);String text=normalized(query),liveQuery=text.isEmpty()?"":LiveChannelLineup.search(text);int count=0;List<Item> samples=new ArrayList<>(3);
        for(Item item:catalog.items)if(match(item,category,text,liveQuery)){count++;if(samples.size()<3)samples.add(item);}
        return new SearchPreview(count,samples);
    }
    static List<CategoryOption> categories(Catalog catalog,String query){
        if(catalog.kind==Kind.LIVE)return liveCategories(catalog,query);
        boolean mixed=false;for(Item item:catalog.items)if(item.kind!=catalog.kind){mixed=true;break;}
        if(mixed)return mixedCategories(catalog,query);
        Map<String,String> names=new LinkedHashMap<>();
        for(Category category:catalog.categories)if(!category.id.isEmpty() && !names.containsKey(category.id))names.put(category.id,category.title.trim());
        for(Item item:catalog.items)if(!item.categoryId.isEmpty() && (!names.containsKey(item.categoryId) || names.get(item.categoryId).isEmpty()))names.put(item.categoryId,item.categoryName.trim());
        Map<String,Integer> counts=new LinkedHashMap<>();String text=normalized(query);int total=0;
        for(Item item:catalog.items)if(match(item,"",text)){total++;Integer prior=counts.get(item.categoryId);counts.put(item.categoryId,(prior==null?0:prior)+1);}
        List<CategoryOption> rows=new ArrayList<>();rows.add(new CategoryOption("","Tümü",total));
        for(Map.Entry<String,String> row:names.entrySet())rows.add(new CategoryOption(row.getKey(),row.getValue().isEmpty()?"Diğer":row.getValue(),counts.containsKey(row.getKey())?counts.get(row.getKey()):0));
        return Collections.unmodifiableList(rows);
    }
    static List<CategoryOption> favoriteCategories(Catalog catalog,String query){
        List<CategoryOption> rows=new ArrayList<>();rows.add(new CategoryOption("","Tümü",preview(catalog,"",query).count));
        Kind[] kinds={Kind.LIVE,Kind.MOVIE,Kind.SERIES};String[] titles={"Canlı TV","Filmler","Diziler"};
        for(int i=0;i<kinds.length;i++){boolean exists=false;int count=0;for(Item item:catalog.items)if(item.kind==kinds[i]){exists=true;if(match(item,"",normalized(query)))count++;}if(exists)rows.add(new CategoryOption("@kind/"+kinds[i].name(),titles[i],count));}
        return Collections.unmodifiableList(rows);
    }
    private static List<CategoryOption> liveCategories(Catalog catalog,String query){
        Map<String,Integer> counts=new LinkedHashMap<>();String text=normalized(query);int total=0;
        for(Item item:catalog.items)if(item.kind==Kind.LIVE && match(item,"",text)){
            total++;LiveChannelLineup.Info info=LiveChannelLineup.info(item);String all="@live/"+info.countryId+"/all",part="@live/"+info.countryId+"/"+info.categoryId;
            counts.put(all,counts.containsKey(all)?counts.get(all)+1:1);counts.put(part,counts.containsKey(part)?counts.get(part)+1:1);
        }
        List<CategoryOption> rows=new ArrayList<>();rows.add(new CategoryOption("","Tümü",total));
        for(String country:LiveChannelLineup.countries()){
            String prefix="@live/"+country+"/",title=LiveChannelLineup.countryTitle(country);if(!counts.containsKey(prefix+"all"))continue;
            rows.add(new CategoryOption(prefix+"all",title+" · Tümü",counts.get(prefix+"all")));
            for(String category:LiveChannelLineup.CATEGORY_IDS)if(counts.containsKey(prefix+category))rows.add(new CategoryOption(prefix+category,title+" · "+LiveChannelLineup.categoryTitle(category),counts.get(prefix+category)));
        }
        return Collections.unmodifiableList(rows);
    }
    private static List<CategoryOption> mixedCategories(Catalog catalog,String query){
        Map<String,String> names=new LinkedHashMap<>();Map<String,Integer> counts=new LinkedHashMap<>();String text=normalized(query);int total=0;
        for(Item item:catalog.items){
            if(match(item,"",text))total++;
            if(item.kind==Kind.LIVE || item.categoryId.isEmpty())continue;
            String id="@catalog/"+item.kind.name()+"/"+item.categoryId;String title=(item.kind==Kind.SERIES?"Dizi":"Film")+" · "+(item.categoryName.trim().isEmpty()?"Diğer":item.categoryName.trim());
            if(!names.containsKey(id))names.put(id,title);if(match(item,"",text))counts.put(id,counts.containsKey(id)?counts.get(id)+1:1);
        }
        List<CategoryOption> rows=new ArrayList<>();rows.add(new CategoryOption("","Tümü",total));
        for(Map.Entry<String,String> row:names.entrySet())rows.add(new CategoryOption(row.getKey(),row.getValue(),counts.containsKey(row.getKey())?counts.get(row.getKey()):0));
        List<CategoryOption> live=liveCategories(catalog,query);if(live.size()>1)rows.addAll(live.subList(1,live.size()));
        return Collections.unmodifiableList(rows);
    }
}
