package vip.flixify.tv.data;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;
import vip.flixify.tv.TvModels.Account;
import vip.flixify.tv.TvModels.Catalog;
import vip.flixify.tv.TvModels.Failure;
import vip.flixify.tv.TvModels.Kind;
import vip.flixify.tv.TvModels.Item;
import vip.flixify.tv.ReadyLiveSurfaceProbe;
import vip.flixify.tv.TvRepository.Callback;
import static org.junit.Assert.*;

/** Exercises the real repository; every connection ends in this HTTPS fixture. */
@RunWith(AndroidJUnit4.class)
public class ReadyLiveProjectionRestartTest {
    private static final long NOW=1700000000000L;
    private static final long RESTART_BUDGET_MS=1000;
    private static final int RAW_COUNT=12000,SELECTED_COUNT=11997;
    private static final long HELD_REQUEST_MS=5000;

    private static final class Result<T> implements Callback<T> {
        volatile T value;
        volatile Failure error;
        volatile long deliveredAt;
        volatile int calls;
        @Override public void onResult(T value){this.value=value;deliveredAt=System.nanoTime();calls++;}
        @Override public void onError(Failure error){this.error=error;deliveredAt=System.nanoTime();calls++;}
    }

    @Test public void verifiedDiskLiveRestartDeliversCompleteProjectionWithin1000ms() throws Exception {
        try(Harness h=new Harness()) {
            Result<Catalog> seed=new Result<>();h.repository.catalog(Kind.LIVE,false,seed);
            assertTrue("Full provider seed did not complete",h.dispatchUntil(seed,30000));
            assertNull(seed.error);assertEquals(SELECTED_COUNT,seed.value.items.size());
            LiveChannelCuration.Projection expected=(LiveChannelCuration.Projection)field(h.repository,"curatedLive");
            assertGoldenAliases(expected);
            ReadyLiveSurfaceProbe.Sample expectedSurface=ReadyLiveSurfaceProbe.prepare(seed.value);
            java.util.List<LiveChannelLineup.Info> expectedInfo=new java.util.ArrayList<>();
            for(Item item:seed.value.items)expectedInfo.add(LiveChannelLineup.info(item));
            int verifiedBefore=h.fixture.bootstrapReads.get();
            h.reopen();
            assertEquals("Restart must verify current provider authority",verifiedBefore+1,h.fixture.bootstrapReads.get());
            assertNull("Restart cannot retain the old projection",field(h.repository,"curatedLive"));
            assertTrue("Restart cannot retain old raw catalog memory",((java.util.Map<?,?>)field(h.repository,"catalogs")).isEmpty());

            Result<Catalog> restored=new Result<>();long requested=System.nanoTime();h.repository.catalog(Kind.LIVE,false,restored);
            assertTrue("Complete disk LIVE result did not finish",h.dispatchUntil(restored,30000));
            assertNull(restored.error);assertEquals(1,restored.calls);assertEquals(SELECTED_COUNT,restored.value.items.size());
            long callbackMs=elapsed(requested,restored.deliveredAt);
            ReadyLiveSurfaceProbe.Sample surface=ReadyLiveSurfaceProbe.prepare(restored.value);
            long preparationCompleteMs=elapsed(requested,System.nanoTime());
            android.util.Log.i("ReadyLiveRestart",new JSONObject().put("stage","verified-repository-disk-restart")
                .put("rawCount",RAW_COUNT).put("selectedCount",restored.value.items.size()).put("callbackMs",callbackMs)
                .put("categoryPreparationMs",surface.categoriesNanos/1000000.0).put("presentationPreparationMs",surface.presentationNanos/1000000.0)
                .put("callbackPlusPreparationMs",preparationCompleteMs).put("callbackBudgetMs",RESTART_BUDGET_MS)
                .put("measurement","real repository/disk and complete presentation preparation; no Activity pixel timing").toString());
            assertEquals("Restart cache hit must not fetch any provider catalog",1,h.fixture.liveReads.get());
            assertEquals(expectedSurface.categorySignature,surface.categorySignature);assertEquals(SELECTED_COUNT,surface.itemCount);
            LiveChannelCuration.Projection actual=(LiveChannelCuration.Projection)field(h.repository,"curatedLive");
            assertSame(restored.value,actual.catalog);assertProjection(expected,actual);assertGoldenAliases(actual);
            for(int i=0;i<restored.value.items.size();i++) {
                LiveChannelLineup.Info left=expectedInfo.get(i),right=LiveChannelLineup.info(restored.value.items.get(i));
                assertEquals(left.countryId,right.countryId);assertEquals(left.categoryId,right.categoryId);assertEquals(left.name,right.name);
                assertEquals(left.id,right.id);assertEquals(left.section,right.section);assertEquals(left.position,right.position,0);
            }
            Result<Catalog> warm=new Result<>();long warmStart=System.nanoTime();h.repository.catalog(Kind.LIVE,false,warm);
            assertTrue("Warm memory callback must retain the existing 500 ms budget",h.dispatchUntil(warm,500));
            assertNull(warm.error);assertSame(restored.value,warm.value);assertTrue(elapsed(warmStart,warm.deliveredAt)<=500);
            assertTrue("Verified disk restart callback took "+callbackMs+" ms; budget="+RESTART_BUDGET_MS+" ms",callbackMs<=RESTART_BUDGET_MS);
            assertTrue("Restored presentation still requires expensive first-use work: callback plus complete preparation="+preparationCompleteMs+" ms",preparationCompleteMs<=RESTART_BUDGET_MS);
        }
    }

