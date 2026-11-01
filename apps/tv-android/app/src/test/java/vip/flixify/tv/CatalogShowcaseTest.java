package vip.flixify.tv;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import vip.flixify.tv.TvModels.*;

public class CatalogShowcaseTest {
    private Item item(Kind kind,int id,String title,String group,int year,String artwork){return new Item(kind,String.valueOf(id),title,"9",group,artwork,kind==Kind.SERIES?"":"mp4","account:source","",0,0,"",year);}
    private Item movie(int id,String title,String group,int year){return item(Kind.MOVIE,id,title,group,year,"https://images.test/"+id+".jpg");}
    private List<Item> rail(CatalogShowcase.Result result,String id){for(CatalogShowcase.Rail rail:result.rails)if(rail.id.equals(id))return rail.items;throw new AssertionError("Missing rail "+id);}
    private List<String> ids(List<Item> rows){List<String> result=new ArrayList<>();for(Item row:rows)result.add(row.key());return result;}
    private List<Item> visible(CatalogShowcase.Result result){List<Item> rows=new ArrayList<>(result.hero);for(CatalogShowcase.Rail rail:result.rails)rows.addAll(rail.items);return rows;}
    @Test public void homepageSelectsAllKindsFromBeyondTheOldPrefixWithoutOldOrUnknownReleases(){
        List<Item> source=new ArrayList<>();for(int n=1;n<=100;n++)source.add(movie(n,"Old "+n,"Drama",2016));
        for(Kind kind:Arrays.asList(Kind.MOVIE,Kind.SERIES))for(int n=101;n<=200;n++)source.add(item(kind,n,"New "+n,"Group "+(n%5),2026,"https://images.test/"+n+".jpg"));
        source.add(movie(999,"Conflict (2026)","Drama",0));
        for(int n=1;n<=20;n++)source.add(item(Kind.LIVE,n,"Station "+n,"TR: Ulusal",0,""));
        List<Item> original=new ArrayList<>(source);CatalogShowcase.Result result=CatalogShowcase.home(source,"2026-10-31");
        assertEquals(5,result.hero.size());assertEquals(18,rail(result,"home-movies").size());assertEquals(18,rail(result,"home-series").size());assertEquals(12,rail(result,"home-live").size());
        Set<String> keys=new HashSet<>();for(Item row:visible(result)){assertTrue(keys.add(row.key()));if(row.kind!=Kind.LIVE)assertEquals(2026,row.releaseYear);assertSame(source.get(source.indexOf(row)),row);}
        assertEquals(original,source);assertEquals("LIVE:1",rail(result,"home-live").get(0).key());
    }
    @Test public void dailySelectionIsStableAcrossInputOrderAndScopeButChangesOnAnotherDay(){
        List<Item> source=new ArrayList<>(),replacement=new ArrayList<>();for(int n=1;n<=90;n++){Item row=movie(n,"Movie "+n,"Group "+(n%5),2026);source.add(row);replacement.add(new Item(row.kind,row.id,row.title,row.categoryId,row.categoryName,row.artwork,row.extension,"account:new-source",row.seriesId,0,0,"",row.releaseYear));}
        Collections.reverse(replacement);
        CatalogShowcase.Result baseline=CatalogShowcase.home(source,"2026-10-31");
        assertEquals(Arrays.asList("MOVIE:48","MOVIE:27","MOVIE:42","MOVIE:81","MOVIE:58"),ids(baseline.hero));
        assertEquals(Arrays.asList("MOVIE:55","MOVIE:74","MOVIE:90","MOVIE:31","MOVIE:79","MOVIE:38","MOVIE:7","MOVIE:43","MOVIE:13","MOVIE:8","MOVIE:33","MOVIE:73","MOVIE:78","MOVIE:63","MOVIE:3","MOVIE:88","MOVIE:23","MOVIE:53"),ids(rail(baseline,"home-movies")));
        assertEquals(ids(visible(CatalogShowcase.home(source,"2026-10-31"))),ids(visible(CatalogShowcase.home(replacement,"2026-10-31"))));
        assertNotEquals(ids(visible(CatalogShowcase.home(source,"2026-10-31"))),ids(visible(CatalogShowcase.home(source,"2026-11-01"))));
    }
    @Test public void smallHomeInventoriesRemainVisibleAndCoverlessItemsNeverBecomeHeroes(){
        for(int size=1;size<=6;size++){
            List<Item> rows=new ArrayList<>();for(int n=1;n<=size;n++)rows.add(movie(n,"Small "+n,"Drama",2026));
            CatalogShowcase.Result result=CatalogShowcase.home(rows,"day");assertEquals(size,visible(result).size());assertEquals(new HashSet<>(rows),new HashSet<>(visible(result)));
            if(size>1)assertFalse(rail(result,"home-movies").isEmpty());
        }
        Item missing=item(Kind.SERIES,1,"No cover","Drama",2026,"");CatalogShowcase.Result result=CatalogShowcase.home(Collections.singletonList(missing),"day");
        assertTrue(result.hero.isEmpty());assertEquals(Collections.singletonList(missing),rail(result,"home-series"));
        assertTrue(visible(CatalogShowcase.home(Collections.singletonList(movie(1,"Old","Drama",2016)),"day")).isEmpty());
    }
    @Test public void homepageDeduplicatesIdentityAndUnicodeTitlesAndPrefersArtInRails(){
        List<Item> rows=new ArrayList<>();for(int n=1;n<=50;n++)rows.add(item(Kind.MOVIE,n,"Missing "+n,"Group",2026,""));
        for(int n=100;n<=140;n++)rows.add(movie(n,"Covered "+n,"Group",2026));
        rows.add(movie(900,"COVERED 100","Group",2026));rows.add(rows.get(0));
        CatalogShowcase.Result result=CatalogShowcase.home(rows,"day");Set<String> titles=new HashSet<>();for(Item row:visible(result))assertTrue(titles.add(row.title.toLowerCase(java.util.Locale.ROOT)));
        for(Item row:rail(result,"home-movies"))assertFalse(row.artwork.isEmpty());
        try{result.hero.clear();fail("Immutable presentation");}catch(UnsupportedOperationException expected){}
    }
    @Test public void moviesBuildRealFranchisesAndRequireArtOnlyForAction(){
        Item marvel=movie(1,"Örümcek Adam: Eve Dönüş (2017)","Box Setler",2017),unrelated=movie(2,"Yenilmez - Undisputed (2002)","Drama",2002),fantasy=movie(3,"Yüzüklerin Efendisi (2001)","Bilim Kurgu - Fantastik Filmler",2001),alien=movie(4,"Alien (1979)","Bilim Kurgu - Fantastik Filmler",1979),action=movie(5,"Action","TR | Aksiyon - Macera Filmleri",2025),missing=item(Kind.MOVIE,6,"No poster","Aksiyon (Yerli)",2025,"");
        CatalogShowcase.Result result=CatalogShowcase.movies(Arrays.asList(marvel,unrelated,fantasy,alien,action,missing),"day");
        assertEquals(Collections.singletonList(marvel),rail(result,"movies-marvel"));assertEquals(Collections.singletonList(fantasy),rail(result,"movies-fantasy"));assertEquals(Collections.singletonList(action),rail(result,"movies-action"));assertTrue(result.hero.isEmpty());
        for(String name:new String[]{"Avengers: Endgame","Yenilmezler: Sonsuzluk Savaşı","Iron Man","Kaptan Amerika","Thor"})assertEquals(name,1,rail(CatalogShowcase.movies(Collections.singletonList(movie(10,name,"Drama",2019)),"day"),"movies-marvel").size());
        for(String name:new String[]{"Harry Potter","Fantastik Canavarlar","The Lord of the Rings","Hobbit","Narnia Günlükleri"})assertEquals(name,1,rail(CatalogShowcase.movies(Collections.singletonList(movie(11,name,"Drama",2019)),"day"),"movies-fantasy").size());
    }
    @Test public void moviesKeepSmallCollectionsAndReplenishFailedPostersAcrossAliases(){
        Item only=movie(1,"New (2026)","Drama",2026);CatalogShowcase.Result small=CatalogShowcase.movies(Collections.singletonList(only),"day");assertEquals(Collections.singletonList(only),small.hero);assertEquals(Collections.singletonList(only),rail(small,"movies-2026"));
        Item shared=movie(2,"Avengers (2012)","Aksiyon",2012);CatalogShowcase.Result both=CatalogShowcase.movies(Collections.singletonList(shared),"day");assertEquals(Collections.singletonList(shared),rail(both,"movies-marvel"));assertEquals(Collections.singletonList(shared),rail(both,"movies-action"));
        Item failed=movie(3,"Avengers (2012)","Drama",2012),alias=movie(4,"AVENGERS (2012)","Drama",2012),good=movie(5,"Thor (2011)","Drama",2011);
        assertEquals(Collections.singletonList(good),rail(CatalogShowcase.movies(Arrays.asList(failed,alias,good),"day",Collections.singleton(failed.key())),"movies-marvel"));
        Item wrongKind=item(Kind.SERIES,8,good.title,"Drama",2011,"");assertEquals(Collections.singletonList(good),rail(CatalogShowcase.movies(Arrays.asList(good,wrongKind),"day",Collections.singleton(wrongKind.key())),"movies-marvel"));
        Item noArt=item(Kind.MOVIE,6,"Action duplicate","Aksiyon",2025,""),covered=movie(7,"Action duplicate","Aksiyon",2025);
        assertEquals(Collections.singletonList(covered),rail(CatalogShowcase.movies(Arrays.asList(noArt,covered),"day"),"movies-action"));
    }
    @Test public void seriesExposeDailyAndCategoryRailsWithoutLosingTheArchive(){
        List<Item> rows=new ArrayList<>();for(int n=1;n<=90;n++)rows.add(item(Kind.SERIES,n,"Series "+n,"Group "+(n%5),2010,""));
        CatalogShowcase.Result result=CatalogShowcase.series(rows,"day");assertTrue(result.hero.isEmpty());assertEquals(12,rail(result,"series-primary").size());assertEquals("Günün Seçkisi",result.rails.get(0).title);
        assertEquals(new HashSet<>(rows),new HashSet<>(visible(result)));assertEquals(rows.size(),visible(result).size());assertTrue(result.rails.size()<=6);
    }
    @Test public void calendarDayUsesIstanbulAtTheUtcBoundary(){
        assertEquals("2026-11-01",CatalogShowcase.dayKey(1793482200000L));
    }
}
