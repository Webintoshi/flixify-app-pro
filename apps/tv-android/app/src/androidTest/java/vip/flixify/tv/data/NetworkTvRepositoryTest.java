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
                    else if(path.equals("/me/provider-session"))raw=new JSONObject().put("accountId","fixture-account").put("sourceVersion",source).put("providerOrigin","https://provider.test").put("username","fixture-user").put("password","fixture-password").put("expiresAt",date(NOW+600000)).put("moviePolicy","general-audience-only");
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
                        else raw=new JSONArray();
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