    @Test public void sameRevisionChangedExclusionsInvalidateReadyProjectionAndDeferredMemoryResult()throws Exception {
        try(Harness h=new Harness(true)){
            h.fixture.livePolicy=policy('a',false);refresh(h);Catalog seeded=load(h,false);assertEquals("100001",seeded.items.get(0).id);
            h.reopen();Catalog restored=load(h,false);assertEquals("100001",restored.items.get(0).id);h.drainPersistence();h.deliveries.clear();
            Result<Catalog> deferred=new Result<>();h.repository.catalog(Kind.LIVE,false,deferred);Runnable delivery=h.nextDelivery();assertEquals(0,deferred.calls);
            String previous=policyKey(h.repository);h.fixture.livePolicy=policy('a',true);refresh(h);assertNotEquals(previous,policyKey(h.repository));
            delivery.run();assertTrue(h.dispatchUntil(deferred,5000));assertNull(deferred.error);assertEquals(1,deferred.calls);
            assertEquals("Same revision must not reuse the excluded canonical channel","100000",deferred.value.items.get(0).id);
            assertEquals("100000",load(h,false).items.get(0).id);assertEquals(1,h.fixture.liveReads.get());
        }
    }

    @Test public void deferredReadyMemoryDeliveryStillRejectsLogoutSourceChangeAndExpiry()throws Exception {
        for(String mode:new String[]{"logout","source","expiry"})try(Harness h=new Harness(true)){
            load(h,false);h.reopen();load(h,false);h.drainPersistence();h.deliveries.clear();
            Result<Catalog> deferred=new Result<>();h.repository.catalog(Kind.LIVE,false,deferred);Runnable delivery=h.nextDelivery();assertEquals(0,deferred.calls);
            if(mode.equals("logout"))h.repository.logout();
            else if(mode.equals("source")){h.fixture.source="latency-source-b";refresh(h);}
            else h.now=NOW+600001;
            delivery.run();assertTrue(h.dispatchUntil(deferred,5000));assertEquals(mode,1,deferred.calls);assertNull(mode,deferred.value);
            assertNotNull(mode,deferred.error);assertEquals(mode,Failure.Code.STALE,deferred.error.code);
        }
    }

