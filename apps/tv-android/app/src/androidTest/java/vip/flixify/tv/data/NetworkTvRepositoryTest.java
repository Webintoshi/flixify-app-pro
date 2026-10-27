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
import java.util.concurrent.atomic.AtomicInteger;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.TvRepository.Callback;
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
        volatile String source="source-a";
        volatile int bootstrapStatus=200;
        volatile long leaseExpiry=NOW+600000;
        final AtomicInteger bootstrapReads=new AtomicInteger(),liveCategoryReads=new AtomicInteger(),liveStreamReads=new AtomicInteger(),epgReads=new AtomicInteger();
        final CountDownLatch epgStarted=new CountDownLatch(1),releaseEpg=new CountDownLatch(1);
        volatile boolean holdEpg;
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
                        else raw=new JSONObject().put("favorites",new JSONArray().put(new JSONObject().put("source","personal").put("sourceVersion",source).put("kind","movie").put("id","12"))).put("watched",new JSONArray());
                    } else if(path.equals("/me/personal-library/favorites")) {
                        JSONObject ref=new JSONObject(body.toString("UTF-8")).getJSONObject("ref");
                        if(!"12".equals(ref.getString("id")) || !source.equals(ref.getString("sourceVersion")))throw new AssertionError("Wrong personal reference");
                        synchronized(favoriteMethods){favoriteMethods.add(getRequestMethod());}raw=new JSONObject().put("ok",true);
                    } else if(path.equals("/player_api.php")) {
                        String query=url.getQuery();
                        if(query.contains("action=get_vod_categories"))raw=new JSONArray().put(new JSONObject().put("category_id","9").put("category_name","Filmler"));
                        else if(query.contains("action=get_vod_streams"))raw=new JSONArray().put(new JSONObject().put("stream_id","12").put("name","Fixture Film").put("category_id","9").put("container_extension","mp4"));
                        else if(query.contains("action=get_live_categories")) {
                            liveCategoryReads.incrementAndGet();raw=new JSONArray().put(new JSONObject().put("category_id","7").put("category_name","Canlı"));
                        } else if(query.contains("action=get_live_streams")) {
                            liveStreamReads.incrementAndGet();raw=new JSONArray().put(new JSONObject().put("stream_id","34").put("name","Fixture Kanal").put("category_id","7").put("container_extension","ts"));
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
    }
    private static final class Harness {
        final Context context=ApplicationProvider.getApplicationContext();
        final Clock clock=new Clock();final Fixture fixture=new Fixture();
        final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
        final NetworkTvRepository repository;
        Harness(boolean restored) throws Exception {
            TokenStore store=new TokenStore(context);store.clear();
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
}
