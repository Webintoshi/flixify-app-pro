package vip.flixify.tv.data;

import java.util.*;
import org.junit.Test;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Independent original proves the realistic fixture's legitimate technical-token aliases. */
public class LiveCurationFixtureGoldenTest {
    private static final int COUNT=12000;
    @Test public void realisticFullLiveFixtureHasExactlyThreeMergedAliases(){
        List<Category> categories=new ArrayList<>();String[] names={"Aksiyon","Dram","Fantastik","Bilim Kurgu","Komedi","Macera","Suç","Belgesel"};for(int i=0;i<names.length;i++)categories.add(new Category("g"+i,names[i]));Catalog raw=new Catalog(Kind.LIVE,fixture(Kind.LIVE),categories);
        OriginalLiveChannelCuration.Projection original=OriginalLiveChannelCuration.curate(raw,Collections.emptySet());
        LiveChannelCuration.Projection actual=LiveChannelCuration.curate(raw,Collections.emptySet());
        assertEquals(11997,original.catalog.items.size());assertEquals(original.catalog.items.size(),actual.catalog.items.size());
        assertEquals(Arrays.asList("100480","100576","100720","102160"),original.aliases("100720"));
        for(Item item:raw.items){String expected=item.id.equals("100480") || item.id.equals("100576") || item.id.equals("102160")?"100720":item.id;assertEquals(expected,original.resolve(item.id).id);assertEquals(expected,actual.resolve(item.id).id);assertSame(item,original.original(item.id));assertSame(item,actual.original(item.id));assertEquals(original.aliases(expected),actual.aliases(expected));}
        assertProjection(raw,Collections.emptySet(),original,actual);
        for(Set<String> excluded:Arrays.asList(Collections.singleton("100720"),new HashSet<>(Arrays.asList("100480","100576","100720","102160"))))assertProjection(raw,excluded,OriginalLiveChannelCuration.curate(raw,excluded),LiveChannelCuration.curate(raw,excluded));
    }
    @Test public void reusedSelectedDescriptionDoesNotConfuseRepeatedIdsOrGroups(){
        List<Item> items=Arrays.asList(new Item(Kind.LIVE,"9","TRT 1 HD","a","TR:ULUSAL","","ts","scope","",0,0,""),new Item(Kind.LIVE,"9","BBC News HD","b","UK News","","ts","scope","",0,0,""),new Item(Kind.LIVE,"10","TRT 1 FHD","a","TR:ULUSAL","","ts","scope","",0,0,""));
        Catalog raw=new Catalog(Kind.LIVE,items,Arrays.asList(new Category("a","Turkey"),new Category("b","UK")));assertProjection(raw,Collections.emptySet(),OriginalLiveChannelCuration.curate(raw,Collections.emptySet()),LiveChannelCuration.curate(raw,Collections.emptySet()));
    }
    private static void assertProjection(Catalog raw,Set<String> excluded,OriginalLiveChannelCuration.Projection original,LiveChannelCuration.Projection actual){
        assertEquals(original.catalog.kind,actual.catalog.kind);assertEquals(original.catalog.items.size(),actual.catalog.items.size());
        assertEquals(original.catalog.categories.size(),actual.catalog.categories.size());for(int i=0;i<original.catalog.categories.size();i++){assertEquals(original.catalog.categories.get(i).id,actual.catalog.categories.get(i).id);assertEquals(original.catalog.categories.get(i).title,actual.catalog.categories.get(i).title);}
        for(Item item:raw.items){assertSame(original.original(item.id),actual.original(item.id));Item left=original.resolve(item.id),right=actual.resolve(item.id);if(left==null)assertNull(right);else{assertItem(left,right);assertEquals(original.aliases(left.id),actual.aliases(right.id));}}
        for(int i=0;i<original.catalog.items.size();i++)assertItem(original.catalog.items.get(i),actual.catalog.items.get(i));
    }
    private static void assertItem(Item expected,Item found){
        assertNotNull(found);assertEquals(expected.kind,found.kind);assertEquals(expected.id,found.id);assertEquals(expected.title,found.title);assertEquals(expected.categoryId,found.categoryId);assertEquals(expected.categoryName,found.categoryName);assertEquals(expected.artwork,found.artwork);assertEquals(expected.extension,found.extension);assertEquals(expected.scope,found.scope);assertEquals(expected.seriesId,found.seriesId);assertEquals(expected.description,found.description);assertEquals(expected.sourceTitle,found.sourceTitle);assertEquals(expected.season,found.season);assertEquals(expected.episode,found.episode);assertEquals(expected.releaseYear,found.releaseYear);
    }
    private static List<Item> fixture(Kind kind){
        String[] genres={"Aksiyon","Dram","Fantastik","Bilim Kurgu","Komedi","Macera","Suç","Belgesel"};
        String[] movies={"Örümcek-Adam: Yepyeni Bir Gün","Thor","Harry Potter ve Felsefe Taşı","Fısıltı Adam","Telaşlı Baba","Yüzüklerin Efendisi","Yenilmezler","Sessiz Deniz"};
        String[] channels={"TRT 1 HD","Kanal D HD","ATV HD","Show TV HD","NOW HD","Star TV HD","TRT Haber HD","CNN Türk HD","beIN Sports 1 HD","S Sport HD","TRT Çocuk HD","National Geographic HD","BBC News HD","ZDF HD","RAI 1 HD","Radyo İstanbul"};
        String[] liveGroups={"Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Haber","Türkiye Haber","Türkiye Spor","Türkiye Spor","Türkiye Çocuk","Türkiye Belgesel","UK News","Germany National","Italy National","Türkiye Radyo"};
        List<Item> result=new ArrayList<>(COUNT);
        for(int i=0;i<COUNT;i++){
            int year=i%10==0?2026:1980+i%46;
            String title=kind==Kind.LIVE?channels[i%channels.length]+(i<channels.length?"":" | Bölge "+i):movies[i%movies.length]+" · "+i+" ("+year+")";
            String group=kind==Kind.LIVE?liveGroups[i%liveGroups.length]:genres[i%genres.length];
            result.add(new Item(kind,String.valueOf(100000+i),title,"g"+(i%genres.length),group,i%4==0?"":"https://fixture.invalid/catalog-performance.png","mp4","offline:source","",0,0,"Çevrimdışı performans kataloğu",title,kind==Kind.LIVE?0:year));
        }
        return Collections.unmodifiableList(result);
    }
}
