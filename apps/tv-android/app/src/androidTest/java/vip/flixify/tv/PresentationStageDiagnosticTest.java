package vip.flixify.tv;

import android.os.SystemClock;
import android.util.Log;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.data.LiveChannelCuration;
import static org.junit.Assert.*;

/** Offline stage timings only; existing fixed performance gates stay separate. */
@RunWith(AndroidJUnit4.class)
public class PresentationStageDiagnosticTest {
    private static final String TAG="PresentationStages";
    private static final int COUNT=12000;
    private final JSONArray samples=new JSONArray();

    @Test public void completeRawLiveProjectionAndMovieStages() throws Exception {
        List<Item> live=fixture(Kind.LIVE),movies=fixture(Kind.MOVIE);
        List<Item> liveBefore=new ArrayList<>(live),moviesBefore=new ArrayList<>(movies);
        List<Category> groups=new ArrayList<>();String[] genres={"Aksiyon","Dram","Fantastik","Bilim Kurgu","Komedi","Macera","Suç","Belgesel"};for(int i=0;i<genres.length;i++)groups.add(new Category("g"+i,genres[i]));
        Catalog raw=new Catalog(Kind.LIVE,live,groups);
        long start=SystemClock.elapsedRealtimeNanos();
        LiveChannelCuration.Projection cold=LiveChannelCuration.curate(raw,Collections.emptySet());
        record("cold.full.LiveChannelCuration.curate",start,COUNT,cold.catalog.items.size());
        verifyProjection(raw,cold);
        start=SystemClock.elapsedRealtimeNanos();
        LiveChannelCuration.Projection warm=LiveChannelCuration.curate(raw,Collections.emptySet());
        record("warm.full.LiveChannelCuration.curate",start,COUNT,warm.catalog.items.size());
        verifyProjection(raw,warm);
        int named=0;start=SystemClock.elapsedRealtimeNanos();
        for(Item item:live)if(!LiveChannelCuration.describe(item.sourceTitle,item.categoryName).displayName.isEmpty())named++;
        record("warm.loop.LiveChannelCuration.describe",start,COUNT,named);assertEquals(COUNT,named);

        start=SystemClock.elapsedRealtimeNanos();CatalogShowcase.Result full=CatalogShowcase.movies(movies,"2026-11-02");
        record("cold.full.CatalogShowcase.movies",start,COUNT,visibleCount(full));assertEquals(4,full.rails.size());
        Method ranked=method("ranked",List.class,String.class),order=method("order",List.class,String.class);
        Object[] catalogArguments={movies,"2026-11-02"};
        start=SystemClock.elapsedRealtimeNanos();List<?> rankedRows=(List<?>)ranked.invoke(null,catalogArguments);record("warm.stage.ranked",start,COUNT,rankedRows.size());assertEquals(COUNT,rankedRows.size());
        start=SystemClock.elapsedRealtimeNanos();List<?> orderedRows=(List<?>)order.invoke(null,catalogArguments);record("warm.stage.order.includingRanked",start,COUNT,orderedRows.size());assertEquals(COUNT,orderedRows.size());
        Object[] itemArgument=new Object[1],textArgument=new Object[1];
        Method title=method("title",Item.class),movieText=method("movieText",String.class),group=method("group",Item.class);
        long characters=0;start=SystemClock.elapsedRealtimeNanos();for(Item item:movies){itemArgument[0]=item;characters+=((String)title.invoke(null,itemArgument)).length();}record("warm.loop.title.reflection",start,COUNT,characters);
        characters=0;start=SystemClock.elapsedRealtimeNanos();for(Item item:movies){textArgument[0]=item.title;characters+=((String)movieText.invoke(null,textArgument)).length();}record("warm.loop.movieText.title.reflection",start,COUNT,characters);
        characters=0;start=SystemClock.elapsedRealtimeNanos();for(Item item:movies){textArgument[0]=item.categoryName;characters+=((String)movieText.invoke(null,textArgument)).length();}record("warm.loop.movieText.category.reflection",start,COUNT,characters);
        characters=0;start=SystemClock.elapsedRealtimeNanos();for(Item item:movies){itemArgument[0]=item;characters+=((String)group.invoke(null,itemArgument)).length();}record("warm.loop.group.reflection",start,COUNT,characters);
        Method baseline=Integer.class.getMethod("signum",int.class);Object[] baselineArgument={1};int sum=0;start=SystemClock.elapsedRealtimeNanos();for(int i=0;i<COUNT;i++)sum+=(Integer)baseline.invoke(null,baselineArgument);record("warm.loop.reflectionBaseline.Integer.signum",start,COUNT,sum);assertEquals(COUNT,sum);
        start=SystemClock.elapsedRealtimeNanos();CatalogShowcase.Result warmFull=CatalogShowcase.movies(movies,"2026-11-02");record("warm.full.CatalogShowcase.movies",start,COUNT,visibleCount(warmFull));
        assertEquals(full.rails.size(),warmFull.rails.size());assertIdentityOrder(full.hero,warmFull.hero);for(int i=0;i<full.rails.size();i++)assertIdentityOrder(full.rails.get(i).items,warmFull.rails.get(i).items);
        assertIdentityOrder(liveBefore,live);assertIdentityOrder(moviesBefore,movies);
        Log.i(TAG,new JSONObject().put("fixture","unchanged-performance-fixture-12000-live-12000-movies").put("timingPolicy","diagnostic-only; no product budget assertions changed").put("measurements",samples).toString());
    }
    private void record(String stage,long start,int input,long output) throws Exception {JSONObject sample=new JSONObject().put("stage",stage).put("wallMs",(SystemClock.elapsedRealtimeNanos()-start)/1000000.0).put("inputCount",input).put("outputCount",output);samples.put(sample);Log.i(TAG,sample.toString());}
    private static Method method(String name,Class<?>... arguments)throws Exception {Method value=CatalogShowcase.class.getDeclaredMethod(name,arguments);value.setAccessible(true);return value;}
    @SuppressWarnings("unchecked") private static List<Item> fixture(Kind kind)throws Exception {Method value=PresentationHotPathPerformanceTest.class.getDeclaredMethod("fixture",Kind.class);value.setAccessible(true);return (List<Item>)value.invoke(null,kind);}
    private static void verifyProjection(Catalog raw,LiveChannelCuration.Projection projection){
        assertEquals(COUNT,raw.items.size());assertEquals(11997,projection.catalog.items.size());
        java.util.Map<Item,Boolean> selectedItems=new java.util.IdentityHashMap<>();for(Item item:projection.catalog.items)selectedItems.put(item,true);
        for(Item item:raw.items){
            assertSame("Original raw identity "+item.id,item,projection.original(item.id));Item selected=projection.resolve(item.id);assertNotNull("Resolve every fixture ID "+item.id,selected);assertTrue("Resolved item belongs to projected catalog",selectedItems.containsKey(selected));
            Item originalSelected=projection.original(selected.id);assertNotNull(originalSelected);assertEquals(originalSelected.scope,selected.scope);assertEquals(originalSelected.sourceTitle,selected.sourceTitle);assertEquals(originalSelected.extension,selected.extension);assertTrue("Requested ID belongs to selected aliases",projection.aliases(selected.id).contains(item.id));
            String expected=item.id.equals("100480") || item.id.equals("100576") || item.id.equals("102160")?"100720":item.id;assertEquals("Exact fixture alias "+item.id,expected,selected.id);
        }
        assertEquals(Arrays.asList("100480","100576","100720","102160"),projection.aliases("100720"));
    }
    private static int visibleCount(CatalogShowcase.Result result){int count=result.hero.size();for(CatalogShowcase.Rail rail:result.rails)count+=rail.items.size();return count;}
    private static void assertIdentityOrder(List<Item> expected,List<Item> actual){assertEquals(expected.size(),actual.size());for(int i=0;i<expected.size();i++)assertSame("index "+i,expected.get(i),actual.get(i));}
}
