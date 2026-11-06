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
import vip.flixify.tv.TvRepository.Callback;
import static org.junit.Assert.*;

/** Exercises the real repository; every connection ends in this HTTPS fixture. */
@RunWith(AndroidJUnit4.class)
public class CatalogFirstContentLatencyTest {
    private static final long NOW=1700000000000L;
    private static final long FIRST_CONTENT_MS=500;
    private static final long HELD_REQUEST_MS=5000;

    private static final class Result<T> implements Callback<T> {
        volatile T value;
        volatile Failure error;
        volatile long deliveredAt;
        volatile int calls;
        @Override public void onResult(T value){this.value=value;deliveredAt=System.nanoTime();calls++;}
        @Override public void onError(Failure error){this.error=error;deliveredAt=System.nanoTime();calls++;}
    }

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
        final Hold packages=new Hold(),library=new Hold(),movieCatalog=new Hold();
        final AtomicInteger libraryReads=new AtomicInteger(),movieReads=new AtomicInteger(),liveReads=new AtomicInteger(),seriesReads=new AtomicInteger();
        volatile String source="latency-source-a";
        volatile boolean includeMovieFavorite;
        volatile long liveCategoriesAt,liveStreamsAt;
        @Override public HttpURLConnection open(URL url) throws Exception {
            assertEquals("https",url.getProtocol());
            assertNull("Fixture requests must not contain URL user info",url.getUserInfo());
            boolean api="api.flixify.vip".equals(url.getHost());
            assertTrue("Unexpected fixture host",api || "provider.test".equals(url.getHost()));
            if(api)assertNull("API request must not carry a provider query",url.getQuery());
            else assertEquals("/player_api.php",url.getPath());
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
                                requireBearer();raw=new JSONObject().put("accountId","latency-fixture-account").put("sourceVersion",source)
                                    .put("providerOrigin","https://provider.test").put("username","fixture-user").put("password","fixture-password")
                                    .put("expiresAt",date(NOW+600000)).put("moviePolicy","general-audience-only");
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
                                movieReads.incrementAndGet();movieCatalog.block();raw=streams("12","Fixture Film","9","mp4");
                            }else if(query.endsWith("&action=get_live_categories")){
                                liveCategoriesAt=System.nanoTime();raw=categories("7","Canlı");
                            }else if(query.endsWith("&action=get_live_streams")){
                                liveStreamsAt=System.nanoTime();liveReads.incrementAndGet();raw=streams("34","Fixture Kanal","7","ts");
                            }else if(query.endsWith("&action=get_series_categories"))raw=categories("8","Diziler");
                            else if(query.endsWith("&action=get_series")){
                                seriesReads.incrementAndGet();raw=new JSONArray().put(new JSONObject().put("series_id","56").put("name","Fixture Dizi").put("category_id","8"));
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
                .put("activePackage",new JSONObject().put("title","Fixture Paket").put("endsAt",date(NOW+600000)));
        }
        private JSONArray categories(String id,String title) throws Exception {return new JSONArray().put(new JSONObject().put("category_id",id).put("category_name",title));}
        private JSONArray streams(String id,String title,String category,String extension) throws Exception {
            return new JSONArray().put(new JSONObject().put("stream_id",id).put("name",title).put("category_id",category).put("container_extension",extension));
        }
        @Override public void close(){packages.close();library.close();movieCatalog.close();}
    }

    private static final class Harness implements AutoCloseable {
        final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
        final Fixture fixture=new Fixture();
        final File files;
        final NetworkTvRepository repository;
        Harness() throws Exception {
            Context app=ApplicationProvider.getApplicationContext();
            files=new File(app.getCacheDir(),"catalog-latency-"+System.nanoTime());
            assertTrue(files.mkdirs());
            Context isolated=new ContextWrapper(app){
                @Override public Context getApplicationContext(){return this;}
                @Override public File getFilesDir(){return files;}
            };
            repository=new NetworkTvRepository(isolated,fixture,()->NOW,deliveries::add);
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
        @Override public void close() throws Exception {
            fixture.close();repository.logout();
            java.util.List<ExecutorService> executors=new java.util.ArrayList<>();
            for(Field field:NetworkTvRepository.class.getDeclaredFields())if(ExecutorService.class.isAssignableFrom(field.getType())){
                field.setAccessible(true);ExecutorService executor=(ExecutorService)field.get(repository);executors.add(executor);executor.shutdownNow();
            }
            for(ExecutorService executor:executors){
                assertTrue("Repository worker did not stop",executor.awaitTermination(2,TimeUnit.SECONDS));
            }
            remove(files);
        }
    }

    @Test public void cachedCatalogReachesCallbackWithin500msWhileUnrelatedApiRequestIsHeld5s() throws Exception {
        try(Harness h=new Harness()){
            Result<Catalog> seed=new Result<>();h.repository.catalog(Kind.MOVIE,false,seed);
            assertTrue(h.dispatchUntil(seed,5000));h.assertCatalog(seed,Kind.MOVIE);
            h.fixture.packages.enabled=true;
            Result<java.util.List<vip.flixify.tv.PackagePlan>> packages=new Result<>();h.repository.packages(packages);
            assertTrue("Unrelated request did not occupy the auth worker",h.fixture.packages.started.await(2,TimeUnit.SECONDS));

            Result<Catalog> cached=new Result<>();long requestedAt=System.nanoTime();h.repository.catalog(Kind.MOVIE,false,cached);
            boolean withinBudget=h.dispatchUntil(cached,FIRST_CONTENT_MS);
            assertTrue("Cached navigation never completed after held request released",h.dispatchUntil(cached,8000));h.assertCatalog(cached,Kind.MOVIE);
            assertTrue(h.dispatchUntil(packages,8000));assertNull(packages.error);
            assertEquals("Cached navigation must not fetch the provider catalog again",1,h.fixture.movieReads.get());
            long callbackMs=elapsed(requestedAt,cached.deliveredAt);

            Result<Catalog> deferred=new Result<>();h.repository.catalog(Kind.MOVIE,false,deferred);Runnable delivery=h.nextDelivery();
            assertEquals("Callbacks must stay deferred until dispatch",0,deferred.calls);
            h.repository.logout();delivery.run();
            assertNull("Logout must suppress a prepared cached value",deferred.value);assertNotNull(deferred.error);assertEquals(Failure.Code.STALE,deferred.error.code);
            assertEquals(1,deferred.calls);

            android.util.Log.i("CatalogFirstContentLatency",new JSONObject().put("kind","MOVIE").put("stage","warm-memory-held-packages").put("callbackMs",callbackMs).put("heldRequestMs",HELD_REQUEST_MS).toString());
            assertTrue("Cached catalog first callback took "+callbackMs+" ms with an unrelated API request held for "+HELD_REQUEST_MS+" ms; budget="+FIRST_CONTENT_MS+" ms",withinBudget && callbackMs<=FIRST_CONTENT_MS);
        }
    }

    @Test public void coldLiveCatalogReachesCallbackWithin500msWhilePersonalLibraryIsHeld5s() throws Exception {
        try(Harness h=new Harness()){
            h.fixture.library.enabled=true;
            Result<Catalog> live=new Result<>();long requestedAt=System.nanoTime();h.repository.catalog(Kind.LIVE,false,live);
            boolean withinBudget=h.dispatchUntil(live,FIRST_CONTENT_MS);
            assertTrue("Personal-library fixture was not exercised",h.fixture.library.started.await(2,TimeUnit.SECONDS));
            assertTrue("Cold LIVE catalog never completed after personal-library released",h.dispatchUntil(live,8000));h.assertCatalog(live,Kind.LIVE);
            assertEquals(1,h.fixture.liveReads.get());
            long callbackMs=elapsed(requestedAt,live.deliveredAt),categoriesMs=elapsed(requestedAt,h.fixture.liveCategoriesAt),streamsMs=elapsed(requestedAt,h.fixture.liveStreamsAt);

            Result<Catalog> deferred=new Result<>();h.repository.catalog(Kind.LIVE,false,deferred);Runnable delivery=h.nextDelivery();
            assertEquals(0,deferred.calls);h.fixture.source="latency-source-b";
            Result<Account> changed=new Result<>();h.repository.refreshAccess(changed);
            assertTrue("Source change did not complete",h.dispatchUntil(changed,8000));assertNull(changed.error);
            assertEquals("latency-fixture-account:latency-source-b",h.repository.currentScope());
            delivery.run();assertNull("A source change must suppress a prepared catalog",deferred.value);assertNotNull(deferred.error);
            assertEquals(Failure.Code.STALE,deferred.error.code);assertEquals(1,deferred.calls);

            android.util.Log.i("CatalogFirstContentLatency",new JSONObject().put("kind","LIVE").put("stage","cold-held-library").put("callbackMs",callbackMs).put("categoriesMs",categoriesMs).put("streamsMs",streamsMs).put("heldRequestMs",HELD_REQUEST_MS).toString());
            assertTrue("Cold LIVE first callback="+callbackMs+" ms, categories="+categoriesMs+" ms, streams="+streamsMs+" ms while personal-library held="+HELD_REQUEST_MS+" ms; budget="+FIRST_CONTENT_MS+" ms",withinBudget && callbackMs<=FIRST_CONTENT_MS);
        }
    }

    @Test public void coldForegroundLiveDoesNotWaitForHeldHomeMovieCatalog() throws Exception {
        assertForegroundCatalogDoesNotWaitForHomeMovie(Kind.LIVE,false);
    }

    @Test public void coldForegroundSeriesDoesNotWaitForHeldHomeMovieCatalog() throws Exception {
        assertForegroundCatalogDoesNotWaitForHomeMovie(Kind.SERIES,false);
    }

    @Test public void queuedHomeLiveIsPromotedWhenItsPageBecomesForeground() throws Exception {
        assertForegroundCatalogDoesNotWaitForHomeMovie(Kind.LIVE,true);
    }

    @Test public void runningHomeMovieIsSharedWhenItsPageBecomesForeground() throws Exception {
        try(Harness h=new Harness()){
            h.fixture.movieCatalog.enabled=true;
            Result<Catalog> home=new Result<>();h.repository.homeCatalog(Kind.MOVIE,false,home);
            assertTrue(h.fixture.movieCatalog.started.await(2,TimeUnit.SECONDS));
            Result<Catalog> foreground=new Result<>();h.repository.catalog(Kind.MOVIE,false,foreground);
            h.fixture.movieCatalog.release.countDown();
            assertTrue(h.dispatchUntil(foreground,3000));h.assertCatalog(foreground,Kind.MOVIE);
            assertTrue(h.dispatchUntil(home,3000));h.assertCatalog(home,Kind.MOVIE);
            assertSame("Foreground must join the already running home request",home.value,foreground.value);
            assertEquals("Promoting a running home request must not start another provider read",1,h.fixture.movieReads.get());
        }
    }

    private void assertForegroundCatalogDoesNotWaitForHomeMovie(Kind kind,boolean queuedHome) throws Exception {
        try(Harness h=new Harness()){
            h.fixture.movieCatalog.enabled=true;
            Result<Catalog> homeMovie=new Result<>();h.repository.homeCatalog(Kind.MOVIE,false,homeMovie);
            assertTrue("Home movie catalog did not reach the held provider response",h.fixture.movieCatalog.started.await(2,TimeUnit.SECONDS));
            Result<Catalog> queued=new Result<>();
            if(queuedHome){
                h.repository.homeCatalog(kind,false,queued);
                for(String name:new String[]{"cacheWorker","worker"}){
                    Field field=NetworkTvRepository.class.getDeclaredField(name);field.setAccessible(true);
                    ((ExecutorService)field.get(h.repository)).submit(()->{}).get(2,TimeUnit.SECONDS);
                }
            }

            Result<Catalog> foreground=new Result<>();long requestedAt=System.nanoTime();h.repository.catalog(kind,false,foreground);
            boolean withinBudget=h.dispatchUntil(foreground,FIRST_CONTENT_MS);
            assertTrue("Foreground catalog did not finish after the held movie response released",h.dispatchUntil(foreground,8000));
            h.assertCatalog(foreground,kind);assertTrue(h.dispatchUntil(homeMovie,8000));h.assertCatalog(homeMovie,Kind.MOVIE);
            if(queuedHome){assertTrue(h.dispatchUntil(queued,3000));h.assertCatalog(queued,kind);assertSame(queued.value,foreground.value);}
            long callbackMs=elapsed(requestedAt,foreground.deliveredAt);
            assertEquals("Home movie catalog must not be fetched twice",1,h.fixture.movieReads.get());
            assertEquals("Foreground catalog must be fetched once",1,kind==Kind.LIVE?h.fixture.liveReads.get():h.fixture.seriesReads.get());
            android.util.Log.i("CatalogFirstContentLatency",new JSONObject().put("kind",kind.name()).put("stage",queuedHome?"promoted-home-held-home-movie":"cold-foreground-held-home-movie").put("callbackMs",callbackMs).put("heldRequestMs",HELD_REQUEST_MS).toString());
            assertTrue("Cold foreground "+kind+" callback took "+callbackMs+" ms behind a home movie response held for "+HELD_REQUEST_MS+" ms; budget="+FIRST_CONTENT_MS+" ms",withinBudget && callbackMs<=FIRST_CONTENT_MS);
        }
    }

    @Test public void resolvedFavoritesReachCallbackWithin500msWhileUnrelatedApiRequestIsHeld5s() throws Exception {
        try(Harness h=new Harness()){
            h.fixture.includeMovieFavorite=true;
            Result<Catalog> seed=new Result<>();h.repository.catalog(Kind.MOVIE,false,seed);
            assertTrue(h.dispatchUntil(seed,5000));h.assertCatalog(seed,Kind.MOVIE);
            Result<java.util.List<vip.flixify.tv.TvModels.Item>> seeded=new Result<>();h.repository.favorites(seeded);
            assertTrue(h.dispatchUntil(seeded,5000));assertNull(seeded.error);assertEquals(1,seeded.value.size());
            h.fixture.packages.enabled=true;
            Result<java.util.List<vip.flixify.tv.PackagePlan>> packages=new Result<>();h.repository.packages(packages);
            assertTrue(h.fixture.packages.started.await(2,TimeUnit.SECONDS));
            Result<java.util.List<vip.flixify.tv.TvModels.Item>> cached=new Result<>();long requestedAt=System.nanoTime();h.repository.favorites(cached);
            boolean withinBudget=h.dispatchUntil(cached,FIRST_CONTENT_MS);
            assertTrue(h.dispatchUntil(cached,8000));assertNull(cached.error);assertEquals(1,cached.calls);assertEquals("12",cached.value.get(0).id);
            assertEquals(h.repository.currentScope(),cached.value.get(0).scope);long callbackMs=elapsed(requestedAt,cached.deliveredAt);
            assertTrue(h.dispatchUntil(packages,8000));assertNull(packages.error);assertEquals(1,h.fixture.movieReads.get());
            Result<java.util.List<vip.flixify.tv.TvModels.Item>> deferred=new Result<>();h.repository.favorites(deferred);Runnable delivery=h.nextDelivery();
            assertEquals(0,deferred.calls);h.repository.logout();delivery.run();assertNull(deferred.value);assertNotNull(deferred.error);assertEquals(Failure.Code.STALE,deferred.error.code);
            android.util.Log.i("CatalogFirstContentLatency",new JSONObject().put("kind","FAVORITES").put("stage","resolved-memory-held-packages").put("callbackMs",callbackMs).put("heldRequestMs",HELD_REQUEST_MS).toString());
            assertTrue("Resolved favorites callback took "+callbackMs+" ms behind unrelated held API work; budget="+FIRST_CONTENT_MS+" ms",withinBudget && callbackMs<=FIRST_CONTENT_MS);
        }
    }

    @Test public void coldCatalogDeliveryDoesNotWaitForOptionalPersistence() throws Exception {
        try(Harness h=new Harness()){
            Field field=NetworkTvRepository.class.getDeclaredField("persistenceWorker");field.setAccessible(true);
            java.util.concurrent.ThreadPoolExecutor persistence=(java.util.concurrent.ThreadPoolExecutor)field.get(h.repository);
            CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1),drained=new CountDownLatch(1);
            persistence.execute(()->{held.countDown();try{release.await(HELD_REQUEST_MS,TimeUnit.MILLISECONDS);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}});
            try{
                assertTrue(held.await(2,TimeUnit.SECONDS));
                Result<Catalog> result=new Result<>();long requestedAt=System.nanoTime();h.repository.catalog(Kind.MOVIE,false,result);
                boolean withinBudget=h.dispatchUntil(result,FIRST_CONTENT_MS);
                assertTrue(h.dispatchUntil(result,8000));h.assertCatalog(result,Kind.MOVIE);long callbackMs=elapsed(requestedAt,result.deliveredAt);
                assertEquals("The persistence fixture must still be held at first delivery",1L,release.getCount());
                assertTrue("Catalog persistence must have been queued independently",persistence.getQueue().size()>0);
                MetadataDiskCache disk=new MetadataDiskCache(new File(h.files,"catalog-cache-v1"));
                assertNull("No durable catalog is needed for the first verified result",disk.readCatalog(h.repository.currentScope(),Kind.MOVIE,NOW+600000,NOW));
                release.countDown();persistence.execute(drained::countDown);assertTrue(drained.await(5,TimeUnit.SECONDS));
                assertNotNull("Queued persistence still writes the valid scoped catalog",disk.readCatalog(h.repository.currentScope(),Kind.MOVIE,NOW+600000,NOW));
                android.util.Log.i("CatalogFirstContentLatency",new JSONObject().put("kind","MOVIE").put("stage","cold-held-persistence").put("callbackMs",callbackMs).toString());
                assertTrue("Cold callback must not wait for optional persistence; callback="+callbackMs+" ms",withinBudget && callbackMs<=FIRST_CONTENT_MS);
            }finally{release.countDown();}
        }
    }

    @Test public void queuedOptionalCatalogPersistenceYieldsToPlaybackAndMemoryTrim() throws Exception {
        for(boolean trim:new boolean[]{false,true})try(Harness h=new Harness()){
            Field field=NetworkTvRepository.class.getDeclaredField("persistenceWorker");field.setAccessible(true);
            java.util.concurrent.ThreadPoolExecutor persistence=(java.util.concurrent.ThreadPoolExecutor)field.get(h.repository);
            CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1),drained=new CountDownLatch(1);Object player=new Object();
            persistence.execute(()->{held.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}});
            try{
                assertTrue(held.await(2,TimeUnit.SECONDS));
                Result<Catalog> result=new Result<>();h.repository.catalog(Kind.MOVIE,false,result);
                assertTrue(h.dispatchUntil(result,5000));h.assertCatalog(result,Kind.MOVIE);
                assertTrue(persistence.getQueue().size()>0);String scope=h.repository.currentScope();
                if(trim)h.repository.trimMemory(Kind.MOVIE);else vip.flixify.tv.BackgroundWorkGate.beginPlayback(player);
                release.countDown();persistence.execute(drained::countDown);assertTrue(drained.await(5,TimeUnit.SECONDS));
                MetadataDiskCache disk=new MetadataDiskCache(new File(h.files,"catalog-cache-v1"));
                assertNull("Queued optional persistence cannot inherit foreground permission after "+(trim?"memory trim":"playback starts"),disk.readCatalog(scope,Kind.MOVIE,NOW+600000,NOW));
                assertEquals(scope,h.repository.currentScope());assertTrue(h.repository.hasSession());
            }finally{release.countDown();vip.flixify.tv.BackgroundWorkGate.endPlayback(player);}
        }
    }

    private static long elapsed(long start,long end){return TimeUnit.NANOSECONDS.toMillis(end-start);}
    private static String date(long value){
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));return format.format(new Date(value));
    }
    private static void remove(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);assertTrue("Fixture cache cleanup failed",file.delete());}
}
