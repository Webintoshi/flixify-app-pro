package vip.flixify.tv.data;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import vip.flixify.tv.WelcomeOffer;
import vip.flixify.tv.TvModels.Failure;
import vip.flixify.tv.TvRepository;
import static org.junit.Assert.*;

/** All requests finish in memory; no provider connection, purchase or account is created. */
@RunWith(AndroidJUnit4.class)
public class WelcomeOfferRepositoryTest {
    private final Context context=ApplicationProvider.getApplicationContext();
    private final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
    private final Fixture fixture=new Fixture();
    @Before public void reset(){new TokenStore(context).clear();context.getSharedPreferences("tv_welcome_resolved_v1",Context.MODE_PRIVATE).edit().clear().commit();}
    private static final class Result implements TvRepository.Callback<WelcomeOffer>{WelcomeOffer value;Failure error;public void onResult(WelcomeOffer value){this.value=value;}public void onError(Failure error){this.error=error;}}
    private NetworkTvRepository repository(String account)throws Exception{new TokenStore(context).save(new TokenStore.Session("fixture-access","fixture-refresh-32characters-value",account,"1234"));return new NetworkTvRepository(context,fixture,System::currentTimeMillis,deliveries::add);}
    private void deliver()throws Exception{Runnable result=deliveries.poll(5,TimeUnit.SECONDS);assertNotNull("Serialized API worker completion",result);result.run();}
    private static String state(String value)throws Exception{
        boolean eligible="pending".equals(value)||"dismissed".equals(value);
        return "{\"campaign\":\"welcome-monthly-50-v1\",\"state\":\""+value+"\",\"eligible\":"+eligible+",\"offers\":"+(eligible?"[{\"id\":\"welcome-monthly-50-v1\",\"packageSlug\":\"1-ay\",\"users\":1,\"durationMonths\":1,\"amountMinor\":12500,\"regularAmountMinor\":25000,\"currency\":\"try\"},{\"id\":\"welcome-monthly-50-v1\",\"packageSlug\":\"1-ay-2-kullanici\",\"users\":2,\"durationMonths\":1,\"amountMinor\":19950,\"regularAmountMinor\":39900,\"currency\":\"try\"}]":"[]")+",\"catalogue\":{\"movies\":11955,\"live\":12677,\"series\":1675}}";
    }
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory{
        final AtomicInteger reads=new AtomicInteger(),choices=new AtomicInteger();volatile String result="not_eligible",posted="";volatile boolean invalid;
        @Override public HttpURLConnection open(URL url){return new HttpURLConnection(url){
            final ByteArrayOutputStream body=new ByteArrayOutputStream();byte[] bytes;
            @Override public void connect(){}@Override public void disconnect(){}@Override public boolean usingProxy(){return false;}
            @Override public OutputStream getOutputStream(){return body;}
            private void prepare(){if(bytes!=null)return;try{
                assertEquals("api.flixify.vip",url.getHost());assertEquals("Bearer fixture-access",getRequestProperty("Authorization"));
                if(url.getPath().equals("/me/welcome-offer")){assertEquals("GET",getRequestMethod());reads.incrementAndGet();}
                else if(url.getPath().equals("/me/welcome-offer/choice")){assertEquals("POST",getRequestMethod());choices.incrementAndGet();posted=body.toString("UTF-8");result="dismissed";}
                else throw new AssertionError("Unexpected API fixture path");
                String value=state(result);if(invalid)value=value.replace("12500","1");bytes=value.getBytes(StandardCharsets.UTF_8);
            }catch(Exception error){throw new AssertionError(error);}}
            @Override public int getResponseCode(){prepare();return 200;}
            @Override public String getHeaderField(String name){prepare();return "Content-Length".equals(name)?String.valueOf(bytes.length):null;}
            @Override public InputStream getInputStream(){prepare();return new ByteArrayInputStream(bytes);}
        };}
    }
    @Test public void resolvedHistoricalStateIsRememberedPerAccountAcrossRepositoryRecreation()throws Exception{
        NetworkTvRepository first=repository("welcome-old-account");Result one=new Result();first.welcomeOffer(one);deliver();assertNull(one.error);assertFalse(one.value.showPrompt());
        Result two=new Result();repository("welcome-old-account").welcomeOffer(two);deliver();assertFalse(two.value.showPrompt());assertEquals(1,fixture.reads.get());
        assertTrue(context.getSharedPreferences("tv_welcome_resolved_v1",Context.MODE_PRIVATE).getAll().keySet().iterator().next().matches("[0-9a-f]{64}"));
    }
    @Test public void pendingStateIsNotMemoizedAndFreeChoiceOnlyAcknowledgesChoice()throws Exception{
        fixture.result="pending";NetworkTvRepository repository=repository("welcome-new-account");Result first=new Result();repository.welcomeOffer(first);deliver();assertTrue(first.value.showPrompt());
        Result again=new Result();repository.welcomeOffer(again);deliver();assertTrue(again.value.showPrompt());assertEquals(2,fixture.reads.get());
        Result choice=new Result();repository.chooseWelcomeOffer("trial",choice);deliver();assertFalse(choice.value.showPrompt());assertTrue(choice.value.eligible);assertEquals(1,fixture.choices.get());
        JSONObject posted=new JSONObject(fixture.posted);assertEquals(1,posted.length());assertEquals("trial",posted.getString("choice"));
        Result memo=new Result();repository.welcomeOffer(memo);deliver();assertFalse(memo.value.showPrompt());assertEquals(2,fixture.reads.get());
    }
    @Test public void latePreviousAccountResultIsStaleAndCannotMemoizeNewAccount()throws Exception{
        NetworkTvRepository previous=repository("welcome-account-a");Result old=new Result();previous.welcomeOffer(old);
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(deliveries.isEmpty() && System.nanoTime()<deadline)Thread.sleep(5);assertFalse(deliveries.isEmpty());previous.logout();deliver();assertNotNull(old.error);assertEquals(Failure.Code.STALE,old.error.code);
        fixture.result="pending";Result current=new Result();repository("welcome-account-b").welcomeOffer(current);deliver();assertNull(current.error);assertTrue(current.value.showPrompt());assertEquals(2,fixture.reads.get());
    }
    @Test public void invalidQuoteFailsClosedWithoutMemoAndCanRetry()throws Exception{
        fixture.result="pending";fixture.invalid=true;NetworkTvRepository repository=repository("welcome-bad-response");Result bad=new Result();repository.welcomeOffer(bad);deliver();assertNotNull(bad.error);assertEquals(Failure.Code.INVALID,bad.error.code);assertTrue(context.getSharedPreferences("tv_welcome_resolved_v1",Context.MODE_PRIVATE).getAll().isEmpty());
        fixture.invalid=false;Result retry=new Result();repository.welcomeOffer(retry);deliver();assertNull(retry.error);assertTrue(retry.value.showPrompt());assertEquals(2,fixture.reads.get());
    }
}
