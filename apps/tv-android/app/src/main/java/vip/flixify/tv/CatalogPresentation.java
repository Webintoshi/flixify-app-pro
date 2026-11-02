package vip.flixify.tv;

import java.util.*;
import vip.flixify.tv.TvModels.*;

/** Immutable view data; preparation never touches Android views or repository state. */
final class CatalogPresentation {
    static final class Key {
        final Catalog catalog;final String section,account,scope,day,category,query;
        Key(Catalog catalog,String section,String account,String scope,String day,String category,String query){this.catalog=catalog;this.section=section;this.account=account;this.scope=scope;this.day=day;this.category=category;this.query=query;}
        @Override public boolean equals(Object other){if(!(other instanceof Key))return false;Key key=(Key)other;return catalog==key.catalog && section.equals(key.section) && account.equals(key.account) && scope.equals(key.scope) && day.equals(key.day) && category.equals(key.category) && query.equals(key.query);}
        @Override public int hashCode(){return Objects.hash(System.identityHashCode(catalog),section,account,scope,day,category,query);}
    }
    final String category,archiveTitle;final List<Item> items,archive;final CatalogShowcase.Result showcase;final boolean emptyHero;
    private CatalogPresentation(String category,List<Item> items,CatalogShowcase.Result showcase,List<Item> archive,String archiveTitle,boolean emptyHero){this.category=category;this.items=Collections.unmodifiableList(items);this.showcase=showcase;this.archive=archive;this.archiveTitle=archiveTitle;this.emptyHero=emptyHero;}
    static CatalogPresentation prepare(Key key){
        String category=key.section.equals("FAVORITES")?CatalogFilterData.effectiveFavoriteCategory(key.catalog,key.category):CatalogFilterData.effectiveCategory(key.catalog,key.category);
        List<Item> items=CatalogFilterData.filtered(key.catalog,category,key.query),archive=null;CatalogShowcase.Result showcase=null;String archiveTitle="";boolean emptyHero=false;
        if(key.query.isEmpty() && category.isEmpty() && !items.isEmpty())switch(key.section){
            case "HOME":
                showcase=CatalogShowcase.home(items,key.day);boolean current=false;for(Item item:items)if(item.kind!=Kind.LIVE && item.releaseYear==2026){current=true;break;}
                emptyHero=showcase.hero.isEmpty();
                if(!current){List<CatalogShowcase.Rail> fallback=new ArrayList<>();for(Kind kind:new Kind[]{Kind.MOVIE,Kind.SERIES}){List<Item> rows=new ArrayList<>();for(Item item:items)if(item.kind==kind && rows.size()<18)rows.add(item);if(!rows.isEmpty())fallback.add(new CatalogShowcase.Rail(kind==Kind.MOVIE?"home-archive-movies":"home-archive-series",kind==Kind.MOVIE?"Filmler":"Diziler",rows));}for(CatalogShowcase.Rail rail:showcase.rails)if(rail.id.equals("home-live") && !rail.items.isEmpty())fallback.add(rail);showcase=new CatalogShowcase.Result(showcase.hero,fallback);}break;
            case "MOVIES":showcase=CatalogShowcase.movies(items,key.day);archive=items;archiveTitle="Tüm Filmler";emptyHero=showcase.hero.isEmpty();break;
            case "SERIES":showcase=CatalogShowcase.series(items,key.day);archive=items;archiveTitle="Tüm Diziler";break;
            case "FAVORITES":List<CatalogShowcase.Rail> rails=new ArrayList<>();for(Kind kind:new Kind[]{Kind.LIVE,Kind.MOVIE,Kind.SERIES}){List<Item> entries=new ArrayList<>();for(Item item:items)if(item.kind==kind)entries.add(item);if(!entries.isEmpty())rails.add(new CatalogShowcase.Rail("favorites-"+kind.name().toLowerCase(Locale.ROOT),kind==Kind.LIVE?"Canlı TV":kind==Kind.MOVIE?"Filmler":"Diziler",entries));}showcase=new CatalogShowcase.Result(Collections.emptyList(),rails);break;
        }
        return new CatalogPresentation(category,items,showcase,archive,archiveTitle,emptyHero);
    }
}
