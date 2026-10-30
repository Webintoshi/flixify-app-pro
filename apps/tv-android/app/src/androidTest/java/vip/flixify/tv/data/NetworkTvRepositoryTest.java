package vip.flixify.tv.data;

import android.content.Context;
import android.os.Looper;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicInteger;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.TvRepository.Callback;
import vip.flixify.tv.BackgroundWorkGate;
import static org.junit.Assert.*;

/** All traffic terminates in an in-memory HttpURLConnection; no socket is opened. */
@RunWith(AndroidJUnit4.class)
public class NetworkTvRepositoryTest {
    private static final long NOW=1700000000000L;
    private static final class Clock implements NetworkTvRepository.Clock {
        volatile long value=NOW;
        @Override public long now(){return value;}
    }
    private static final class Result<T> implements Callback<T> {
        T value;Failure error;int calls;
        @Override public void onResult(T value){this.value=value;calls++;}
        @Override public void onError(Failure error){this.error=error;calls++;}
    }
    private static String date(long time) {
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));return format.format(new Date(time));
    }
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory {
        volatile boolean eligible=true,denyLibrary=false;
        volatile boolean emptyEpisodes;
        volatile boolean emptyLive;
        final List<String> watchedEpisodes=new ArrayList<>();
        volatile String source="source-a";
        volatile int bootstrapStatus=200;
        volatile long leaseExpiry=NOW+600000;
        final AtomicInteger bootstrapReads=new AtomicInteger(),liveCategoryReads=new AtomicInteger(),liveStreamReads=new AtomicInteger(),epgReads=new AtomicInteger();
        final AtomicInteger seriesCategoryReads=new AtomicInteger(),seriesListReads=new AtomicInteger(),seriesDetailReads=new AtomicInteger();
        final CountDownLatch epgStarted=new CountDownLatch(1),releaseEpg=new CountDownLatch(1);
        volatile boolean holdEpg;
        volatile boolean holdCatalog,holdSeriesDetail;
        final CountDownLatch seriesDetailStarted=new CountDownLatch(1),releaseSeriesDetail=new CountDownLatch(1);
        volatile String liveTitle="Fixture Kanal";
        final CountDownLatch catalogStarted=new CountDownLatch(1),releaseCatalog=new CountDownLatch(1);
        final List<String> favoriteMethods=new ArrayList<>();
        volatile int libraryReads;
        @Override public HttpURLConnection open(URL url) {return new HttpURLConnection(url) {
            private final ByteArrayOutputStream body=new ByteArrayOutputStream();
            private byte[] response;
            private int status;
            @Override public void connect(){}
            @Override public void disconnect(){}
            @Override public boolean usingProxy(){return false;}
            @Override public OutputStream getOutputStream(){return body;}
            private void resolve() {
                if(response!=null)return;
                try {
                    Object raw;status=200;String path=url.getPath();
                    JSONObject user=new JSONObject().put("id","fixture-account").put("status","active").put("codeSuffix","1234").put("hasAssignedLink",eligible).put("hasActiveSubscription",eligible).put("activePackage",eligible?new JSONObject().put("title","Fixture Paket").put("endsAt",date(NOW+600000)):JSONObject.NULL);
                    if(path.equals("/auth/login-by-code") || path.equals("/auth/refresh")) {
                        if(denyLibrary && path.equals("/auth/refresh")){status=401;raw=new JSONObject();}
                        else raw=new JSONObject().put("accessToken","fixture-access").put("refreshToken","fixture-refresh-token-with-32-chars").put("user",user);
                    } else if(path.equals("/me"))raw=new JSONObject().put("user",user);
                    else if(path.equals("/me/provider-session")) {
                        bootstrapReads.incrementAndGet();status=bootstrapStatus;
                        raw=new JSONObject().put("accountId","fixture-account").put("sourceVersion",source).put("providerOrigin","https://provider.test").put("username","fixture-user").put("password","fixture-password").put("expiresAt",date(leaseExpiry)).put("moviePolicy","general-audience-only");
                    }
                    else if(path.equals("/me/personal-library")) {
                        libraryReads++;if(denyLibrary){status=401;raw=new JSONObject();}
                        else {
                            JSONArray watched=new JSONArray();for(String id:watchedEpisodes)watched.put(new JSONObject().put("source","personal").put("sourceVersion",source).put("kind","episode").put("seriesId","56").put("id",id));
                            raw=new JSONObject().put("favorites",new JSONArray().put(new JSONObject().put("source","personal").put("sourceVersion",source).put("kind","movie").put("id","12"))).put("watched",watched);
                        }
                    } else if(path.equals("/me/personal-library/favorites")) {
                        JSONObject ref=new JSONObject(body.toString("UTF-8")).getJSONObject("ref");
                        if(!"12".equals(ref.getString("id")) || !source.equals(ref.getString("sourceVersion")))throw new AssertionError("Wrong personal reference");
                        synchronized(favoriteMethods){favoriteMethods.add(getRequestMethod());}raw=new JSONObject().put("ok",true);
                    } else if(path.equals("/player_api.php")) {
                        String query=url.getQuery();
                        if(query.contains("action=get_vod_categories"))raw=new JSONArray().put(new JSONObject().put("category_id","9").put("category_name","Filmler"));
                        else if(query.contains("action=get_vod_streams"))raw=new JSONArray().put(new JSONObject().put("stream_id","12").put("name","Fixture Film").put("category_id","9").put("container_extension","mp4"));
                        else if(query.contains("action=get_series_categories")) {
                            seriesCategoryReads.incrementAndGet();raw=new JSONArray().put(new JSONObject().put("category_id","8").put("category_name","Diziler"));
                        } else if(query.contains("action=get_series_info")) {
                            seriesDetailReads.incrementAndGet();if(holdSeriesDetail){seriesDetailStarted.countDown();if(!releaseSeriesDetail.await(10,TimeUnit.SECONDS))throw new AssertionError("Series fixture was not released");}
                            JSONObject episodes=new JSONObject();if(!emptyEpisodes)episodes.put("2",new JSONArray().put(episode("63",2,1))).put("1",new JSONArray().put(episode("62",1,2)).put(episode("61",1,1)));
                            raw=new JSONObject().put("episodes",episodes);
                        } else if(query.contains("action=get_series")) {
                            seriesListReads.incrementAndGet();raw=new JSONArray().put(new JSONObject().put("series_id","56").put("name","Fixture Dizi").put("category_id","8"));
                        }
                        else if(query.contains("action=get_live_categories")) {
                            liveCategoryReads.incrementAndGet();if(holdCatalog){catalogStarted.countDown();if(!releaseCatalog.await(10,TimeUnit.SECONDS))throw new AssertionError("Catalog fixture was not released");}raw=new JSONArray().put(new JSONObject().put("category_id","7").put("category_name","Canlı"));
                        } else if(query.contains("action=get_live_streams")) {
                            liveStreamReads.incrementAndGet();raw=emptyLive?new JSONArray():new JSONArray().put(new JSONObject().put("stream_id","34").put("name",liveTitle).put("category_id","7").put("container_extension","ts"));
                        } else if(query.contains("action=get_short_epg")) {
                            epgReads.incrementAndGet();epgStarted.countDown();
                            if(holdEpg && !releaseEpg.await(10,TimeUnit.SECONDS))throw new AssertionError("EPG fixture was not released");
                            raw=new JSONObject().put("epg_listings",new JSONArray().put(new JSONObject().put("title","Rml4dHVyZSBQcm9ncmFtbWU=").put("start_timestamp","1700000000").put("stop_timestamp","1700003600")));
                        } else raw=new JSONArray();
                    } else throw new AssertionError("Unexpected request path");
                    response=raw.toString().getBytes(StandardCharsets.UTF_8);
                }catch(Exception exception){throw new AssertionError(exception);}
            }
            @Override public int getResponseCode(){resolve();return status;}
            @Override public String getHeaderField(String name){resolve();return "Content-Length".equals(name)?Integer.toString(response.length):null;}
            @Override public InputStream getInputStream(){resolve();return new ByteArrayInputStream(response);}
        };}
        private JSONObject episode(String id,int season,int episode) throws Exception {
            return new JSONObject().put("id",id).put("title","Fixture Bölüm "+id).put("season",season).put("episode_num",episode).put("container_extension","mp4");
        }
    }
    private static final class Harness {
        final Context context=ApplicationProvider.getApplicationContext();
        final Clock clock=new Clock();final Fixture fixture=new Fixture();
        final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
        final NetworkTvRepository repository;
        Harness(boolean restored) throws Exception {
            TokenStore store=new TokenStore(context);store.clear();
            context.getSharedPreferences("tv_scoped_resume",Context.MODE_PRIVATE).edit().clear().commit();
            if(restored)store.save(new TokenStore.Session("fixture-access","fixture-refresh-token-with-32-chars","fixture-account","1234"));
            repository=new NetworkTvRepository(context,fixture,clock,deliveries::add);
        }
        void deliver() throws Exception {Runnable delivery=deliveries.poll(5,TimeUnit.SECONDS);assertNotNull("Worker did not complete",delivery);delivery.run();}
        void awaitQueued(int count) throws Exception {
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(deliveries.size()<count && System.nanoTime()<deadline)Thread.sleep(5);
            assertTrue("Expected queued completions",deliveries.size()>=count);
        }
    }
    @Test public void initialAndRestoredBootstrapCanPublishPlayableAccount() throws Exception {
        for(boolean restored:new boolean[]{false,true}) {
            Harness h=new Harness(restored);try {
                Result<Account> result=new Result<>();if(restored)h.repository.account(false,result);else h.repository.login("ABCD1234EFGH5678",result);
                h.deliver();assertNull(result.error);assertNotNull(result.value);assertTrue(result.value.canPlay);assertEquals("fixture-account:source-a",h.repository.currentScope());
            }finally{h.repository.logout();}
        }
    }
    @Test public void coldVerifiedScopeReadsCatalogFromDiskWithoutProviderRefetch() throws Exception {
        Harness h=new Harness(true);NetworkTvRepository restored=null;
        try {
            Result<Catalog> first=new Result<>();h.repository.catalog(Kind.LIVE,false,first);h.deliver();assertNull(first.error);
            Fixture fresh=new Fixture();restored=new NetworkTvRepository(h.context,fresh,h.clock,h.deliveries::add);
            Result<Catalog> cached=new Result<>();restored.catalog(Kind.LIVE,false,cached);h.deliver();
            assertNull(cached.error);assertEquals(first.value.items.get(0).id,cached.value.items.get(0).id);
            assertEquals("Cold cache still needs current verified access",1,fresh.bootstrapReads.get());
            assertEquals("Verified current-scope snapshot skips provider category download",0,fresh.liveCategoryReads.get());
            assertEquals("Verified current-scope snapshot skips provider stream download",0,fresh.liveStreamReads.get());
        }finally{if(restored!=null)restored.logout();h.repository.logout();}
    }
    @Test public void coldSeriesDetailUsesPrivateSnapshotButPlaybackStillRevalidatesEverything() throws Exception {
        Harness h=new Harness(true);NetworkTvRepository restored=null;
        try {
            SeriesDetail first=warmSeries(h);Fixture fresh=new Fixture();restored=new NetworkTvRepository(h.context,fresh,h.clock,h.deliveries::add);
            Result<SeriesDetail> cached=new Result<>();restored.series(seriesCandidate("fixture-account:source-a"),cached);h.deliver();assertNull(cached.error);assertEquals(first.seasons.size(),cached.value.seasons.size());
            assertEquals(0,fresh.seriesDetailReads.get());assertEquals(0,fresh.seriesCategoryReads.get());assertEquals(0,fresh.seriesListReads.get());
            Result<Playback> playback=new Result<>();restored.playback(cached.value.seasons.get(0).episodes.get(0),playback);h.deliver();assertNull(playback.error);assertNotNull(playback.value);
            assertEquals("Playback still freshly verifies the parent catalog",1,fresh.seriesListReads.get());assertEquals(1,fresh.seriesDetailReads.get());assertEquals(2,fresh.bootstrapReads.get());
        }finally{if(restored!=null)restored.logout();h.repository.logout();}
    }
    @Test public void forcedRefreshBypassesDiskAndStoredExpiryCannotBeExtendedByNewBootstrap() throws Exception {
        Harness h=new Harness(true);NetworkTvRepository restored=null;
        try {
            warmLive(h);h.fixture.liveTitle="Refreshed";Result<Catalog> force=new Result<>();h.repository.catalog(Kind.LIVE,true,force);h.deliver();assertEquals("Refreshed",force.value.items.get(0).title);assertEquals(2,h.fixture.liveStreamReads.get());
            Fixture fresh=new Fixture();h.clock.value=NOW+600001;fresh.leaseExpiry=NOW+1200000;restored=new NetworkTvRepository(h.context,fresh,h.clock,h.deliveries::add);
            Result<Catalog> afterExpiry=new Result<>();restored.catalog(Kind.LIVE,false,afterExpiry);h.deliver();assertNull(afterExpiry.error);assertEquals(1,fresh.liveStreamReads.get());
        }finally{if(restored!=null)restored.logout();h.repository.logout();}
    }
    @Test public void staleRefreshUsesOptionalLaneAndPublishesOnlyAfterInitialCachedResult() throws Exception {
        Harness h=new Harness(true);AutoCloseable subscription=null;
        try {
            h.fixture.leaseExpiry=NOW+10L*86400000;Item live=warmLive(h);h.clock.value+=MetadataDiskCache.FRESH_MS;
            h.fixture.holdCatalog=true;h.fixture.liveTitle="Updated channel";BlockingQueue<Catalog> updates=new LinkedBlockingQueue<>();subscription=h.repository.observeCatalog(updates::add);
            Result<Catalog> cached=new Result<>();h.repository.catalog(Kind.LIVE,false,cached);h.deliver();assertEquals("Fixture Kanal",cached.value.items.get(0).title);
            assertTrue(h.fixture.catalogStarted.await(5,TimeUnit.SECONDS));
            Result<Playback> playback=new Result<>();h.repository.playback(live,playback);h.deliver();assertNull(playback.error);assertNotNull(playback.value);assertNull(updates.peek());
            h.fixture.releaseCatalog.countDown();h.deliver();assertEquals("Updated channel",updates.poll(1,TimeUnit.SECONDS).items.get(0).title);
            assertEquals(2,h.fixture.liveCategoryReads.get());assertEquals(2,h.fixture.liveStreamReads.get());
        }finally{h.fixture.releaseCatalog.countDown();if(subscription!=null)subscription.close();h.repository.logout();}
    }
    @Test public void optionalCatalogYieldsBeforeAndBetweenIoWhenPlaybackBecomesActive() throws Exception {
        Harness h=new Harness(true);Object player=new Object();AutoCloseable subscription=null;
        try {
            h.fixture.leaseExpiry=NOW+10L*86400000;warmLive(h);h.clock.value+=MetadataDiskCache.FRESH_MS;
            BlockingQueue<Catalog> updates=new LinkedBlockingQueue<>();subscription=h.repository.observeCatalog(updates::add);
            BackgroundWorkGate.beginPlayback(player);Result<Catalog> cached=new Result<>();h.repository.catalog(Kind.LIVE,false,cached);h.deliver();Thread.sleep(150);assertEquals(1,h.fixture.liveCategoryReads.get());
            BackgroundWorkGate.endPlayback(player);h.fixture.holdCatalog=true;h.repository.catalog(Kind.LIVE,false,new Result<>());h.deliver();assertTrue(h.fixture.catalogStarted.await(5,TimeUnit.SECONDS));
            BackgroundWorkGate.beginPlayback(player);h.fixture.releaseCatalog.countDown();Thread.sleep(200);
            assertEquals("Gate changed during first read: second provider read must not begin",1,h.fixture.liveStreamReads.get());assertNull(updates.peek());
        }finally{BackgroundWorkGate.endPlayback(player);h.fixture.releaseCatalog.countDown();if(subscription!=null)subscription.close();h.repository.logout();}
    }
    @Test public void lateOptionalRefreshCannotWriteOrNotifyAfterLogout() throws Exception {
        Harness h=new Harness(true);AutoCloseable subscription=null;
        try {
            h.fixture.leaseExpiry=NOW+10L*86400000;warmLive(h);h.clock.value+=MetadataDiskCache.FRESH_MS;h.fixture.holdCatalog=true;
            BlockingQueue<Catalog> updates=new LinkedBlockingQueue<>();subscription=h.repository.observeCatalog(updates::add);
            h.repository.catalog(Kind.LIVE,false,new Result<>());h.deliver();assertTrue(h.fixture.catalogStarted.await(5,TimeUnit.SECONDS));
            h.repository.logout();h.fixture.releaseCatalog.countDown();Thread.sleep(200);
            while(!h.deliveries.isEmpty())h.deliver();assertNull(updates.peek());
            MetadataDiskCache disk=new MetadataDiskCache(new java.io.File(h.context.getFilesDir(),"catalog-cache-v1"));assertNull(disk.readCatalog("fixture-account:source-a",Kind.LIVE,h.fixture.leaseExpiry,h.clock.value));
        }finally{h.fixture.releaseCatalog.countDown();if(subscription!=null)subscription.close();h.repository.logout();}
    }
    private static Object field(Object owner,String name)throws Exception {
        java.lang.reflect.Field field=owner.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(owner);
    }
    private static ThreadPoolExecutor holdMetadataLane(Harness h,CountDownLatch started,CountDownLatch release)throws Exception {
        ThreadPoolExecutor lane=(ThreadPoolExecutor)field(h.repository,"metadataWorker");
        lane.execute(()->{started.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}});
        assertTrue("Metadata lane did not start",started.await(5,TimeUnit.SECONDS));return lane;
    }
    @Test public void expiryDoesNotHoldRepositoryLockWhileWaitingForMetadataWriter()throws Exception {
        Harness h=new Harness(true);CountDownLatch writerEntered=new CountDownLatch(1),releaseWriter=new CountDownLatch(1),writerDone=new CountDownLatch(1),expired=new CountDownLatch(1),repositoryAvailable=new CountDownLatch(1);
        try {
            Item item=warmLive(h);MetadataDiskCache disk=(MetadataDiskCache)field(h.repository,"metadataDisk");Object repositoryLock=field(h.repository,"lock");Runnable expiry=(Runnable)field(h.repository,"expiryTimer");
            Thread writer=new Thread(()->{try{disk.writeCatalog(item.scope,h.fixture.leaseExpiry,NOW,new Catalog(Kind.LIVE,java.util.Collections.singletonList(item),java.util.Collections.emptyList()),()->{writerEntered.countDown();try{releaseWriter.await(5,TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}return false;});}finally{writerDone.countDown();}},"metadata-expiry-writer");writer.setDaemon(true);writer.start();assertTrue(writerEntered.await(5,TimeUnit.SECONDS));
            h.clock.value=h.fixture.leaseExpiry;Thread timer=new Thread(()->{try{expiry.run();}finally{expired.countDown();}},"metadata-expiry-timer");timer.setDaemon(true);timer.start();
            long wait=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);while(timer.getState()!=Thread.State.BLOCKED && expired.getCount()!=0 && System.nanoTime()<wait)Thread.sleep(5);
            assertEquals("Expiry should be waiting for the held disk writer",Thread.State.BLOCKED,timer.getState());
            Thread reader=new Thread(()->{synchronized(repositoryLock){repositoryAvailable.countDown();}},"metadata-expiry-reader");reader.setDaemon(true);reader.start();
            assertTrue("Expiry must release the repository lock before waiting for disk; writers validate that lock",repositoryAvailable.await(500,TimeUnit.MILLISECONDS));
        }finally{releaseWriter.countDown();assertTrue(writerDone.await(5,TimeUnit.SECONDS));assertTrue(expired.await(5,TimeUnit.SECONDS));h.repository.logout();}
    }
    @Test public void queuedOptionalCatalogCannotSupersedeNewerForegroundRefresh()throws Exception {
        for(boolean forceCompleted:new boolean[]{false,true})for(boolean scheduleDuringForeground:new boolean[]{false,true}) {
            Harness h=new Harness(true);CountDownLatch laneStarted=new CountDownLatch(1),releaseLane=new CountDownLatch(1),laneDrained=new CountDownLatch(1);
            try {
                h.fixture.leaseExpiry=NOW+10L*86400000;warmLive(h);h.clock.value+=MetadataDiskCache.FRESH_MS;
                ThreadPoolExecutor lane=holdMetadataLane(h,laneStarted,releaseLane);h.repository.catalog(Kind.LIVE,false,new Result<>());if(scheduleDuringForeground)h.awaitQueued(1);else h.deliver();
                h.fixture.holdCatalog=!forceCompleted;h.fixture.liveTitle="Foreground catalog";Result<Catalog> fresh=new Result<>();h.repository.catalog(Kind.LIVE,true,fresh);
                if(forceCompleted)h.awaitQueued(scheduleDuringForeground?2:1);else assertTrue(h.fixture.catalogStarted.await(5,TimeUnit.SECONDS));
                if(scheduleDuringForeground)h.deliver();if(forceCompleted){h.deliver();assertNull(fresh.error);}
                lane.execute(laneDrained::countDown);releaseLane.countDown();assertTrue("Older queued optional catalog must yield before I/O",laneDrained.await(2,TimeUnit.SECONDS));
                assertEquals("Only the newer foreground fetch may read categories",2,h.fixture.liveCategoryReads.get());
                h.fixture.releaseCatalog.countDown();if(!forceCompleted)h.deliver();assertNull("Queued optional work must not invalidate foreground result",fresh.error);assertEquals("Foreground catalog",fresh.value.items.get(0).title);
            }finally{releaseLane.countDown();h.fixture.releaseCatalog.countDown();h.repository.logout();}
        }
    }
    @Test public void queuedOptionalSeriesCannotSupersedeNewerPlaybackValidation()throws Exception {
        for(boolean forceCompleted:new boolean[]{false,true})for(boolean scheduleDuringForeground:new boolean[]{false,true}) {
            Harness h=new Harness(true);CountDownLatch laneStarted=new CountDownLatch(1),releaseLane=new CountDownLatch(1),laneDrained=new CountDownLatch(1);
            try {
                h.fixture.leaseExpiry=NOW+10L*86400000;SeriesDetail detail=warmSeries(h);h.clock.value+=MetadataDiskCache.FRESH_MS;
                ThreadPoolExecutor lane=holdMetadataLane(h,laneStarted,releaseLane);h.repository.series(detail.series,new Result<>());if(scheduleDuringForeground)h.awaitQueued(1);else h.deliver();
                h.fixture.holdSeriesDetail=!forceCompleted;Result<Playback> playback=new Result<>();h.repository.playback(detail.seasons.get(0).episodes.get(0),playback);
                if(forceCompleted)h.awaitQueued(scheduleDuringForeground?2:1);else assertTrue(h.fixture.seriesDetailStarted.await(5,TimeUnit.SECONDS));
                if(scheduleDuringForeground)h.deliver();if(forceCompleted){h.deliver();assertNull(playback.error);}
                lane.execute(laneDrained::countDown);releaseLane.countDown();assertTrue("Older queued optional detail must yield before I/O",laneDrained.await(2,TimeUnit.SECONDS));
                assertEquals("Only the newer playback validation may read detail",2,h.fixture.seriesDetailReads.get());
                h.fixture.releaseSeriesDetail.countDown();if(!forceCompleted)h.deliver();assertNull("Queued optional work must not invalidate playback validation",playback.error);assertNotNull(playback.value);
            }finally{releaseLane.countDown();h.fixture.releaseSeriesDetail.countDown();h.repository.logout();}
        }
    }
    @Test public void queuedFreshCatalogObserverChecksCurrentSourceAndExpiryIncludingEmptyCatalog() throws Exception {
        for(boolean expire:new boolean[]{false,true}) {
            Harness h=new Harness(true);AutoCloseable subscription=null;
            try {
                h.fixture.leaseExpiry=NOW+10L*86400000;warmLive(h);h.clock.value+=MetadataDiskCache.FRESH_MS;
                h.fixture.emptyLive=true;
                BlockingQueue<Catalog> updates=new LinkedBlockingQueue<>();subscription=h.repository.observeCatalog(updates::add);
                h.repository.catalog(Kind.LIVE,false,new Result<>());h.deliver();h.awaitQueued(1);
                if(expire)h.clock.value=h.fixture.leaseExpiry;
                else {h.fixture.source="source-b";h.repository.refreshAccess(new Result<>());h.awaitQueued(2);}
                h.deliver();assertNull("Observer must validate when dispatched, not only when fetched",updates.peek());
            }finally{if(subscription!=null)subscription.close();h.repository.logout();}
        }
    }
    @Test public void queuedPlayableAccountCannotPublishAfterAbsoluteExpiry() throws Exception {
        Harness h=new Harness(true);try {
            Result<Account> result=new Result<>();h.repository.account(false,result);h.awaitQueued(1);h.clock.value=NOW+600000;h.deliver();
            assertNull(result.value);assertNotNull(result.error);assertEquals(Failure.Code.STALE,result.error.code);
        }finally{h.repository.logout();}
    }
    @Test public void queuedPlayableAccountCannotPublishAfterSourceReplacement() throws Exception {
        Harness h=new Harness(true);try {
            Result<Account> result=new Result<>();h.repository.account(false,result);h.awaitQueued(1);h.fixture.source="source-b";
            h.repository.playback(new Item(Kind.MOVIE,"12","Film","9","Filmler","","mp4","fixture-account:source-a","",0,0,""),new Result<Playback>());
            h.awaitQueued(2);h.deliver();assertNull(result.value);assertEquals(Failure.Code.STALE,result.error.code);
        }finally{h.repository.logout();}
    }
    @Test public void queuedPlayableAccountCannotPublishAfterAuthoritativeAuthDenial() throws Exception {
        Harness h=new Harness(true);try {
            Result<Account> result=new Result<>();h.repository.account(false,result);h.awaitQueued(1);h.fixture.denyLibrary=true;
            h.repository.favorites(new Result<List<Item>>());h.awaitQueued(2);assertFalse(h.repository.hasSession());h.deliver();
            assertNull(result.value);assertNotNull(result.error);assertEquals(Failure.Code.STALE,result.error.code);
        }finally{h.repository.logout();}
    }
    @Test public void initialIneligibleAccountDoesNotRequireProviderLease() throws Exception {
        Harness h=new Harness(true);try {
            h.fixture.eligible=false;Result<Account> result=new Result<>();h.repository.account(false,result);h.deliver();
            assertNull(result.error);assertNotNull(result.value);assertFalse(result.value.canPlay);assertEquals("",h.repository.currentScope());
        }finally{h.repository.logout();}
    }
    @Test public void initialCatalogHydratesExistingFavoriteBeforeMembershipAndFirstMutation() throws Exception {
        Harness h=new Harness(true);try {
            Result<Catalog> result=new Result<>();h.repository.catalog(Kind.MOVIE,false,result);h.deliver();assertNull(result.error);assertEquals(1,result.value.items.size());
            Item movie=result.value.items.get(0);assertTrue("Existing favorite must be known before detail actions",h.repository.isFavorite(movie));
            Result<Boolean> toggle=new Result<>();h.repository.toggleFavorite(movie,toggle);h.deliver();assertNull(toggle.error);assertEquals(Boolean.FALSE,toggle.value);assertFalse(h.repository.isFavorite(movie));
            synchronized(h.fixture.favoriteMethods){assertEquals(1,h.fixture.favoriteMethods.size());assertEquals("DELETE",h.fixture.favoriteMethods.get(0));}
        }finally{h.repository.logout();}
    }
    private static Item liveCandidate(String id) {
        return new Item(Kind.LIVE,id,"Forged title","999","Forged category","","m3u8","fixture-account:source-a","",0,0,"");
    }
    private static Item warmLive(Harness h) throws Exception {
        Result<Catalog> catalog=new Result<>();h.repository.catalog(Kind.LIVE,false,catalog);h.deliver();
        assertNull(catalog.error);assertNotNull(catalog.value);assertEquals(1,catalog.value.items.size());return catalog.value.items.get(0);
    }
    @Test public void warmLivePlaybackRevalidatesAccessWithoutRefetchingCanonicalMetadata() throws Exception {
        Harness h=new Harness(true);try {
            warmLive(h);int bootstraps=h.fixture.bootstrapReads.get();h.fixture.leaseExpiry=NOW+120000;
            Result<Playback> result=new Result<>();h.repository.playback(liveCandidate("34"),result);h.deliver();
            assertNull(result.error);assertNotNull(result.value);assertEquals("Fixture Kanal",result.value.item.title);
            assertEquals("7",result.value.item.categoryId);assertEquals("ts",result.value.item.extension);
            assertEquals("video/mp2t",result.value.mime);assertTrue(result.value.url.endsWith("/34.ts"));
            assertEquals("fixture-account:source-a",result.value.scope);assertEquals(NOW+120000,result.value.expiresAtMs);
            assertEquals("Playback must still force authoritative bootstrap",bootstraps+1,h.fixture.bootstrapReads.get());
            assertEquals("Warm LIVE must reuse validated categories",1,h.fixture.liveCategoryReads.get());
            assertEquals("Warm LIVE must reuse validated streams",1,h.fixture.liveStreamReads.get());
        }finally{h.repository.logout();}
    }
    @Test public void coldLivePlaybackResolvesCanonicalItemAndRejectsUnknownId() throws Exception {
        Harness h=new Harness(true);try {
            Result<Playback> known=new Result<>();h.repository.playback(liveCandidate("34"),known);h.deliver();
            assertNull(known.error);assertNotNull(known.value);assertEquals("Fixture Kanal",known.value.item.title);
            assertEquals("ts",known.value.item.extension);assertTrue(known.value.url.endsWith("/34.ts"));
            Result<Playback> unknown=new Result<>();h.repository.playback(liveCandidate("999"),unknown);h.deliver();
            assertNull(unknown.value);assertNotNull(unknown.error);assertEquals(Failure.Code.INVALID,unknown.error.code);
            assertEquals("Unknown LIVE must not redownload the same metadata",1,h.fixture.liveStreamReads.get());
        }finally{h.repository.logout();}
    }
    @Test public void warmLivePlaybackRejectsAuthoritativeBootstrapDenial() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);h.fixture.bootstrapStatus=403;
            Result<Playback> result=new Result<>();h.repository.playback(live,result);h.deliver();
            assertNull(result.value);assertNotNull(result.error);assertEquals("",h.repository.currentScope());
            assertEquals(2,h.fixture.bootstrapReads.get());assertEquals(1,h.fixture.liveStreamReads.get());
        }finally{h.repository.logout();}
    }
    @Test public void warmLivePlaybackRejectsReplacedSourceBeforeMetadataFetch() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);h.fixture.source="source-b";
            Result<Playback> result=new Result<>();h.repository.playback(live,result);h.deliver();
            assertNull(result.value);assertNotNull(result.error);assertEquals(Failure.Code.STALE,result.error.code);
            assertEquals("fixture-account:source-b",h.repository.currentScope());assertEquals(1,h.fixture.liveStreamReads.get());
        }finally{h.repository.logout();}
    }
    @Test public void blockedEpgDoesNotBlockPlaybackAndDuplicateEpgSharesRequest() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);h.fixture.holdEpg=true;
            Result<List<Programme>> first=new Result<>(),duplicate=new Result<>();h.repository.epg(live,first);
            assertTrue("Optional provider request did not begin",h.fixture.epgStarted.await(5,TimeUnit.SECONDS));
            h.repository.epg(live,duplicate);Result<Playback> playback=new Result<>();h.repository.playback(live,playback);
            h.deliver();assertNull("EPG remains held while playback completes",first.value);assertEquals(0,first.calls);
            assertNull(playback.error);assertNotNull("Playback validation must complete while EPG is blocked",playback.value);
            h.fixture.releaseEpg.countDown();h.deliver();
            assertNull(first.error);assertNull(duplicate.error);assertNotNull(first.value);assertEquals(1,first.value.size());
            assertEquals("Fixture Programme",first.value.get(0).title);assertEquals(1,first.calls);assertEquals(1,duplicate.calls);
            assertEquals("Same-item EPG calls must coalesce",1,h.fixture.epgReads.get());
        }finally{h.fixture.releaseEpg.countDown();h.repository.logout();}
    }
    @Test public void blockedEpgCannotPublishAfterSourceReplacement() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);h.fixture.holdEpg=true;Result<List<Programme>> epg=new Result<>();h.repository.epg(live,epg);
            assertTrue(h.fixture.epgStarted.await(5,TimeUnit.SECONDS));h.fixture.source="source-b";
            Result<Account> refreshed=new Result<>();h.repository.refreshAccess(refreshed);h.deliver();
            assertNull(refreshed.error);assertNotNull("Source refresh must not wait for EPG",refreshed.value);
            assertEquals("fixture-account:source-b",h.repository.currentScope());
            h.fixture.releaseEpg.countDown();h.deliver();assertNull(epg.value);assertNotNull(epg.error);assertEquals(Failure.Code.STALE,epg.error.code);
        }finally{h.fixture.releaseEpg.countDown();h.repository.logout();}
    }
    @Test public void blockedEpgUsesLatestShortenedLeaseCutoff() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);h.fixture.holdEpg=true;Result<List<Programme>> epg=new Result<>();h.repository.epg(live,epg);
            assertTrue(h.fixture.epgStarted.await(5,TimeUnit.SECONDS));h.fixture.leaseExpiry=NOW+1000;
            Result<Account> refreshed=new Result<>();h.repository.refreshAccess(refreshed);h.deliver();
            assertNull(refreshed.error);assertNotNull("Lease refresh must not wait for EPG",refreshed.value);
            assertEquals(NOW+1000,refreshed.value.expiresAtMs);h.clock.value=NOW+1000;
            h.fixture.releaseEpg.countDown();h.deliver();assertNull(epg.value);assertNotNull(epg.error);
        }finally{h.fixture.releaseEpg.countDown();h.repository.logout();}
    }
    @Test public void queuedEpgCannotPublishAfterAbsoluteExpiry() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);Result<List<Programme>> epg=new Result<>();h.repository.epg(live,epg);h.awaitQueued(1);
            h.clock.value=NOW+600000;h.deliver();assertNull(epg.value);assertNotNull(epg.error);assertEquals(Failure.Code.STALE,epg.error.code);
        }finally{h.repository.logout();}
    }
    @Test public void blockedEpgCannotPublishAfterLogout() throws Exception {
        Harness h=new Harness(true);try {
            Item live=warmLive(h);h.fixture.holdEpg=true;Result<List<Programme>> epg=new Result<>();h.repository.epg(live,epg);
            assertTrue(h.fixture.epgStarted.await(5,TimeUnit.SECONDS));h.repository.logout();h.fixture.releaseEpg.countDown();h.deliver();
            assertNull(epg.value);assertNotNull(epg.error);assertEquals(Failure.Code.STALE,epg.error.code);
        }finally{h.fixture.releaseEpg.countDown();h.repository.logout();}
    }
    @Test public void productionCallbackDispatcherUsesAndroidMainThread() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();TokenStore store=new TokenStore(context);store.clear();store.save(new TokenStore.Session("fixture-access","fixture-refresh-token-with-32-chars","fixture-account","1234"));
        NetworkTvRepository repository=new NetworkTvRepository(context,new Fixture(),new Clock(),null);CountDownLatch done=new CountDownLatch(1);Result<Account> result=new Result<>();final boolean[] main={false};
        try {
            repository.account(false,new Callback<Account>(){
                @Override public void onResult(Account account){main[0]=Looper.myLooper()==Looper.getMainLooper();result.onResult(account);done.countDown();}
                @Override public void onError(Failure error){result.onError(error);done.countDown();}
            });
            assertTrue(done.await(5,TimeUnit.SECONDS));assertNull(result.error);assertTrue(main[0]);
        }finally{repository.logout();}
    }
    private static Item seriesCandidate(String scope) {
        return new Item(Kind.SERIES,"56","Untrusted title","999","Untrusted category","","",scope,"",0,0,"");
    }
    private static SeriesDetail warmSeries(Harness h) throws Exception {
        Result<SeriesDetail> result=new Result<>();h.repository.series(seriesCandidate("fixture-account:source-a"),result);h.deliver();
        assertNull(result.error);assertNotNull(result.value);return result.value;
    }
    @Test public void startingSeriesOpensCanonicalFirstEpisodeAndReusesWarmMetadata() throws Exception {
        Harness h=new Harness(true);try {
            for(int n=0;n<2;n++) {
                Result<Item> result=new Result<>();h.repository.startingEpisode(seriesCandidate("fixture-account:source-a"),result);h.deliver();
                assertNull(result.error);assertEquals("61",result.value.id);assertEquals("Fixture Bölüm 61",result.value.title);
                assertEquals(Kind.EPISODE,result.value.kind);assertEquals("56",result.value.seriesId);assertEquals(1,result.value.season);assertEquals(1,result.value.episode);
            }
            assertEquals(1,h.fixture.bootstrapReads.get());assertEquals(1,h.fixture.seriesCategoryReads.get());
            assertEquals(1,h.fixture.seriesListReads.get());assertEquals(1,h.fixture.seriesDetailReads.get());assertEquals(1,h.fixture.libraryReads);
        }finally{h.repository.logout();}
    }
    @Test public void startingSeriesUsesMostRecentlyResumedAvailableEpisode() throws Exception {
        Harness h=new Harness(true);try {
            SeriesDetail detail=warmSeries(h);Item first=detail.seasons.get(0).episodes.get(0),second=detail.seasons.get(0).episodes.get(1),third=detail.seasons.get(1).episodes.get(0);
            h.repository.savePosition(first,25000,120000);h.clock.value+=100;
            h.repository.savePosition(third,45000,120000);h.clock.value+=100;
            h.repository.savePosition(second,35000,120000);
            Item removed=new Item(Kind.EPISODE,"999","No longer available","8","Diziler","","mp4",first.scope,"56",2,9,"");
            h.clock.value+=100;h.repository.savePosition(removed,20000,120000);
            Result<Item> result=new Result<>();h.repository.startingEpisode(detail.series,result);h.deliver();
            assertNull(result.error);assertEquals("62",result.value.id);assertEquals(35000,h.repository.resumePosition(result.value));
        }finally{h.repository.logout();}
    }
    @Test public void startingSeriesAdvancesAcrossWatchedSeasonsAndReplaysWhenComplete() throws Exception {
        for(boolean complete:new boolean[]{false,true}) {
            Harness h=new Harness(true);try {
                h.fixture.watchedEpisodes.add("61");h.fixture.watchedEpisodes.add("62");if(complete)h.fixture.watchedEpisodes.add("63");
                Result<Item> result=new Result<>();h.repository.startingEpisode(seriesCandidate("fixture-account:source-a"),result);h.deliver();
                assertNull(result.error);assertEquals(complete?"61":"63",result.value.id);
            }finally{h.repository.logout();}
        }
    }
    @Test public void startingSeriesIgnoresSavedPositionFromPreviousSource() throws Exception {
        Harness h=new Harness(true);try {
            SeriesDetail detail=warmSeries(h);h.repository.savePosition(detail.seasons.get(1).episodes.get(0),45000,120000);
            h.fixture.source="source-b";Result<Account> refreshed=new Result<>();h.repository.refreshAccess(refreshed);h.deliver();assertNull(refreshed.error);
            Result<Item> result=new Result<>();h.repository.startingEpisode(seriesCandidate("fixture-account:source-b"),result);h.deliver();
            assertNull(result.error);assertEquals("61",result.value.id);assertEquals("fixture-account:source-b",result.value.scope);
        }finally{h.repository.logout();}
    }
    @Test public void startingSeriesRejectsUnknownEmptyAndWrongKindWithoutPlayback() throws Exception {
        Harness h=new Harness(true);try {
            warmSeries(h);
            for(Item candidate:new Item[]{null,liveCandidate("34"),new Item(Kind.SERIES,"999","Unknown","","","","","fixture-account:source-a","",0,0,"")}) {
                Result<Item> result=new Result<>();h.repository.startingEpisode(candidate,result);h.deliver();assertNull(result.value);assertEquals(Failure.Code.INVALID,result.error.code);
            }
        }finally{h.repository.logout();}
        h=new Harness(true);try {
            h.fixture.emptyEpisodes=true;Result<Item> result=new Result<>();h.repository.startingEpisode(seriesCandidate("fixture-account:source-a"),result);h.deliver();
            assertNull(result.value);assertEquals(Failure.Code.INVALID,result.error.code);
        }finally{h.repository.logout();}
    }
    @Test public void queuedStartingEpisodeCannotPublishAfterLogoutOrSourceReplacement() throws Exception {
        for(boolean logout:new boolean[]{false,true}) {
            Harness h=new Harness(true);try {
                warmSeries(h);Result<Item> result=new Result<>();h.repository.startingEpisode(seriesCandidate("fixture-account:source-a"),result);h.awaitQueued(1);
                if(logout)h.repository.logout();else {h.fixture.source="source-b";h.repository.refreshAccess(new Result<Account>());h.awaitQueued(2);}
                h.deliver();assertNull(result.value);assertNotNull(result.error);assertEquals(Failure.Code.STALE,result.error.code);
            }finally{h.repository.logout();}
        }
    }
    @Test public void invalidStartingEpisodeCannotJoinValidPendingSelection() throws Exception {
        Harness h=new Harness(true);try {
            warmSeries(h);Result<Item> valid=new Result<>(),wrongKind=new Result<>(),wrongScope=new Result<>();
            h.repository.startingEpisode(seriesCandidate("fixture-account:source-a"),valid);h.awaitQueued(1);
            h.repository.startingEpisode(new Item(Kind.LIVE,"56","Wrong kind","","","","","fixture-account:source-a","",0,0,""),wrongKind);
            h.repository.startingEpisode(seriesCandidate("another-account:source-a"),wrongScope);
            h.deliver();if(wrongKind.calls==0)h.deliver();if(wrongScope.calls==0)h.deliver();
            assertNull(valid.error);assertEquals("61",valid.value.id);
            assertNull(wrongKind.value);assertNotNull(wrongKind.error);assertEquals(Failure.Code.INVALID,wrongKind.error.code);
            assertNull(wrongScope.value);assertNotNull(wrongScope.error);assertEquals(Failure.Code.INVALID,wrongScope.error.code);
        }finally{h.repository.logout();}
    }
}
