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
    @Test public void scopedLibraryRestoresRefsAndResolvedFavoritesWithoutCredentials() throws Exception {
        File root=directory();MetadataDiskCache first=new MetadataDiskCache(root);
        MetadataDiskCache.Library library=new MetadataDiskCache.Library(
            new java.util.HashSet<>(Arrays.asList("MOVIE::12","LIVE::34")),
            new java.util.HashSet<>(Collections.singletonList("EPISODE:56:61")),
            Collections.singletonList(item(Kind.MOVIE,"12",SCOPE)));
        first.writeLibrary(SCOPE,EXPIRY,NOW,library,()->true);
        MetadataDiskCache second=new MetadataDiskCache(root);
        MetadataDiskCache.Snapshot<MetadataDiskCache.Library> restored=second.readLibrary(SCOPE,EXPIRY,NOW+1);
        assertNotNull(restored);assertEquals(library.favorites,restored.value.favorites);assertEquals(library.watched,restored.value.watched);
        assertEquals("12",restored.value.items.get(0).id);assertEquals(SCOPE,restored.value.items.get(0).scope);
        assertNull(second.readLibrary("other:source",EXPIRY,NOW+1));assertNull(second.readLibrary(SCOPE,NOW+1,NOW+1));
    }
    @Test public void malformedOrUnownedResolvedLibraryItemsCannotReplaceAnExistingSnapshot() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);
        MetadataDiskCache.Library valid=new MetadataDiskCache.Library(new java.util.HashSet<>(Collections.singletonList("MOVIE::12")),Collections.emptySet(),Collections.singletonList(item(Kind.MOVIE,"12",SCOPE)));
        cache.writeLibrary(SCOPE,EXPIRY,NOW,valid,()->true);
        MetadataDiskCache.Library malformed=new MetadataDiskCache.Library(new java.util.HashSet<>(Collections.singletonList("MOVIE::bad")),Collections.emptySet(),Collections.emptyList());
        cache.writeLibrary(SCOPE,EXPIRY,NOW+1,malformed,()->true);
        MetadataDiskCache.Library wrongScope=new MetadataDiskCache.Library(valid.favorites,valid.watched,Collections.singletonList(item(Kind.MOVIE,"12","other:source")));
        cache.writeLibrary(SCOPE,EXPIRY,NOW+1,wrongScope,()->true);
        assertEquals(NOW,cache.readLibrary(SCOPE,EXPIRY,NOW+2).savedAt);
    }
    @Test public void oldRawLiveDiskSnapshotGetsCurrentCurationWithoutLosingAlternatives() throws Exception {
        Item hd=new Item(Kind.LIVE,"41","TR | ATV HD","9","TR: Ulusal","","ts",SCOPE,"",0,0,"");
        Item fhd=new Item(Kind.LIVE,"42","TR | ATV FHD","9","TR: Ulusal","","ts",SCOPE,"",0,0,"");
        Catalog raw=new Catalog(Kind.LIVE,Arrays.asList(hd,fhd),Collections.singletonList(new Category("9","TR: Ulusal")));
        File root=directory();MetadataDiskCache writer=new MetadataDiskCache(root);writer.writeCatalog(SCOPE,EXPIRY,NOW,raw,()->true);
        Catalog restored=new MetadataDiskCache(root).readCatalog(SCOPE,Kind.LIVE,EXPIRY,NOW+1).value;
        Catalog projected=ProviderParser.filterLiveCatalog(restored,null);
        assertEquals(1,projected.items.size());assertEquals("42",projected.items.get(0).id);assertEquals("ATV",projected.items.get(0).title);
        assertEquals(2,restored.items.size());assertEquals("TR | ATV HD",restored.items.get(0).title);
        assertNull(new MetadataDiskCache(root).readCatalog("other:source",Kind.LIVE,EXPIRY,NOW+1));
    }

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

    @Test public void liveNormalizationRevisionCannotReuseLegacyImplicitHlsButOtherCachesRemainCompatible() throws Exception {
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);
        byte[] payload=new byte[8];
        byte[] identity=java.security.MessageDigest.getInstance("SHA-256").digest((SCOPE+"\u0000catalog:LIVE").getBytes(StandardCharsets.UTF_8));
        StringBuilder filename=new StringBuilder();for(byte value:identity)filename.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
        File legacy=new File(root,filename+".bin");
        try(java.io.DataOutputStream output=new java.io.DataOutputStream(new java.io.FileOutputStream(legacy))){
            output.writeInt(0x46434d31);output.write(identity);output.writeLong(NOW);output.writeLong(EXPIRY);output.writeInt(payload.length);
            output.write(java.security.MessageDigest.getInstance("SHA-256").digest(payload));output.write(payload);
        }
        cache.writeCatalog(SCOPE,EXPIRY,NOW,catalog(SCOPE),()->true);
        assertNull("Old LIVE normalization must refetch; explicit and implicit HLS were indistinguishable",cache.readCatalog(SCOPE,Kind.LIVE,EXPIRY,NOW+1));
        assertNotNull("Movie cache remains compatible",cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1));
        Catalog live=new Catalog(Kind.LIVE,Collections.singletonList(new Item(Kind.LIVE,"34","Live","7","Canlı","","ts",SCOPE,"",0,0,"")),Collections.emptyList());
        cache.writeCatalog(SCOPE,EXPIRY,NOW,live,()->true);
        assertEquals("ts",cache.readCatalog(SCOPE,Kind.LIVE,EXPIRY,NOW+1).value.items.get(0).extension);
    }

    @Test public void releaseEvidenceSurvivesCatalogSeriesAndFavoriteSnapshots()throws Exception{
        File root=directory();MetadataDiskCache cache=new MetadataDiskCache(root);
        Item explicit=new Item(Kind.MOVIE,"12","Film (2026)","9","Filmler","","mp4",SCOPE,"",0,0,"",2025);
        Item conflict=new Item(Kind.MOVIE,"13","Conflict (2026)","9","Filmler","","mp4",SCOPE,"",0,0,"",0);
        cache.writeCatalog(SCOPE,EXPIRY,NOW,new Catalog(Kind.MOVIE,Arrays.asList(explicit,conflict),Collections.emptyList()),()->true);
        Catalog restored=new MetadataDiskCache(root).readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1).value;
        assertEquals(2025,restored.items.get(0).releaseYear);assertEquals(0,restored.items.get(1).releaseYear);
        cache.writeLibrary(SCOPE,EXPIRY,NOW,new MetadataDiskCache.Library(Collections.singleton("MOVIE::13"),Collections.emptySet(),Collections.singletonList(conflict)),()->true);
        assertEquals(0,new MetadataDiskCache(root).readLibrary(SCOPE,EXPIRY,NOW+1).value.items.get(0).releaseYear);
        Item parent=new Item(Kind.SERIES,"56","Series (2026)","9","Diziler","","",SCOPE,"",0,0,"",2025);
        cache.writeSeries(SCOPE,EXPIRY,NOW,new SeriesDetail(parent,Collections.singletonList(new Season(1,Collections.singletonList(item(Kind.EPISODE,"61",SCOPE))))),()->true);
        assertEquals(2025,new MetadataDiskCache(root).readSeries(SCOPE,"56",EXPIRY,NOW+1).value.series.releaseYear);
    }
    private void legacyString(java.io.DataOutputStream output,String value)throws Exception{byte[] bytes=value.getBytes(StandardCharsets.UTF_8);output.writeInt(bytes.length);output.write(bytes);}
    private void legacyItem(java.io.DataOutputStream output,Kind kind,String id,String title,String parent)throws Exception{
        output.writeByte(kind.ordinal());for(String value:new String[]{id,title,"9","Filmler","","mp4",parent})legacyString(output,value);output.writeInt(kind==Kind.EPISODE?1:0);output.writeInt(kind==Kind.EPISODE?1:0);legacyString(output,"Description");
    }
    private void legacyRecord(File root,String key,byte[] payload)throws Exception{
        byte[] identity=java.security.MessageDigest.getInstance("SHA-256").digest((SCOPE+"\u0000"+key).getBytes(StandardCharsets.UTF_8));StringBuilder name=new StringBuilder();for(byte value:identity)name.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
        try(java.io.DataOutputStream output=new java.io.DataOutputStream(new java.io.FileOutputStream(new File(root,name+".bin")))){output.writeInt(0x46434d31);output.write(identity);output.writeLong(NOW);output.writeLong(EXPIRY);output.writeInt(payload.length);output.write(java.security.MessageDigest.getInstance("SHA-256").digest(payload));output.write(payload);}
    }
    @Test public void legacySnapshotsRemainImmediatelyUsableAndRefreshMissingReleaseMetadata()throws Exception{
        File root=directory();java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();java.io.DataOutputStream payload=new java.io.DataOutputStream(bytes);
        payload.writeInt(1);legacyString(payload,"9");legacyString(payload,"Filmler");payload.writeInt(1);legacyItem(payload,Kind.MOVIE,"12","Legacy (2026)","");payload.flush();legacyRecord(root,"catalog:MOVIE",bytes.toByteArray());
        MetadataDiskCache cache=new MetadataDiskCache(root);MetadataDiskCache.Snapshot<Catalog> restored=cache.readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+1);assertNotNull(restored);assertEquals(2026,restored.value.items.get(0).releaseYear);assertTrue(restored.stale(NOW+1));
        bytes.reset();payload=new java.io.DataOutputStream(bytes);payload.writeInt(1);legacyString(payload,"MOVIE::12");payload.writeInt(0);payload.writeInt(1);legacyString(payload,"MOVIE::12");legacyItem(payload,Kind.MOVIE,"12","Legacy (2026)","");payload.flush();legacyRecord(root,"library:refs-v1",bytes.toByteArray());
        assertEquals(2026,cache.readLibrary(SCOPE,EXPIRY,NOW+1).value.items.get(0).releaseYear);
        bytes.reset();payload=new java.io.DataOutputStream(bytes);legacyItem(payload,Kind.SERIES,"56","Legacy series (2026)","");payload.writeInt(1);payload.writeInt(1);payload.writeInt(1);legacyItem(payload,Kind.EPISODE,"61","Episode","56");payload.flush();legacyRecord(root,"series:56",bytes.toByteArray());
        assertEquals(2026,cache.readSeries(SCOPE,"56",EXPIRY,NOW+1).value.series.releaseYear);
        cache.writeCatalog(SCOPE,EXPIRY,NOW+2,new Catalog(Kind.MOVIE,Collections.singletonList(new Item(Kind.MOVIE,"12","Legacy (2026)","9","Filmler","","mp4",SCOPE,"",0,0,"",0)),Collections.emptyList()),()->true);
        assertEquals(0,new MetadataDiskCache(root).readCatalog(SCOPE,Kind.MOVIE,EXPIRY,NOW+3).value.items.get(0).releaseYear);
    }
}
