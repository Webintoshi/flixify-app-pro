package vip.flixify.tv;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import vip.flixify.tv.TvModels.*;

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
    private static boolean match(Item item,String category,String query){return (category==null || category.isEmpty() || category.equals(item.categoryId)) && item.title.toLowerCase(TURKISH).contains(query);}
    static boolean matches(Item item,String category,String query){return match(item,category,normalized(query));}
    static List<Item> filtered(Catalog catalog,String category,String query){
        String text=normalized(query);List<Item> result=new ArrayList<>();
        for(Item item:catalog.items)if(match(item,category,text))result.add(item);
        return result;
    }
    static SearchPreview preview(Catalog catalog,String category,String query){
        String text=normalized(query);int count=0;List<Item> samples=new ArrayList<>(3);
        for(Item item:catalog.items)if(match(item,category,text)){count++;if(samples.size()<3)samples.add(item);}
        return new SearchPreview(count,samples);
    }
    static List<CategoryOption> categories(Catalog catalog,String query){
        Map<String,String> names=new LinkedHashMap<>();
        for(Category category:catalog.categories)if(!category.id.isEmpty() && !names.containsKey(category.id))names.put(category.id,category.title.trim());
        for(Item item:catalog.items)if(!item.categoryId.isEmpty() && (!names.containsKey(item.categoryId) || names.get(item.categoryId).isEmpty()))names.put(item.categoryId,item.categoryName.trim());
        Map<String,Integer> counts=new LinkedHashMap<>();String text=normalized(query);int total=0;
        for(Item item:catalog.items)if(match(item,"",text)){total++;Integer prior=counts.get(item.categoryId);counts.put(item.categoryId,(prior==null?0:prior)+1);}
        List<CategoryOption> rows=new ArrayList<>();rows.add(new CategoryOption("","Tümü",total));
        for(Map.Entry<String,String> row:names.entrySet())rows.add(new CategoryOption(row.getKey(),row.getValue().isEmpty()?"Diğer":row.getValue(),counts.containsKey(row.getKey())?counts.get(row.getKey()):0));
        return Collections.unmodifiableList(rows);
    }
}
