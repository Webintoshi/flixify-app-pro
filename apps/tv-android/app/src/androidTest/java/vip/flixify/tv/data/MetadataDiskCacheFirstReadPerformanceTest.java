package vip.flixify.tv.data;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MetadataDiskCacheFirstReadPerformanceTest {
    private static final String SCOPE="disk-latency-account:disk-latency-source";
    private static final int[] COUNTS={12000,12000,5000};
    private static final Kind[] KINDS={Kind.LIVE,Kind.MOVIE,Kind.SERIES};

    @Test public void completeLargeDiskCatalogReadsStayBelowOneSecondEach() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();
        File directory=new File(context.getCacheDir(),"disk-first-content-"+System.nanoTime());
        assertTrue(directory.mkdirs());
        long now=System.currentTimeMillis(),expiry=now+3600000;
        MetadataDiskCache writer=new MetadataDiskCache(directory);
        try {
            for(int n=0;n<KINDS.length;n++)writer.writeCatalog(SCOPE,expiry,now,fixture(KINDS[n],COUNTS[n]),()->true);
            MetadataDiskCache reader=new MetadataDiskCache(directory);
            List<String> slow=new ArrayList<>();
            for(int n=0;n<KINDS.length;n++) {
                long start=SystemClock.elapsedRealtimeNanos();
                MetadataDiskCache.Snapshot<Catalog> restored=reader.readCatalog(SCOPE,KINDS[n],expiry,System.currentTimeMillis());
                double elapsed=(SystemClock.elapsedRealtimeNanos()-start)/1000000.0;
                assertNotNull("Complete disk fixture must exist",restored);
                assertEquals(COUNTS[n],restored.value.items.size());
                assertEquals(String.valueOf(100000+COUNTS[n]-1),restored.value.items.get(COUNTS[n]-1).id);
                Log.i("DiskCatalogLatency",new JSONObject().put("kind",KINDS[n]).put("items",COUNTS[n]).put("diskReadMs",elapsed).put("budgetMs",1000).toString());
                if(elapsed>1000)slow.add(KINDS[n]+"="+elapsed+"ms");
            }
            assertTrue("Complete cached catalog reads exceeded1000ms: "+slow,slow.isEmpty());
        } finally {writer.clear();remove(directory);}
    }
    private static Catalog fixture(Kind kind,int count){
        List<Item> rows=new ArrayList<>(count);
        String description="Çevrimdışı kayıtlı içerik açıklaması. Uygulama gerçek arşivi, aramayı ve kategori bilgisini korurken bu verileri tekrar indirmeden okuyabilmelidir.";
        for(int n=0;n<count;n++){
            String id=String.valueOf(100000+n);
            rows.add(new Item(kind,id,(kind==Kind.LIVE?"Örnek TV ":"Kayıtlı İçerik ")+id+" (2026)","1","Genel","https://artwork.fixture.invalid/"+id+".jpg",kind==Kind.LIVE?"ts":"mp4",SCOPE,"",0,0,description,kind==Kind.LIVE?0:2026));
        }
        return new Catalog(kind,rows,Arrays.asList(new Category("1","Genel")));
    }
    private static void remove(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);assertTrue(file.delete());}
}
