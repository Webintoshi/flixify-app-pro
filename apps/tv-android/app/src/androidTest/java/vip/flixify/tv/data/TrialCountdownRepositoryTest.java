package vip.flixify.tv.data;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.SystemClock;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TrialCountdown;
import vip.flixify.tv.TvModels.Account;
import vip.flixify.tv.TvModels.Failure;
import vip.flixify.tv.TvRepository;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TrialCountdownRepositoryTest {
    private static final String SERVER="2026-11-07T11:00:00.000Z",TRIAL_END="2026-11-07T14:00:00.000Z";
    private static final String APP_END="2031-01-01T00:00:00.000Z",PROVIDER_END="2030-01-01T00:00:00.000Z";
    private static final String ACCESS="fixture-countdown-access";
    private static final class Result<T> implements TvRepository.Callback<T> {
        T value;Failure error;int calls;
        public void onResult(T value){this.value=value;calls++;}
        public void onError(Failure error){this.error=error;calls++;}
    }
    private static JSONObject timer(String status,String server,Object end)throws Exception{
        return new JSONObject().put("status",status).put("serverNow",server).put("endsAt",end);
    }
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory {
        final AtomicInteger logins=new AtomicInteger(),accountReads=new AtomicInteger(),providerReads=new AtomicInteger();
        volatile JSONObject timer;
        volatile String title="3 Saat Deneme";
        volatile boolean subscribed=true,assigned=true,pending=false;
        Fixture()throws Exception{timer=timer("active",SERVER,TRIAL_END);}
        @Override public HttpURLConnection open(URL url){
            assertEquals("https",url.getProtocol());assertEquals("api.flixify.vip",url.getHost());assertNull(url.getQuery());assertNull(url.getUserInfo());
            return new HttpURLConnection(url){
                final ByteArrayOutputStream body=new ByteArrayOutputStream();byte[] bytes;
                public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
                public OutputStream getOutputStream(){return body;}
                private void prepare(){
                    if(bytes!=null)return;
                    try{
                        JSONObject raw;
                        switch(url.getPath()){
                            case "/auth/login-by-code":
                                logins.incrementAndGet();assertEquals("POST",getRequestMethod());assertNull(getRequestProperty("Authorization"));
                                assertEquals("FIXTURECODE12345",new JSONObject(body.toString("UTF-8")).getString("code"));
                                raw=new JSONObject().put("accessToken",ACCESS).put("refreshToken","fixture-countdown-refresh-with-32-characters").put("user",new JSONObject().put("id","countdown-fixture-account").put("codeSuffix","1234"));break;
                            case "/me":
                                accountReads.incrementAndGet();assertEquals("GET",getRequestMethod());assertEquals("Bearer "+ACCESS,getRequestProperty("Authorization"));
                                JSONObject user=new JSONObject().put("id","countdown-fixture-account").put("codeSuffix","1234").put("status","active").put("hasAssignedLink",assigned).put("hasActiveSubscription",subscribed);
                                if(subscribed)user.put("activePackage",new JSONObject().put("title",title).put("endsAt",APP_END));
                                if(pending)user.put("trialProvisionStatus","pending");
                                raw=new JSONObject().put("user",user);JSONObject snapshot=timer;if(snapshot!=null)raw.put("trialCountdown",snapshot);break;
                            case "/me/provider-session":
                                providerReads.incrementAndGet();assertEquals("GET",getRequestMethod());assertEquals("Bearer "+ACCESS,getRequestProperty("Authorization"));
                                raw=new JSONObject().put("accountId","countdown-fixture-account").put("sourceVersion","countdown-fixture-source").put("providerOrigin","https://provider.invalid").put("username","fixture-user").put("password","fixture-password").put("expiresAt",PROVIDER_END).put("moviePolicy","general-audience-only");break;
                            default:throw new AssertionError("Unexpected fixture endpoint");
                        }
                        bytes=raw.toString().getBytes(StandardCharsets.UTF_8);
                    }catch(Exception malformed){throw new AssertionError("Invalid fixture response",malformed);}
                }
                public int getResponseCode(){prepare();return 200;}
                public String getHeaderField(String name){prepare();return "Content-Length".equals(name)?Integer.toString(bytes.length):null;}
                public InputStream getInputStream(){prepare();return new ByteArrayInputStream(bytes);}
            };
        }
    }
    private static final class Harness implements AutoCloseable {
        final Fixture fixture=new Fixture();
        final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
        final AtomicLong wallClock=new AtomicLong(1780000000000L);
        final SharedPreferences preferences;final File files;final NetworkTvRepository repository;
        Harness()throws Exception{
            Context app=ApplicationProvider.getApplicationContext();String name="trial-countdown-"+System.nanoTime();
            files=new File(app.getCacheDir(),name);assertTrue(files.mkdirs());preferences=app.getSharedPreferences(name,Context.MODE_PRIVATE);
            Context context=new ContextWrapper(app){
                public Context getApplicationContext(){return this;}
                public File getFilesDir(){return files;}
                public SharedPreferences getSharedPreferences(String key,int mode){return "tv_encrypted_session".equals(key)?preferences:app.getSharedPreferences(name+"-"+key,mode);}
            };
            repository=new NetworkTvRepository(context,fixture,wallClock::get,deliveries::add);
        }
        void await(Result<?> result)throws Exception{
            long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while(result.calls==0){long remaining=until-System.nanoTime();assertTrue("Repository callback timed out",remaining>0);Runnable delivery=deliveries.poll(remaining,TimeUnit.NANOSECONDS);assertNotNull("Repository callback timed out",delivery);delivery.run();}
            assertEquals(1,result.calls);assertNull(result.error);
        }
        Account login()throws Exception{Result<Account> result=new Result<>();repository.login("FIXTURECODE12345",result);await(result);assertNotNull(result.value);return result.value;}
        Account account(boolean force)throws Exception{Result<Account> result=new Result<>();repository.account(force,result);await(result);assertNotNull(result.value);return result.value;}
        void assertAccessUnchanged(Account account)throws Exception{
            assertTrue(repository.hasSession());assertTrue(account.canPlay);assertEquals(Account.Access.ACTIVE,account.access);
            assertEquals(ProviderParser.date(PROVIDER_END),account.expiresAtMs);
        }
        public void close()throws Exception{
            repository.logout();List<ExecutorService> executors=new ArrayList<>();
            for(Field field:NetworkTvRepository.class.getDeclaredFields())if(ExecutorService.class.isAssignableFrom(field.getType())){field.setAccessible(true);ExecutorService executor=(ExecutorService)field.get(repository);executors.add(executor);executor.shutdownNow();}
            for(ExecutorService executor:executors)assertTrue("Repository worker did not stop",executor.awaitTermination(2,TimeUnit.SECONDS));
            preferences.edit().clear().commit();remove(files);
        }
        private void remove(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);assertTrue(file.delete());}
    }
    @Test public void serverSnapshotUsesMonotonicTimeAndCachedAccountRetainsItsAnchor()throws Exception{
        try(Harness h=new Harness()){
            long before=SystemClock.elapsedRealtime();Account first=h.login();long after=SystemClock.elapsedRealtime();h.assertAccessUnchanged(first);
            TrialCountdown countdown=first.trialCountdown;assertEquals("active",countdown.status);
            assertEquals(ProviderParser.date(SERVER),countdown.serverNowMs);assertEquals(ProviderParser.date(TRIAL_END),countdown.endsAtMs);
            assertTrue(countdown.receivedAtMs>=before&&countdown.receivedAtMs<=after);
            assertEquals(10800000L,countdown.remainingMillis(countdown.receivedAtMs));
            assertEquals(10799000L,countdown.remainingMillis(countdown.receivedAtMs+1000));
            h.wallClock.addAndGet(30000);Account cached=h.account(false);
            assertSame(first,cached);assertSame(countdown,cached.trialCountdown);
            assertEquals(countdown.receivedAtMs,cached.trialCountdown.receivedAtMs);
            assertEquals(10770000L,cached.trialCountdown.remainingMillis(countdown.receivedAtMs+30000));
            assertEquals(1,h.fixture.logins.get());assertEquals(1,h.fixture.accountReads.get());assertEquals(1,h.fixture.providerReads.get());
        }
    }
    @Test public void refreshedSnapshotKeepsTheOriginalEndRatherThanStartingThreeHoursAgain()throws Exception{
        try(Harness h=new Harness()){
            Account first=h.login();h.fixture.timer=timer("active","2026-11-07T11:10:00.000Z",TRIAL_END);
            Account refreshed=h.account(true);h.assertAccessUnchanged(refreshed);
            assertEquals(first.trialCountdown.endsAtMs,refreshed.trialCountdown.endsAtMs);
            assertEquals(10200000L,refreshed.trialCountdown.remainingMillis(refreshed.trialCountdown.receivedAtMs));
            assertEquals(1,h.fixture.logins.get());assertEquals(2,h.fixture.accountReads.get());
        }
    }
    @Test public void paidUpgradeClearsTheTrialWithoutChangingAccessPolicy()throws Exception{
        try(Harness h=new Harness()){
            assertEquals("active",h.login().trialCountdown.status);
            h.fixture.title="1 Ay";h.fixture.timer=timer("none",SERVER,JSONObject.NULL);
            Account paid=h.account(true);h.assertAccessUnchanged(paid);assertFalse(paid.trial);
            assertEquals("none",paid.trialCountdown.status);assertFalse(paid.trialCountdown.visible());assertEquals(0,paid.trialCountdown.remainingMillis(SystemClock.elapsedRealtime()));
        }
    }
    @Test public void missingMetadataFromOlderApiHidesTheCountdown()throws Exception{
        try(Harness h=new Harness()){
            h.fixture.timer=null;Account account=h.login();h.assertAccessUnchanged(account);assertTrue(account.trial);
            assertEquals("none",account.trialCountdown.status);assertFalse(account.trialCountdown.visible());assertEquals(0,account.trialCountdown.remainingMillis(SystemClock.elapsedRealtime()));
        }
    }
    @Test public void malformedCountdownIsUnavailableAndDoesNotFailAuthorizedLogin()throws Exception{
        try(Harness h=new Harness()){
            h.fixture.timer=timer("active","invalid-clock",TRIAL_END);Account account=h.login();h.assertAccessUnchanged(account);
            assertEquals("unavailable",account.trialCountdown.status);assertEquals(0,account.trialCountdown.remainingMillis(SystemClock.elapsedRealtime()));
            assertEquals(1,h.fixture.accountReads.get());assertEquals(1,h.fixture.providerReads.get());
        }
    }
    @Test public void pendingTrialDoesNotStartAClockOrGrantProviderAccess()throws Exception{
        try(Harness h=new Harness()){
            h.fixture.subscribed=false;h.fixture.assigned=false;h.fixture.pending=true;h.fixture.timer=timer("pending",SERVER,JSONObject.NULL);
            Account account=h.login();assertTrue(h.repository.hasSession());assertFalse(account.canPlay);assertEquals(Account.Access.TRIAL_PENDING,account.access);
            assertEquals("pending",account.trialCountdown.status);assertEquals(0,account.trialCountdown.remainingMillis(SystemClock.elapsedRealtime()));assertEquals(0,h.fixture.providerReads.get());
        }
    }
    @Test public void countdownMetadataCannotGrantAnExpiredAccountAccess()throws Exception{
        try(Harness h=new Harness()){
            h.fixture.subscribed=false;Account account=h.login();assertTrue(h.repository.hasSession());assertFalse(account.canPlay);assertEquals(Account.Access.EXPIRED,account.access);
            assertEquals("active",account.trialCountdown.status);assertEquals(0,h.fixture.providerReads.get());
        }
    }
}
