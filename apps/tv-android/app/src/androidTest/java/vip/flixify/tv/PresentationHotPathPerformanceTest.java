package vip.flixify.tv;

import android.os.SystemClock;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.data.LiveChannelLineup;
import static org.junit.Assert.*;

/** Full offline preparation timings on the instrumentation worker; no Activity or provider. */
@RunWith(AndroidJUnit4.class)
public class PresentationHotPathPerformanceTest {
    private static final String TAG="PresentationHotPath";
    private static final long WARM_BUDGET_NANOS=500000000L;
    private static final int COUNT=12000;

    @Test public void fullCatalogWarmSortAndMoviePreparationStayWithin500ms() throws Exception {
        List<Item> live=fixture(Kind.LIVE),movies=fixture(Kind.MOVIE);
        List<Item> liveBefore=new ArrayList<>(live),moviesBefore=new ArrayList<>(movies);
        JSONArray samples=new JSONArray();
        long start=SystemClock.elapsedRealtimeNanos();
        List<Item> coldLive=LiveChannelLineup.sort(live);
        sample(samples,"cold.LiveChannelLineup.sort",start,COUNT,coldLive.size());
        assertOccurrences(live,coldLive);
        start=SystemClock.elapsedRealtimeNanos();
        CatalogShowcase.Result coldMovies=CatalogShowcase.movies(movies,"2026-11-02");
        sample(samples,"cold.CatalogShowcase.movies",start,COUNT,visibleCount(coldMovies));
        assertSourceItems(movies,coldMovies);
        start=SystemClock.elapsedRealtimeNanos();
        List<Item> warmLive=LiveChannelLineup.sort(live);
        long warmSort=SystemClock.elapsedRealtimeNanos()-start;
        sampleElapsed(samples,"warm.LiveChannelLineup.sort",warmSort,COUNT,warmLive.size());
        assertOccurrences(live,warmLive);
        assertIdentityOrder(coldLive,warmLive);
        start=SystemClock.elapsedRealtimeNanos();
        CatalogShowcase.Result warmMovies=CatalogShowcase.movies(movies,"2026-11-02");
        long warmMovie=SystemClock.elapsedRealtimeNanos()-start;
        sampleElapsed(samples,"warm.CatalogShowcase.movies",warmMovie,COUNT,visibleCount(warmMovies));
        assertSourceItems(movies,warmMovies);
        assertIdentityOrder(coldMovies.hero,warmMovies.hero);
        assertEquals(4,warmMovies.rails.size());
        for(int i=0;i<4;i++){
            assertEquals(coldMovies.rails.get(i).id,warmMovies.rails.get(i).id);
            assertIdentityOrder(coldMovies.rails.get(i).items,warmMovies.rails.get(i).items);
        }
        assertIdentityOrder(liveBefore,live);assertIdentityOrder(moviesBefore,movies);
        Log.i(TAG,new JSONObject().put("fixture","offline-full-12000-live-12000-movies").put("timingPolicy","worker-direct-warm-sort-and-movie-500ms; cold-diagnostic").put("measurements",samples).toString());
        assertTrue("Warm complete 12000-channel sort took "+warmSort/1000000.0+"ms; budget 500ms",warmSort<=WARM_BUDGET_NANOS);
        assertTrue("Warm complete 12000-movie showcase took "+warmMovie/1000000.0+"ms; budget 500ms",warmMovie<=WARM_BUDGET_NANOS);
    }

    private static void sample(JSONArray samples,String stage,long start,int input,int output) throws Exception {sampleElapsed(samples,stage,SystemClock.elapsedRealtimeNanos()-start,input,output);}
    private static void sampleElapsed(JSONArray samples,String stage,long elapsed,int input,int output) throws Exception {
        JSONObject value=new JSONObject().put("stage",stage).put("wallMs",elapsed/1000000.0).put("inputCount",input).put("outputCount",output).put("warmBudgetMs",500);
        samples.put(value);Log.i(TAG,value.toString());
    }
    private static int visibleCount(CatalogShowcase.Result result){int count=result.hero.size();for(CatalogShowcase.Rail rail:result.rails)count+=rail.items.size();return count;}
    private static void assertSourceItems(List<Item> source,CatalogShowcase.Result result){
        Map<Item,Boolean> identities=new IdentityHashMap<>();for(Item item:source)identities.put(item,true);
        for(Item item:result.hero)assertTrue(identities.containsKey(item));
        for(CatalogShowcase.Rail rail:result.rails)for(Item item:rail.items)assertTrue(identities.containsKey(item));
    }
    private static void assertIdentityOrder(List<Item> expected,List<Item> actual){assertEquals(expected.size(),actual.size());for(int i=0;i<expected.size();i++)assertSame("index "+i,expected.get(i),actual.get(i));}
    private static void assertOccurrences(List<Item> source,List<Item> result){
        assertEquals(COUNT,result.size());Map<Item,Integer> counts=new IdentityHashMap<>();for(Item item:source){Integer n=counts.get(item);counts.put(item,n==null?1:n+1);}
        for(Item item:result){Integer n=counts.get(item);assertNotNull(n);assertTrue(n>0);counts.put(item,n-1);}for(Integer n:counts.values())assertEquals(0,n.intValue());
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