    @Test public void sameClockForcedRefreshUsesNewCommittedRawIdentity()throws Exception {
        try(Harness h=new Harness(true)){
            load(h,false);h.drainPersistence();MetadataDiskCache.Snapshot<Catalog> before=rawSnapshot(h.repository);assertNotNull(before);
            h.fixture.liveRows=new JSONArray().put(new JSONObject().put("stream_id","100002").put("name","BBC News HD").put("category_id","13").put("container_extension","ts"));
            Catalog changed=load(h,true);assertEquals("100002",changed.items.get(0).id);h.drainPersistence();
            MetadataDiskCache.Snapshot<Catalog> after=rawSnapshot(h.repository);assertNotNull(after);assertEquals(before.savedAt,after.savedAt);assertNotEquals(before.payloadHash,after.payloadHash);
            assertSame(((java.util.Map<?,?>)field(h.repository,"catalogs")).get(Kind.LIVE),after.value);
            h.reopen();Catalog restored=load(h,false);assertEquals("100002",restored.items.get(0).id);assertEquals(2,h.fixture.liveReads.get());
        }
    }

    @Test public void failedRawCommitCannotAuthorizeReadyPersistenceOrDelayDelivery()throws Exception {
        try(Harness h=new Harness(true)){
            File blockedDirectory=new File(h.files,"catalog-cache-v1");assertTrue(blockedDirectory.createNewFile());
            Catalog value=load(h,false);assertEquals("100001",value.items.get(0).id);h.drainPersistence();
            assertNull("No digest receipt may exist when the atomic raw commit failed",rawSnapshot(h.repository));
            assertTrue(blockedDirectory.isFile());assertEquals(0,blockedDirectory.length());
        }
    }

