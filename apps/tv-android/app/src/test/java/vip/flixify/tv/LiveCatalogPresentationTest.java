package vip.flixify.tv;

import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;

public class LiveCatalogPresentationTest {
    Item channel(String id,String title,String group){return new Item(Kind.LIVE,id,title,"group-"+id,group,"","ts","scope","",0,0,"");}
    Catalog catalog(){return new Catalog(Kind.LIVE,Arrays.asList(channel("1","TRT 1","TR:ULUSAL"),channel("2","BEIN Sport 1","TR:BEINSPORT"),channel("3","CNN Türk","TR:HABER"),channel("4","ZDF","DE:ULUSAL")),Collections.emptyList());}
    @Test public void friendlyCountriesAndCategoriesReplaceProviderLabels(){
        List<CatalogFilterData.CategoryOption> options=CatalogFilterData.categories(catalog(),"");
        assertTrue(options.stream().anyMatch(row->row.title.equals("Türkiye · Ulusal")));
        assertTrue(options.stream().anyMatch(row->row.title.equals("Türkiye · Spor")));
        assertTrue(options.stream().anyMatch(row->row.title.equals("Almanya · Tümü")));
        assertFalse(options.stream().anyMatch(row->row.title.contains("TR:")||row.title.contains("BEINSPORT")));
        assertEquals(1,CatalogFilterData.filtered(catalog(),"@live/tr/sports","").size());
        assertEquals(1,CatalogFilterData.preview(catalog(),"@live/tr/news","cnn turk").count);
    }
    @Test public void liveSearchFoldsPunctuationAccentsAndGroupAndMatchesPreview(){
        Catalog c=catalog();assertEquals(1,CatalogFilterData.filtered(c,"","cnn-turk").size());
        assertEquals(1,CatalogFilterData.preview(c,"","beinsport").count);
        assertEquals(2,CatalogFilterData.preview(c,"","ulusal").count);
    }
    @Test public void vanishedFriendlyFilterFallsBackAndFavoritesCanFilterKinds(){
        Catalog c=catalog();assertEquals(4,CatalogFilterData.filtered(c,"@live/tr/music","").size());
        Item film=new Item(Kind.MOVIE,"5","Eski Film","movie","Dram","","mp4","scope","",0,0,"");
        Catalog favorites=new Catalog(Kind.MOVIE,Arrays.asList(c.items.get(0),film),Collections.emptyList());
        assertEquals(Collections.singletonList(film),CatalogFilterData.filtered(favorites,"@kind/MOVIE",""));
        assertEquals("@kind/MOVIE",CatalogFilterData.effectiveFavoriteCategory(favorites,"@kind/MOVIE"));
        assertEquals(3,CatalogFilterData.favoriteCategories(favorites,"").size());
        assertEquals(2,CatalogFilterData.filtered(favorites,"@live/tr/sports","").size());
    }
}
