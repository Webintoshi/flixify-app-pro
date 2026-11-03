package vip.flixify.tv.data;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Base64;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import vip.flixify.tv.DeviceLogin;
import vip.flixify.tv.TvModels.Failure;
import vip.flixify.tv.TvRepository;
import static org.junit.Assert.*;

/** HTTPS is replaced at the connection boundary. No request leaves this process. */
@RunWith(AndroidJUnit4.class)
public class DeviceLoginRepositoryTest {
    private final Context context=ApplicationProvider.getApplicationContext();
    private final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
    private final Fixture fixture=new Fixture();
    @Before public void reset(){new TokenStore(context).clear();}
    private static final class Result<T> implements TvRepository.Callback<T>{T value;Failure error;public void onResult(T value){this.value=value;}public void onError(Failure error){this.error=error;}}
    private NetworkTvRepository repository(){return new NetworkTvRepository(context,fixture,System::currentTimeMillis,deliveries::add);}
    private void deliver()throws Exception{Runnable result=deliveries.poll(5,TimeUnit.SECONDS);assertNotNull("pairing callback",result);result.run();}
    private DeviceLogin.Attempt start(NetworkTvRepository repository)throws Exception{Result<DeviceLogin.Attempt> result=new Result<>();repository.startDeviceLogin(result);deliver();assertNull(result.error);assertNotNull(result.value);return result.value;}
    private void authorize(DeviceLogin.Attempt attempt)throws Exception{fixture.status="authorized";Result<DeviceLogin.Poll> poll=new Result<>();attempt.poll(poll);deliver();assertNull(poll.error);assertEquals("authorized",poll.value.status);}
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory {
        static final String ID="91967439-9fa8-4d70-9e92-62385f356381",SECRET="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        volatile String status="pending",png;volatile int starts,polls,acks,cancels;
        Fixture(){Bitmap image=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888);image.eraseColor(android.graphics.Color.WHITE);ByteArrayOutputStream bytes=new ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.PNG,100,bytes);png=Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP);image.recycle();}
        @Override public HttpURLConnection open(URL url){return new HttpURLConnection(url){
            final ByteArrayOutputStream body=new ByteArrayOutputStream();byte[] bytes;
            public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public OutputStream getOutputStream(){return body;}
            private void prepare(){if(bytes!=null)return;try{
                assertEquals("https",url.getProtocol());assertEquals("api.flixify.vip",url.getHost());assertEquals("POST",getRequestMethod());assertNull(getRequestProperty("Authorization"));
                JSONObject input=new JSONObject(body.toString("UTF-8")),response=new JSONObject();
                switch(url.getPath()){
                    case "/auth/device/start":starts++;assertEquals("android_tv",input.getString("platform"));assertTrue(input.has("installationId"));assertFalse(input.has("deviceSecret"));response.put("requestId",ID).put("deviceSecret",SECRET).put("userCode","BCDF-GHJK").put("verificationUri","https://flixify.vip/cihaz").put("verificationUriComplete","https://flixify.vip/cihaz?code=BCDF-GHJK").put("qrPngBase64",png).put("expiresAt","2030-01-01T00:03:00.000Z").put("expiresInSeconds",180).put("intervalSeconds",2);break;
                    case "/auth/device/token":polls++;proof(input);response.put("status",status).put("intervalSeconds",2);if("authorized".equals(status))response.put("session",new JSONObject().put("accessToken","fixture-access").put("refreshToken","fixture-refresh").put("user",new JSONObject().put("id","pairing-fixture").put("codeSuffix","1234")));break;
                    case "/auth/device/ack":acks++;proof(input);response.put("status","complete");break;
                    case "/auth/device/cancel":cancels++;proof(input);response.put("status","cancelled");break;
                    default:throw new AssertionError("Unexpected path: "+url.getPath());
                }bytes=response.toString().getBytes(StandardCharsets.UTF_8);
            }catch(Exception e){throw new AssertionError(e);}}
            private void proof(JSONObject input)throws Exception{assertEquals(2,input.length());assertEquals(ID,input.getString("requestId"));assertEquals(SECRET,input.getString("deviceSecret"));}
            public int getResponseCode(){prepare();return 200;}public String getHeaderField(String name){prepare();return "Content-Length".equals(name)?String.valueOf(bytes.length):null;}public InputStream getInputStream(){prepare();return new ByteArrayInputStream(bytes);}
        };}
    }
    @Test public void authorizedResponseRequiresFencedAdoptionAndAckUsesSameProof()throws Exception{
        NetworkTvRepository repository=repository();DeviceLogin.Attempt attempt=start(repository);assertEquals("BCDF-GHJK",attempt.display().userCode);authorize(attempt);assertFalse(repository.hasSession());assertNull(new TokenStore(context).load());
        Result<Void> adopt=new Result<>();attempt.adopt(()->true,adopt);deliver();assertNull(adopt.error);assertTrue(repository.hasSession());assertEquals("pairing-fixture",new TokenStore(context).load().accountId);
        Result<Void> ack=new Result<>();attempt.ack(ack);deliver();assertNull(ack.error);assertEquals(1,fixture.acks);attempt.cancel();assertTrue(repository.hasSession());assertEquals(0,fixture.cancels);
        assertFalse(context.getSharedPreferences("tv_encrypted_session",0).getAll().toString().contains(Fixture.SECRET));
    }
    @Test public void hiddenOwnerAndLogoutCannotSaveLateAuthorizedTokens()throws Exception{
        NetworkTvRepository repository=repository();DeviceLogin.Attempt attempt=start(repository);authorize(attempt);Result<Void> hidden=new Result<>();attempt.adopt(()->false,hidden);deliver();assertNotNull(hidden.error);assertFalse(repository.hasSession());
        repository.logout();Result<Void> late=new Result<>();attempt.adopt(()->true,late);deliver();assertNotNull(late.error);assertFalse(repository.hasSession());assertNull(new TokenStore(context).load());
    }
    @Test public void replacementInvalidatesOldAuthorizedChallenge()throws Exception{
        NetworkTvRepository repository=repository();DeviceLogin.Attempt old=start(repository);authorize(old);DeviceLogin.Attempt fresh=start(repository);Result<Void> late=new Result<>();old.adopt(()->true,late);deliver();assertNotNull(late.error);assertFalse(repository.hasSession());assertNotSame(old,fresh);
    }
    @Test public void invalidAndOversizedPngFailClosedWithSanitizedMessage()throws Exception{
        fixture.png="x".repeat(400000);Result<DeviceLogin.Attempt> result=new Result<>();repository().startDeviceLogin(result);deliver();assertNotNull(result.error);assertNull(result.value);assertFalse(result.error.message.contains(Fixture.SECRET));
    }
    @Test public void adoptedSessionSurvivesBootstrapFailureAndCanRetryWithoutAnotherRedemption()throws Exception{
        NetworkTvRepository repository=repository();DeviceLogin.Attempt attempt=start(repository);authorize(attempt);Result<Void> adopted=new Result<>();attempt.adopt(()->true,adopted);deliver();assertNull(adopted.error);
        // New repository sees the saved session before any /me or provider bootstrap is attempted.
        NetworkTvRepository restarted=repository();assertTrue(restarted.hasSession());assertEquals("pairing-fixture",restarted.currentAccountId());assertEquals(1,fixture.starts);assertEquals(1,fixture.polls);
    }
}