    @Test public void queuedReadyWritesRemainOptionalAcrossPlaybackTrimLogoutClearAndQueueRejection()throws Exception {
        for(String mode:new String[]{"playback","trim","logout","disk-clear","queue-full"})try(Harness h=new Harness(true)){
            load(h,false);h.drainPersistence();MetadataDiskCache.Snapshot<Catalog> raw=rawSnapshot(h.repository);assertNotNull(raw);
            java.util.concurrent.ThreadPoolExecutor persistence=(java.util.concurrent.ThreadPoolExecutor)field(h.repository,"persistenceWorker");
            CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1);Object player=new Object();
            persistence.execute(()->{held.countDown();try{release.await(10,TimeUnit.SECONDS);}catch(InterruptedException stopped){Thread.currentThread().interrupt();}});
            try{
                assertTrue(held.await(3,TimeUnit.SECONDS));
                if(mode.equals("queue-full"))for(int i=0;i<4;i++)persistence.execute(()->{});
                h.fixture.livePolicy=policy('b',false);refresh(h);String key=policyKey(h.repository);
                File expected=readyFile(h.files,raw,key);assertFalse(expected.exists());
                if(mode.equals("playback"))vip.flixify.tv.BackgroundWorkGate.beginPlayback(player);
                else if(mode.equals("trim"))h.repository.trimMemory(Kind.LIVE);
                else if(mode.equals("logout"))h.repository.logout();
                else if(mode.equals("disk-clear"))((MetadataDiskCache)field(h.repository,"metadataDisk")).clear();
                release.countDown();
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
                while((persistence.getActiveCount()!=0 || !persistence.getQueue().isEmpty()) && System.nanoTime()<deadline)Thread.sleep(5);
                assertEquals(0,persistence.getActiveCount());assertTrue(persistence.getQueue().isEmpty());assertFalse(mode+" must not commit the queued ready record",expected.exists());
            }finally{release.countDown();vip.flixify.tv.BackgroundWorkGate.endPlayback(player);}
        }
    }

    @Test public void queuedReadyWriteCannotReviveAfterShortenedLeaseAndRenewal()throws Exception{assertShortenedReadyLease(false);}
    @Test public void inProgressReadyWriteRejectsLeaseShorteningBeforeCommit()throws Exception{assertShortenedReadyLease(true);}
    private static void assertShortenedReadyLease(boolean duringWrite)throws Exception {
        try(Harness h=new Harness(true)){
            CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
            java.util.concurrent.atomic.AtomicBoolean armed=new java.util.concurrent.atomic.AtomicBoolean();AtomicInteger checks=new AtomicInteger();
            if(duringWrite){
                MetadataDiskCache controlled=new MetadataDiskCache(new File(h.files,"catalog-cache-v1"),64L*1024*1024,16L*1024*1024,32L*1024*1024,()->{
                    if(armed.get() && checks.incrementAndGet()==2){entered.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException stopped){Thread.currentThread().interrupt();}}
                    return Long.MAX_VALUE;
                });
                Field disk=NetworkTvRepository.class.getDeclaredField("metadataDisk");disk.setAccessible(true);disk.set(h.repository,controlled);
            }
            long longExpiry=NOW+86400000,shortExpiry=NOW+30000;h.fixture.leaseExpiry=longExpiry;refresh(h);load(h,false);h.drainPersistence();
            MetadataDiskCache.Snapshot<Catalog> raw=rawSnapshot(h.repository);assertNotNull(raw);String scope=h.repository.currentScope();
            SourceGuard guard=(SourceGuard)field(h.repository,"guard");long generation=guard.generation();
            if(duringWrite)armed.set(true);
            else ((ExecutorService)field(h.repository,"persistenceWorker")).execute(()->{entered.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException stopped){Thread.currentThread().interrupt();}});
            try{
                if(!duringWrite)assertTrue(entered.await(3,TimeUnit.SECONDS));
                h.fixture.livePolicy=policy('c',false);refresh(h);String policy=policyKey(h.repository);File queued=readyFile(h.files,raw,policy);
                if(duringWrite)assertTrue("Ready payload never reached its controlled in-progress write",entered.await(3,TimeUnit.SECONDS));
                assertFalse(queued.exists());h.fixture.leaseExpiry=shortExpiry;refresh(h);
                assertEquals("A shorter deadline does not change source identity",generation,guard.generation());assertEquals(shortExpiry,guard.current().expiresAtMs);
                release.countDown();h.drainPersistence();
                if(duringWrite)assertFalse("A deadline shortened during encoding must reject the pending commit",queued.exists());
                // Renew while still active so expiry cleanup cannot hide a wrongly long disk record.
                h.now=NOW+10000;h.fixture.leaseExpiry=longExpiry;refresh(h);assertEquals(generation,guard.generation());
                h.now=shortExpiry+1;MetadataDiskCache disk=(MetadataDiskCache)field(h.repository,"metadataDisk");
                MetadataDiskCache.Snapshot<Catalog> renewedRaw=disk.readCatalog(scope,Kind.LIVE,longExpiry,h.now);assertNotNull(renewedRaw);
                assertNull("Ready metadata written across a shortened lease must not revive after renewal",disk.readReadyLive(scope,longExpiry,h.now,renewedRaw,policy,java.util.Collections.emptySet()));
            }finally{release.countDown();}
        }
    }

    private static Catalog load(Harness h,boolean force)throws Exception{Result<Catalog> result=new Result<>();h.repository.catalog(Kind.LIVE,force,result);assertTrue(h.dispatchUntil(result,10000));assertNull(result.error);assertEquals(1,result.calls);return result.value;}
    private static void refresh(Harness h)throws Exception{Result<Account> result=new Result<>();h.repository.refreshAccess(result);assertTrue(h.dispatchUntil(result,10000));assertNull(result.error);}
    private static JSONObject policy(char revision,boolean excluded)throws Exception{char[] chars=new char[64];java.util.Arrays.fill(chars,revision);return new JSONObject().put("revision",new String(chars)).put("excludedIds",excluded?new JSONArray().put("100001"):new JSONArray());}
    @SuppressWarnings("unchecked") private static MetadataDiskCache.Snapshot<Catalog> rawSnapshot(NetworkTvRepository repository)throws Exception{return (MetadataDiskCache.Snapshot<Catalog>)field(repository,"liveRawSnapshot");}
    private static String policyKey(NetworkTvRepository repository)throws Exception{return (String)field(field(repository,"verifiedLivePolicy"),"key");}
    private static File readyFile(File files,MetadataDiskCache.Snapshot<Catalog> raw,String policy)throws Exception{
        String key="latency-fixture-account:latency-source-a\0live-ready:v1:"+raw.format+":"+raw.payloadHash+":"+policy;
        byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));StringBuilder name=new StringBuilder();for(byte value:hash)name.append(String.format(Locale.ROOT,"%02x",value&255));
        return new File(new File(files,"catalog-cache-v1"),name+".bin");
    }

    private static JSONArray liveGroups() throws Exception {
        String[] groups=groupNames();JSONArray result=new JSONArray();
        for(int i=0;i<groups.length;i++)result.put(new JSONObject().put("category_id",Integer.toString(i+1)).put("category_name",groups[i]));
        return result;
    }
    private static String[] groupNames(){return new String[]{"Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Ulusal","Türkiye Haber","Türkiye Haber","Türkiye Spor","Türkiye Spor","Türkiye Çocuk","Türkiye Belgesel","UK News","Germany National","Italy National","Türkiye Radyo"};}
    private static JSONArray liveRows() throws Exception {
        String[] channels={"TRT 1 HD","Kanal D HD","ATV HD","Show TV HD","NOW HD","Star TV HD","TRT Haber HD","CNN Türk HD","beIN Sports 1 HD","S Sport HD","TRT Çocuk HD","National Geographic HD","BBC News HD","ZDF HD","RAI 1 HD","Radyo İstanbul"};
        JSONArray result=new JSONArray();
        for(int i=0;i<RAW_COUNT;i++)result.put(new JSONObject().put("stream_id",Integer.toString(100000+i))
            .put("name",channels[i%channels.length]+(i<channels.length?"":" | Bölge "+i)).put("category_id",Integer.toString(i%channels.length+1))
            .put("container_extension","ts").put("stream_icon",i%4==0?"":"https://fixture.invalid/catalog-performance.png").put("plot","Çevrimdışı performans kataloğu"));
        return result;
    }
    private static Object field(Object target,String name) throws Exception {Field value=target.getClass().getDeclaredField(name);value.setAccessible(true);return value.get(target);}
    private static void assertGoldenAliases(LiveChannelCuration.Projection projection){
        assertNotNull(projection);assertEquals(SELECTED_COUNT,projection.catalog.items.size());
        assertEquals(java.util.Arrays.asList("100480","100576","100720","102160"),projection.aliases("100720"));
        for(int i=0;i<RAW_COUNT;i++) {
            String id=Integer.toString(100000+i),expected=i==480 || i==576 || i==2160?"100720":id;
            assertNotNull(projection.original(id));assertNotNull(projection.resolve(id));assertEquals(expected,projection.resolve(id).id);
            assertTrue(projection.aliases(expected).contains(id));
        }
    }
    private static void assertProjection(LiveChannelCuration.Projection expected,LiveChannelCuration.Projection actual){
        assertEquals(expected.catalog.categories.size(),actual.catalog.categories.size());
        for(int i=0;i<expected.catalog.categories.size();i++) {
            assertEquals(expected.catalog.categories.get(i).id,actual.catalog.categories.get(i).id);
            assertEquals(expected.catalog.categories.get(i).title,actual.catalog.categories.get(i).title);
        }
        for(int i=0;i<expected.catalog.items.size();i++)assertItem(expected.catalog.items.get(i),actual.catalog.items.get(i));
        for(int i=0;i<RAW_COUNT;i++) {
            String id=Integer.toString(100000+i);assertItem(expected.original(id),actual.original(id));
            assertItem(expected.resolve(id),actual.resolve(id));assertEquals(expected.aliases(id),actual.aliases(id));
        }
    }
    private static void assertItem(Item left,Item right){
        assertNotNull(right);assertEquals(left.kind,right.kind);assertEquals(left.id,right.id);assertEquals(left.title,right.title);
        assertEquals(left.categoryId,right.categoryId);assertEquals(left.categoryName,right.categoryName);assertEquals(left.artwork,right.artwork);
        assertEquals(left.extension,right.extension);assertEquals(left.scope,right.scope);assertEquals(left.seriesId,right.seriesId);
        assertEquals(left.season,right.season);assertEquals(left.episode,right.episode);assertEquals(left.description,right.description);
        assertEquals(left.sourceTitle,right.sourceTitle);assertEquals(left.releaseYear,right.releaseYear);
    }
    private static long elapsed(long start,long end){return TimeUnit.NANOSECONDS.toMillis(end-start);}
    private static String date(long value){
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));return format.format(new Date(value));
    }
    private static void remove(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);assertTrue("Fixture cache cleanup failed",file.delete());}

    private static final class Hold implements AutoCloseable {
        final CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);
        final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
        volatile boolean enabled;
        volatile long startedAt,releasedAt;
        void block() throws IOException {
            if(!enabled)return;
            synchronized(this){
                if(startedAt==0){
                    startedAt=System.nanoTime();
                    timer.schedule(()->{releasedAt=System.nanoTime();release.countDown();},HELD_REQUEST_MS,TimeUnit.MILLISECONDS);
                    started.countDown();
                }
            }
            try{if(!release.await(8,TimeUnit.SECONDS))throw new IOException("Held fixture did not release");}
            catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IOException("Held fixture interrupted");}
        }
        @Override public void close(){release.countDown();timer.shutdownNow();}
    }

    private static final class Fixture implements NetworkTvRepository.ConnectionFactory,AutoCloseable {
        final Hold packages=new Hold(),library=new Hold();
        final AtomicInteger libraryReads=new AtomicInteger(),movieReads=new AtomicInteger(),liveReads=new AtomicInteger(),bootstrapReads=new AtomicInteger();
        final JSONArray liveGroups;volatile JSONArray liveRows;
        volatile boolean rejectProvider;volatile JSONObject livePolicy;volatile long leaseExpiry=NOW+600000;
        Fixture(boolean small) throws Exception {liveGroups=liveGroups();liveRows=small?new JSONArray().put(new JSONObject().put("stream_id","100000").put("name","TRT 1 HD").put("category_id","1").put("container_extension","ts"))
            .put(new JSONObject().put("stream_id","100001").put("name","TRT 1 FHD").put("category_id","1").put("container_extension","ts")):liveRows();}
        volatile String source="latency-source-a";
        volatile boolean includeMovieFavorite;
        volatile long liveCategoriesAt,liveStreamsAt;
        @Override public HttpURLConnection open(URL url) throws Exception {
            assertEquals("https",url.getProtocol());
            assertNull("Fixture requests must not contain URL user info",url.getUserInfo());
            boolean api="api.flixify.vip".equals(url.getHost());
            assertTrue("Unexpected fixture host",api || "provider.test".equals(url.getHost()));
            if(api)assertNull("API request must not carry a provider query",url.getQuery());
            else {assertFalse("A restarted valid cache must not request provider data",rejectProvider);assertEquals("/player_api.php",url.getPath());}
            return new HttpsURLConnection(url) {
                private final ByteArrayOutputStream body=new ByteArrayOutputStream();
                private byte[] response;
                @Override public void connect(){}
                @Override public void disconnect(){}
                @Override public boolean usingProxy(){return false;}
                @Override public String getCipherSuite(){return "TLS_FIXTURE";}
                @Override public Certificate[] getLocalCertificates(){return null;}
                @Override public Certificate[] getServerCertificates(){return new Certificate[0];}
                @Override public OutputStream getOutputStream(){return body;}
                private void resolve() throws IOException {
                    if(response!=null)return;
                    try{
                        Object raw;String path=url.getPath();
                        if(api){
                            if("/auth/login-by-code".equals(path)){
                                assertEquals("POST",getRequestMethod());
                                assertNull(getRequestProperty("Authorization"));
                                assertEquals("ABCD1234EFGH5678",new JSONObject(body.toString("UTF-8")).getString("code"));
                                raw=new JSONObject().put("accessToken","fixture-access").put("refreshToken","fixture-refresh-token-with-32-chars").put("user",user());
                            }else if("/me".equals(path)){
                                requireBearer();raw=new JSONObject().put("user",user());
                            }else if("/me/provider-session".equals(path)){
                                requireBearer();bootstrapReads.incrementAndGet();raw=new JSONObject().put("accountId","latency-fixture-account").put("sourceVersion",source)
                                    .put("providerOrigin","https://provider.test").put("username","fixture-user").put("password","fixture-password")
                                    .put("expiresAt",date(leaseExpiry)).put("moviePolicy","general-audience-only").put("livePolicy",livePolicy);
                            }else if("/me/personal-library".equals(path)){
                                requireBearer();libraryReads.incrementAndGet();library.block();
                                JSONArray favorites=new JSONArray();
                                if(includeMovieFavorite)favorites.put(new JSONObject().put("source","personal").put("sourceVersion",source).put("kind","movie").put("id","12"));
                                raw=new JSONObject().put("favorites",favorites).put("watched",new JSONArray());
                            }else if("/admin/packages/public".equals(path)){
                                assertEquals("GET",getRequestMethod());assertNull(getRequestProperty("Authorization"));packages.block();
                                raw=new JSONObject().put("items",new JSONArray().put(new JSONObject().put("slug","6-ay").put("durationMonths",6).put("isActive",true).put("priceLabel","699 ₺")));
                            }else throw new AssertionError("Unexpected API fixture endpoint");
                        }else{
                            assertEquals("GET",getRequestMethod());assertNull("Provider requests must not contain API authorization",getRequestProperty("Authorization"));
                            String query=url.getQuery();
                            assertNotNull(query);
                            if(query.endsWith("&action=get_vod_categories"))raw=categories("9","Filmler");
                            else if(query.endsWith("&action=get_vod_streams")){
                                movieReads.incrementAndGet();raw=streams("12","Fixture Film","9","mp4");
                            }else if(query.endsWith("&action=get_live_categories")){
                                liveCategoriesAt=System.nanoTime();raw=liveGroups;
                            }else if(query.endsWith("&action=get_live_streams")){
                                liveStreamsAt=System.nanoTime();liveReads.incrementAndGet();raw=liveRows;
                            }else throw new AssertionError("Unexpected provider fixture action");
                        }
                        response=raw.toString().getBytes(StandardCharsets.UTF_8);
                    }catch(IOException error){throw error;}
                    catch(Exception error){throw new IOException("Invalid in-memory fixture",error);}
                }
                private void requireBearer(){assertEquals("Bearer fixture-access",getRequestProperty("Authorization"));assertEquals("GET",getRequestMethod());}
                @Override public int getResponseCode() throws IOException {resolve();return 200;}
                @Override public String getHeaderField(String name){return "Content-Length".equalsIgnoreCase(name) && response!=null?Integer.toString(response.length):null;}
                @Override public InputStream getInputStream() throws IOException {resolve();return new ByteArrayInputStream(response);}
            };
        }
        private JSONObject user() throws Exception {
            return new JSONObject().put("id","latency-fixture-account").put("status","active").put("codeSuffix","5678")
                .put("hasAssignedLink",true).put("hasActiveSubscription",true)
                .put("activePackage",new JSONObject().put("title","Fixture Paket").put("endsAt",date(leaseExpiry)));
        }
        private JSONArray categories(String id,String title) throws Exception {return new JSONArray().put(new JSONObject().put("category_id",id).put("category_name",title));}
        private JSONArray streams(String id,String title,String category,String extension) throws Exception {
            return new JSONArray().put(new JSONObject().put("stream_id",id).put("name",title).put("category_id",category).put("container_extension",extension));
        }
        @Override public void close(){packages.close();library.close();}
    }

    private static final class Harness implements AutoCloseable {
        final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
        final Fixture fixture;
        volatile long now=NOW;
        final File files;
        NetworkTvRepository repository;
        final Context isolated;
        Harness() throws Exception {this(false);}
        Harness(boolean small) throws Exception {
            fixture=new Fixture(small);
            Context app=ApplicationProvider.getApplicationContext();
            files=new File(app.getCacheDir(),"catalog-latency-"+System.nanoTime());
            assertTrue(files.mkdirs());
            isolated=new ContextWrapper(app){
                @Override public Context getApplicationContext(){return this;}
                @Override public File getFilesDir(){return files;}
                @Override public android.content.SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(files.getName()+"-"+name,mode);}
            };
            repository=new NetworkTvRepository(isolated,fixture,()->now,deliveries::add);
            Result<Account> login=new Result<>();repository.login("ABCD1234EFGH5678",login);
            assertTrue("Fixture login did not finish",dispatchUntil(login,5000));
            assertNull(login.error);assertTrue(login.value.canPlay);
            assertEquals("latency-fixture-account:latency-source-a",repository.currentScope());
        }
        boolean dispatchUntil(Result<?> target,long milliseconds) throws Exception {
            long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(milliseconds);
            while(target.calls==0){
                long remaining=deadline-System.nanoTime();if(remaining<=0)return false;
                Runnable delivery=deliveries.poll(remaining,TimeUnit.NANOSECONDS);if(delivery==null)return false;delivery.run();
            }
            return true;
        }
        Runnable nextDelivery() throws Exception {
            Runnable delivery=deliveries.poll(5,TimeUnit.SECONDS);assertNotNull("Repository did not dispatch its completion",delivery);return delivery;
        }
        void assertCatalog(Result<Catalog> result,Kind kind){
            assertEquals(1,result.calls);assertNull(result.error);assertNotNull(result.value);assertEquals(kind,result.value.kind);
            assertEquals(1,result.value.items.size());assertEquals(repository.currentScope(),result.value.items.get(0).scope);
        }
        void drainPersistence() throws Exception {
            for(String name:new String[]{"worker","primaryCatalogWorker","metadataWorker","persistenceWorker"}) {
                ExecutorService executor=(ExecutorService)field(repository,name);
                executor.submit(()->{}).get(15,TimeUnit.SECONDS);
            }
        }
        void stopWithoutLogout() throws Exception {
            ((android.os.Handler)field(repository,"main")).removeCallbacksAndMessages(null);
            java.util.List<ExecutorService> executors=new java.util.ArrayList<>();
            for(Field entry:NetworkTvRepository.class.getDeclaredFields())if(ExecutorService.class.isAssignableFrom(entry.getType())){
                entry.setAccessible(true);ExecutorService executor=(ExecutorService)entry.get(repository);executors.add(executor);executor.shutdownNow();
            }
            for(ExecutorService executor:executors)assertTrue("Repository worker did not stop",executor.awaitTermination(5,TimeUnit.SECONDS));
            deliveries.clear();
        }
        void reopen() throws Exception {
            drainPersistence();stopWithoutLogout();
            Field info=LiveChannelLineup.class.getDeclaredField("CACHE");info.setAccessible(true);((java.util.Map<?,?>)info.get(null)).clear();
            fixture.rejectProvider=true;
            repository=new NetworkTvRepository(isolated,fixture,()->now,deliveries::add);
            assertTrue("Encrypted login must survive repository restart",repository.hasSession());
            Result<Account> access=new Result<>();repository.refreshAccess(access);
            assertTrue("Fresh bootstrap after restart did not complete",dispatchUntil(access,5000));
            assertNull(access.error);assertTrue(access.value.canPlay);
            assertEquals("latency-fixture-account:latency-source-a",repository.currentScope());
        }
        @Override public void close() throws Exception {
            fixture.close();repository.logout();stopWithoutLogout();
            for(String name:new String[]{"tv_encrypted_session","tv_scoped_resume","tv_welcome_resolved_v1"})isolated.getSharedPreferences(name,Context.MODE_PRIVATE).edit().clear().commit();
            remove(files);
        }
    }
}
