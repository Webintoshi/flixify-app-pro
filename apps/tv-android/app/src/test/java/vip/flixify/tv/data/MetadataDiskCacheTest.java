package vip.flixify.tv.data;

import org.junit.Test;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

public class MetadataDiskCacheTest {
    private static final String SCOPE="account-a:source-a";
    private static final long NOW=1700000000000L, EXPIRY=NOW+10L*86400000;
    private Item item(Kind kind,String id,String scope) {return new Item(kind,id,"Fixture","9","Filmler","https://images.test/poster.jpg",kind==Kind.SERIES?"":"mp4",scope,kind==Kind.EPISODE?"56":"",kind==Kind.EPISODE?1:0,kind==Kind.EPISODE?1:0,"Description");}
    private Catalog catalog(String scope) {return new Catalog(Kind.MOVIE,Collections.singletonList(item(Kind.MOVIE,"12",scope)),Collections.singletonList(new Category("9","Filmler")));}
    private File directory() throws Exception {return Files.createTempDirectory("flixify-metadata-test-").toFile();}
    @Test public void survivesRestartButNeverCrossesScopeOrVerifiedExpiry() throws Exception {
        File root=directory();MetadataDiskCache first=new MetadataDiskCache(root);
        first.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);
        MetadataDiskCache second=new MetadataDiskCache(root);
        assertEquals("12",second.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1).value.items.get(0).id);
        assertNull(second.readCatalog("account-b:source-a",Kind.MOVIE,EXPIRY,NOW+1));
        assertNull(second.readCatalog(SCOPE,Kind.MOVIE,NOW+1,NOW+1));
        assertNull(second.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,EXPIRY));
    }
    @Test public void snapshotFreshnessAndMaximumAgeAreSeparateFromAccess() throws Exception {
        MetadataDiskCache cache=new MetadataDiskCache(directory());cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);
        assertFalse(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1).stale(NOW+1));
        assertTrue(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+MetadataDiskCache.FRESH_MS).stale(NOW+MetadataDiskCache.FRESH_MS));
        assertNull(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+MetadataDiskCache.MAX_AGE_MS));
    }
    @Test public void seriesEpisodesAreMetadataOnlyAndRecreatedWithVerifiedScope() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);
        Item parent=item(Kind.SERIES,"56",SCOPE),episode=item(Kind.EPISODE,"61",SCOPE);
        SeriesDetail detail=new SeriesDetail(parent,Collections.singletonList(new Season(1,Collections.singletonList(episode))));
        cache.writeSeries(SCOPE,EXPIRY,NOW,detail,()->true);
        SeriesDetail restored=new MetadataDiskCache(root).readSeries(SCOPE,"56",EXPIRY,NOW+1).value;
        assertEquals("56",restored.series.id);assertEquals(SCOPE,restored.seasons.get(0).episodes.get(0).scope);
        String stored=new String(Files.readAllBytes(root.listFiles()[0].toPath()),StandardCharsets.ISO_8859_1);
        for(String forbidden:Arrays.asList("providerOrigin","username","password","accessToken","refreshToken","/live/","/movie/","/series/"))assertFalse(forbidden,stored.contains(forbidden));
    }
    @Test public void corruptionAndInterruptedFilesCannotReplaceTheValidSnapshot() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);
        Files.write(new File(root,"unfinished.tmp").toPath(),new byte[]{1,2,3});
        assertNotNull(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1));
        File record=Arrays.stream(root.listFiles()).filter(f->f.getName().endsWith(".bin")).findFirst().get();
        byte[] bytes=Files.readAllBytes(record.toPath());bytes[bytes.length-1]^=1;Files.write(record.toPath(),bytes);
        assertNull(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1));
    }
    @Test public void lowDiskOversizeAndFailedGuardPreserveExistingData() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);
        MetadataDiskCache low=new MetadataDiskCache(root,1024*1024,512*1024,32768,()->0L);
        low.writeCatalog(SCOPE,EXPIRY,NOW+1,new Catalog(Kind.MOVIE,Collections.emptyList(),Collections.emptyList()),()->true);
        cache.writeCatalog(SCOPE,EXPIRY,NOW+1,new Catalog(Kind.MOVIE,Collections.emptyList(),Collections.emptyList()),()->false);
        MetadataDiskCache small=new MetadataDiskCache(root,1024,100,0,()->Long.MAX_VALUE);
        small.writeCatalog(SCOPE,EXPIRY,NOW+1,catalog(SCOPE),()->true);
        assertEquals(1,cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+2).value.items.size());
    }
    @Test public void boundedLruEvictsOldRecordsAndClearPreventsLatePublication() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root,600,500,0,()->Long.MAX_VALUE);
        cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);
        Thread.sleep(20);
        cache.writeCatalog("account-b:source-b",EXPIRY,NOW+1,catalog("account-b:source-b"),()->true);
        Thread.sleep(20);assertNotNull(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+2));Thread.sleep(20);
        cache.writeCatalog("account-c:source-c",EXPIRY,NOW+3,catalog("account-c:source-c"),()->true);
        assertTrue(Arrays.stream(root.listFiles()).mapToLong(File::length).sum()<=600);
        assertNotNull(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+4));
        assertNull(cache.readCatalog("account-b:source-b",Kind.MOVIE,EXPIRY,NOW+4));
        cache.clear();assertNull(cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+2));
        AtomicBoolean valid=new AtomicBoolean(true);valid.set(false);cache.writeCatalog(SCOPE,EXPIRY,NOW+2,catalog(SCOPE),valid::get);
        assertEquals(0,root.listFiles().length);
    }
    @Test public void playableUrlsAreExcludedEvenWhenTheyArriveInsideDisplayMetadata() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);
        String media="https://provider.test/live/hidden-user/hidden-password/12.ts";
        Item item=new Item(Kind.MOVIE,"12","Fixture","9","Filmler",media,"mp4",SCOPE,"",0,0,"Watch "+media);
        cache.writeCatalog(SCOPE,EXPIRY,NOW,new Catalog(Kind.MOVIE,Collections.singletonList(item),Collections.emptyList()),()->true);
        Catalog result=cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1).value;
        assertEquals("",result.items.get(0).artwork);assertFalse(result.items.get(0).description.contains("https://"));
        String stored=new String(Files.readAllBytes(root.listFiles()[0].toPath()),StandardCharsets.ISO_8859_1);
        assertFalse(stored.contains("hidden-user"));assertFalse(stored.contains("hidden-password"));
    }
    @Test public void clearDuringWriteInvalidatesTheInFlightEpoch() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);AtomicInteger checks=new AtomicInteger();
        CountDownLatch writing=new CountDownLatch(1),release=new CountDownLatch(1);
        Thread writer=new Thread(()->cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->{
            if(checks.incrementAndGet()==3){writing.countDown();try{release.await(3,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();return false;}}return true;
        }));writer.start();assertTrue(writing.await(3,TimeUnit.SECONDS));
        Thread clear=new Thread(cache::clear);clear.start();long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(clear.getState()!=Thread.State.BLOCKED && clear.isAlive() && System.nanoTime()<until)Thread.yield();
        release.countDown();writer.join(3000);clear.join(3000);assertFalse(writer.isAlive());assertFalse(clear.isAlive());assertEquals(0,root.listFiles().length);
    }
    @Test public void restartRemovesOrphanedTempsAndTinyRecordsCannotExhaustInodes() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);
        cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);File orphan=new File(root,"metadata-interrupted.tmp");Files.write(orphan.toPath(),new byte[4096]);
        MetadataDiskCache reopened=new MetadataDiskCache(root);assertFalse("Interrupted writes must not accumulate outside the byte budget",orphan.exists());assertNotNull(reopened.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1));
        for(int n=1;n<=140;n++){
            String scope="account-"+n+":source-a";reopened.writeCatalog(scope,EXPIRY,NOW+n,new Catalog(Kind.MOVIE,Collections.emptyList(),Collections.emptyList()),()->true);
        }
        assertTrue("Small metadata must have a count bound as well as a byte bound",root.listFiles().length<=128);
    }
}
