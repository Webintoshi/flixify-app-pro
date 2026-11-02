package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.recyclerview.widget.RecyclerView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.data.LiveChannelLineup;
import static org.junit.Assert.*;

/** Offline regression fixture: navigation callbacks have a 500ms UI-thread budget. */
@RunWith(AndroidJUnit4.class)
public class CatalogPerformanceTest {
    private static final String TAG="CatalogPerformance";
    private static final String ART="https://fixture.invalid/catalog-performance.png";
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final JSONArray measurements=new JSONArray();
    private FakeTvRepository repository;
    private MainActivity activity;

    @Test public void largeOfflineCatalogNavigationBaseline() throws Exception {
        repository=new FakeTvRepository();repository.session=true;
        installCachedArtwork();
        repository.catalogOverrides.put(Kind.LIVE,fixture(Kind.LIVE,12000));
        repository.catalogOverrides.put(Kind.MOVIE,fixture(Kind.MOVIE,12000));
        repository.catalogOverrides.put(Kind.SERIES,fixture(Kind.SERIES,5000));
        persist();
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));
        try {
            long launch=SystemClock.elapsedRealtimeNanos();
            activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
            instrumentation.waitForIdleSync();
            record(new JSONObject().put("stage","navigation.Home.launch").put("wallMs",ms(SystemClock.elapsedRealtimeNanos()-launch)));
            awaitSurface("Ana Sayfa",0,true);
            assertAlive();
            navigate("Canlı TV",12000,false);
            navigate("Filmler",12000,true);
            navigate("Diziler",5000,true);
            navigate("Ana Sayfa",0,true);
            forceGc();long retainedBefore=usedHeap();
            for(int cycle=0;cycle<2;cycle++) {
                navigate("Canlı TV",12000,false);navigate("Filmler",12000,true);
                navigate("Diziler",5000,true);navigate("Ana Sayfa",0,true);
                final int pass=cycle;
                measure("trim.runningLow."+pass,()->activity.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW));
                navigate("Canlı TV",12000,false);navigate("Ana Sayfa",0,true);
            }
            forceGc();long retainedAfter=usedHeap();
            record(new JSONObject().put("stage","stress.retainedHeap").put("heapBeforeBytes",retainedBefore).put("heapAfterBytes",retainedAfter).put("growthBytes",retainedAfter-retainedBefore).put("growthBudgetBytes",67108864L));
            assertTrue("Repeated catalog/trim navigation retains less than 64MiB additional heap",retainedAfter-retainedBefore<67108864L);
            // Run exact preparation functions separately after navigation: deliberately labelled warm.
            for(Kind kind:new Kind[]{Kind.LIVE,Kind.MOVIE,Kind.SERIES}) {
                Catalog catalog=repository.catalogOverrides.get(kind);
                measure("diagnostic.warm.filtered."+kind,()->{
                    assertEquals(catalog.items.size(),CatalogFilterData.filtered(catalog,"","").size());
                    Item last=catalog.items.get(catalog.items.size()-1);
                    assertEquals("Last archive item remains searchable",1,CatalogFilterData.preview(catalog,"",last.title).count);
                });
            }
            Catalog live=repository.catalogOverrides.get(Kind.LIVE);
            measure("diagnostic.warm.LiveChannelLineup.sort",()->assertEquals(12000,LiveChannelLineup.sort(live.items).size()));
            measure("diagnostic.warm.liveCategories",()->assertEquals(12000,CatalogFilterData.categories(live,"").get(0).count));
            measure("diagnostic.warm.CatalogShowcase.movies",()->assertEquals(4,CatalogShowcase.movies(repository.catalogOverrides.get(Kind.MOVIE).items,"2026-11-02").rails.size()));
            measure("diagnostic.warm.CatalogShowcase.series",()->assertFalse(CatalogShowcase.series(repository.catalogOverrides.get(Kind.SERIES).items,"2026-11-02").rails.isEmpty()));
        } finally {
            persist();
            if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());
            instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));
        }
    }

    private Catalog fixture(Kind kind,int count) {
        String[] genres={"Aksiyon","Dram","Fantastik","Bilim Kurgu","Komedi","Macera","Suç","Belgesel"};
        String[] movies={"Örümcek-Adam: Yepyeni Bir Gün","Thor","Harry Potter ve Felsefe Taşı","Fısıltı Adam","Telaşlı Baba","Yüzüklerin Efendisi","Yenilmezler","Sessiz Deniz"};
        String[] series={"The East Palace","The Boroughs","Mahsun J","Yıldız Günlükleri","Kuzeyin Hikâyesi","Şehir Günlükleri"};
        String[] channels={"TRT 1 HD","Kanal D HD","ATV HD","Show TV HD","NOW HD","Star TV HD","TRT Haber HD","CNN Türk HD","beIN Sports 1 HD","S Sport HD","TRT Çocuk HD","National Geographic HD","BBC News HD","ZDF HD","RAI 1 HD","Radyo İstanbul"};
        String[] liveGroups={"Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Haber","Türkiye Haber","Türkiye Spor","Türkiye Spor","Türkiye Çocuk","Türkiye Belgesel","UK News","Germany National","Italy National","Türkiye Radyo"};
        List<Item> rows=new ArrayList<>(count);List<Category> categories=new ArrayList<>();
        for(int i=0;i<genres.length;i++)categories.add(new Category("g"+i,genres[i]));
        for(int i=0;i<count;i++) {
            int year=i%10==0?2026:1980+i%46;
            String title=kind==Kind.LIVE?channels[i%channels.length]+(i<channels.length?"":" | Bölge "+i):((kind==Kind.MOVIE?movies[i%movies.length]:series[i%series.length])+" · "+i+" ("+year+")");
            String group=kind==Kind.LIVE?liveGroups[i%liveGroups.length]:genres[i%genres.length];
            rows.add(new Item(kind,String.valueOf(100000+i),title,"g"+(i%genres.length),group,i%4==0?"":ART,"mp4",repository.scope,"",0,0,"Çevrimdışı performans kataloğu",title,kind==Kind.LIVE?0:year));
        }
        return new Catalog(kind,rows,categories);
    }

    private void installCachedArtwork() throws Exception {
        ArtworkDiskCache cache=new ArtworkDiskCache(new File(instrumentation.getTargetContext().getCacheDir(),"artwork-v1"));
        Bitmap bitmap=BitmapFactory.decodeResource(instrumentation.getTargetContext().getResources(),R.drawable.flixify_logo);
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes));bitmap.recycle();
        assertTrue(cache.write(repository.scope,ART,bytes.toByteArray(),()->true));
    }

    private void navigate(String label,int expected,boolean discovery) throws Exception {
        long wallStart=SystemClock.elapsedRealtimeNanos();
        MainHeartbeat heartbeat=new MainHeartbeat();
        instrumentation.runOnMainSync(heartbeat::start);
        try {
            measure("navigation."+label+".mainCallback",()->{
                View target=findText(activity.getWindow().getDecorView(),label);assertNotNull(label,target);assertTrue(target.performClick());
            });
            awaitSurface(label,expected,discovery);
            record(new JSONObject().put("stage","surface."+label).put("wallMs",ms(SystemClock.elapsedRealtimeNanos()-wallStart)));
            assertAlive();
            instrumentation.runOnMainSync(()->{
                RecyclerView grid=findGrid(activity.getWindow().getDecorView());assertNotNull(label+" catalog surface",grid);
                if(discovery)assertTrue(grid instanceof DiscoveryScreen);
                if(expected>0)assertTrue(label+" retains the complete archive",grid.getAdapter().getItemCount()>=expected);
                assertTrue(label+" has bounded attached holders",grid.getChildCount()<100);
                if(expected>0)grid.scrollToPosition(grid.getAdapter().getItemCount()-1);
            });
            instrumentation.waitForIdleSync();
            instrumentation.runOnMainSync(()->assertTrue("Archive end still recycles",findGrid(activity.getWindow().getDecorView()).getChildCount()<100));
        } finally {
            instrumentation.runOnMainSync(heartbeat::stop);
            record(new JSONObject().put("stage","navigation."+label+".continuousHeartbeat").put("intervalMs",16).put("maxMainLagMs",heartbeat.maxLagMs).put("samples",heartbeat.samples).put("windowWallMs",ms(SystemClock.elapsedRealtimeNanos()-wallStart)));
        }
        assertTrue(label+" async binding/layout blocks the main heartbeat for "+heartbeat.maxLagMs+"ms (budget 500ms)",heartbeat.maxLagMs<=500);
    }

    private static final class MainHeartbeat implements Runnable {
        private final Handler handler=new Handler(Looper.getMainLooper());
        private long dueMs,maxLagMs;private int samples;private boolean active;
        void start(){active=true;dueMs=SystemClock.uptimeMillis()+16;handler.postAtTime(this,dueMs);}
        @Override public void run(){if(!active)return;long now=SystemClock.uptimeMillis();maxLagMs=Math.max(maxLagMs,Math.max(0,now-dueMs));samples++;dueMs=now+16;handler.postAtTime(this,dueMs);}
        void stop(){maxLagMs=Math.max(maxLagMs,Math.max(0,SystemClock.uptimeMillis()-dueMs));active=false;handler.removeCallbacks(this);}
    }

    private void awaitSurface(String label,int expected,boolean discovery) throws Exception {
        String section=label.equals("Canlı TV")?"LIVE":label.equals("Filmler")?"MOVIES":label.equals("Diziler")?"SERIES":"HOME";
        long start=SystemClock.elapsedRealtimeNanos(),deadline=SystemClock.uptimeMillis()+10000;
        boolean[] ready={false};String[] observed={"no surface"};
        do {
            instrumentation.runOnMainSync(()->{
                try {
                    java.lang.reflect.Field pageField=MainActivity.class.getDeclaredField("page");pageField.setAccessible(true);Object page=pageField.get(activity);
                    java.lang.reflect.Field sectionField=page.getClass().getDeclaredField("section");sectionField.setAccessible(true);
                    java.lang.reflect.Field gridField=MainActivity.class.getDeclaredField("grid");gridField.setAccessible(true);RecyclerView grid=(RecyclerView)gridField.get(activity);
                    observed[0]=String.valueOf(sectionField.get(page))+" grid="+(grid==null?"null":grid.getClass().getSimpleName());
                    ready[0]=section.equals(String.valueOf(sectionField.get(page))) && grid!=null && grid.getAdapter()!=null && (!discovery || grid instanceof DiscoveryScreen) && grid.getAdapter().getItemCount()>=expected && grid.getChildCount()>0;
                }catch(ReflectiveOperationException error){throw new AssertionError(error);}
            });
            if(!ready[0])SystemClock.sleep(25);
        }while(!ready[0] && SystemClock.uptimeMillis()<deadline);
        record(new JSONObject().put("stage","awaitSurface."+label).put("wallMs",ms(SystemClock.elapsedRealtimeNanos()-start)).put("ready",ready[0]).put("observed",observed[0]));
        assertTrue(label+" prepares the current complete catalog within 10s; "+observed[0],ready[0]);
    }
    private static long usedHeap(){return Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory();}
    private static void forceGc(){Runtime.getRuntime().gc();Runtime.getRuntime().runFinalization();Runtime.getRuntime().gc();}

    private void measure(String stage,Runnable work) throws Exception {
        JSONObject sample=new JSONObject().put("stage",stage);CountDownLatch heartbeat=new CountDownLatch(1);
        long[] elapsed={0},lag={0},before={0},after={0};
        instrumentation.runOnMainSync(()->{
            before[0]=Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory();long start=SystemClock.elapsedRealtimeNanos();
            new Handler(Looper.getMainLooper()).post(()->{lag[0]=SystemClock.elapsedRealtimeNanos()-start;heartbeat.countDown();});
            try{work.run();}finally{elapsed[0]=SystemClock.elapsedRealtimeNanos()-start;after[0]=Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory();}
        });
        heartbeat.await();
        Debug.MemoryInfo memory=new Debug.MemoryInfo();Debug.getMemoryInfo(memory);
        sample.put("mainWorkMs",ms(elapsed[0])).put("postedHeartbeatDelayMs",ms(lag[0])).put("heapBeforeBytes",before[0]).put("heapAfterBytes",after[0]).put("totalPssKb",memory.getTotalPss()).put("nativeHeapBytes",Debug.getNativeHeapAllocatedSize());
        // /proc reports RSS separately from Android's proportional-set-size measurement.
        try(java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.FileReader("/proc/self/status"))){String line;while((line=reader.readLine())!=null)if(line.startsWith("VmRSS:"))sample.put("rssKb",Long.parseLong(line.replaceAll("[^0-9]","")));}
        record(sample);
        if(stage.startsWith("navigation."))assertTrue(stage+" blocks the UI thread for "+ms(elapsed[0])+"ms (budget 500ms)",elapsed[0]<=500000000L);
    }
    private void record(JSONObject sample) throws Exception {measurements.put(sample);Log.i(TAG,sample.toString());persist();}
    private void persist() throws Exception {
        File directory=instrumentation.getTargetContext().getExternalFilesDir(null);assertNotNull(directory);
        JSONObject report=new JSONObject().put("fixture","offline-12000-live-12000-movies-5000-series").put("timingPolicy","navigation-callback-budget-500ms; pure-functions-diagnostic; surface-await-10s").put("measurements",measurements);
        try(FileOutputStream output=new FileOutputStream(new File(directory,"catalog-performance.json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
    }
    private static double ms(long nanos){return nanos/1000000.0;}
    private void assertAlive(){instrumentation.runOnMainSync(()->{assertFalse(activity.isFinishing());assertFalse(activity.isDestroyed());});}
    private View findText(View view,String label){if(view instanceof TextView && label.contentEquals(((TextView)view).getText()))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=findText(((ViewGroup)view).getChildAt(i),label);if(found!=null)return found;}return null;}
    private RecyclerView findGrid(View view){if(view instanceof RecyclerView)return (RecyclerView)view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){RecyclerView found=findGrid(((ViewGroup)view).getChildAt(i));if(found!=null)return found;}return null;}
}
