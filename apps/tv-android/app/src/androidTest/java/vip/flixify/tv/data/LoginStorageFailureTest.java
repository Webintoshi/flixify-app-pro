package vip.flixify.tv.data;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.util.Base64;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
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
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.DeviceLogin;
import vip.flixify.tv.TvModels.Account;
import vip.flixify.tv.TvModels.Failure;
import vip.flixify.tv.TvRepository;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class LoginStorageFailureTest {
    private static final String ACCESS="fixture-storage-access",REFRESH="fixture-storage-refresh";
    private static final class Result<T> implements TvRepository.Callback<T> {
        T value;Failure error;int calls;
        public void onResult(T result){value=result;calls++;}
        public void onError(Failure failure){error=failure;calls++;}
    }
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory {
        private static final String ID="91967439-9fa8-4d70-9e92-62385f356381",PROOF="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        final AtomicInteger logins=new AtomicInteger(),starts=new AtomicInteger(),polls=new AtomicInteger(),acks=new AtomicInteger(),me=new AtomicInteger(),provider=new AtomicInteger();
        final String png;
        Fixture(){
            Bitmap image=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888);image.eraseColor(android.graphics.Color.WHITE);
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,bytes));image.recycle();png=Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP);
        }
        private JSONObject session()throws Exception{return new JSONObject().put("accessToken",ACCESS).put("refreshToken",REFRESH).put("user",new JSONObject().put("id","storage-fixture-account").put("codeSuffix","1234"));}
        public HttpURLConnection open(URL url){
            assertEquals("https",url.getProtocol());assertEquals("api.flixify.vip",url.getHost());assertNull(url.getQuery());
            return new HttpURLConnection(url){
                final ByteArrayOutputStream body=new ByteArrayOutputStream();byte[] response;
                public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
                public OutputStream getOutputStream(){return body;}
                private void resolve(){
                    if(response!=null)return;
                    try{
                        JSONObject raw;String path=url.getPath();
                        if(path.equals("/me")){
                            me.incrementAndGet();raw=new JSONObject().put("user",new JSONObject().put("id","storage-fixture-account").put("status","active").put("codeSuffix","1234").put("hasAssignedLink",true).put("hasActiveSubscription",true).put("activePackage",new JSONObject().put("title","Fixture Paket").put("endsAt","2030-01-01T00:00:00.000Z")));
                        }else if(path.equals("/me/provider-session")){
                            provider.incrementAndGet();raw=new JSONObject().put("accountId","storage-fixture-account").put("sourceVersion","storage-fixture-source").put("providerOrigin","https://provider.invalid").put("username","fixture-user").put("password","fixture-password").put("expiresAt","2030-01-01T00:00:00.000Z").put("moviePolicy","general-audience-only");
                        }else{
                            assertEquals("POST",getRequestMethod());assertNull(getRequestProperty("Authorization"));JSONObject input=new JSONObject(body.toString("UTF-8"));
                            switch(path){
                                case "/auth/login-by-code":logins.incrementAndGet();assertEquals("FIXTURECODE12345",input.getString("code"));raw=session();break;
                                case "/auth/device/start":starts.incrementAndGet();assertEquals("android_tv",input.getString("platform"));raw=new JSONObject().put("requestId",ID).put("deviceSecret",PROOF).put("userCode","BCDF-GHJK").put("verificationUri","https://flixify.vip/cihaz").put("verificationUriComplete","https://flixify.vip/cihaz?code=BCDF-GHJK").put("qrPngBase64",png).put("expiresAt","2030-01-01T00:03:00.000Z").put("expiresInSeconds",180).put("intervalSeconds",2);break;
                                case "/auth/device/token":polls.incrementAndGet();proof(input);raw=new JSONObject().put("status","authorized").put("intervalSeconds",2).put("session",session());break;
                                case "/auth/device/ack":acks.incrementAndGet();proof(input);raw=new JSONObject().put("status","complete");break;
                                case "/auth/device/cancel":proof(input);raw=new JSONObject().put("status","cancelled");break;
                                default:throw new AssertionError("Unexpected fixture endpoint");
                            }
                        }
                        response=raw.toString().getBytes(StandardCharsets.UTF_8);
                    }catch(Exception malformed){throw new AssertionError("Invalid fixture response",malformed);}
                }
                private void proof(JSONObject input)throws Exception{assertEquals(2,input.length());assertEquals(ID,input.getString("requestId"));assertEquals(PROOF,input.getString("deviceSecret"));}
                public int getResponseCode(){resolve();return 200;}
                public String getHeaderField(String name){resolve();return "Content-Length".equals(name)?Integer.toString(response.length):null;}
                public InputStream getInputStream(){resolve();return new ByteArrayInputStream(response);}
            };
        }
    }
    private static final class Harness implements AutoCloseable {
        final Fixture fixture=new Fixture();final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();
        final AtomicInteger refusedCommits=new AtomicInteger();final SharedPreferences preferences;final Context context;final File files;final NetworkTvRepository repository;
        Harness(){
            Context app=ApplicationProvider.getApplicationContext();String suffix="login-storage-"+System.nanoTime();files=new File(app.getCacheDir(),suffix);assertTrue(files.mkdirs());
            preferences=app.getSharedPreferences(suffix,Context.MODE_PRIVATE);
            SharedPreferences failing=(SharedPreferences)Proxy.newProxyInstance(SharedPreferences.class.getClassLoader(),new Class<?>[]{SharedPreferences.class},(proxy,method,args)->{
                if(!method.getName().equals("edit"))return method.invoke(preferences,args);
                SharedPreferences.Editor editor=preferences.edit();boolean[] sessionPut={false};
                return Proxy.newProxyInstance(SharedPreferences.Editor.class.getClassLoader(),new Class<?>[]{SharedPreferences.Editor.class},(editorProxy,operation,values)->{
                    if(operation.getName().equals("putString") && "session".equals(values[0]))sessionPut[0]=true;
                    if(operation.getName().equals("commit") && sessionPut[0]){assertTrue("Fixture publishes the encrypted record before reporting failure",editor.commit());refusedCommits.incrementAndGet();return false;}
                    Object result=operation.invoke(editor,values);return result instanceof SharedPreferences.Editor?editorProxy:result;
                });
            });
            context=new ContextWrapper(app){
                public Context getApplicationContext(){return this;}
                public File getFilesDir(){return files;}
                public SharedPreferences getSharedPreferences(String name,int mode){return name.equals("tv_encrypted_session")?failing:app.getSharedPreferences(suffix+"-"+name,mode);}
            };
            repository=new NetworkTvRepository(context,fixture,System::currentTimeMillis,deliveries::add);
        }
        void await(Result<?> result)throws Exception{
            long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while(result.calls==0){long remaining=until-System.nanoTime();assertTrue("Repository callback timed out",remaining>0);Runnable delivery=deliveries.poll(remaining,TimeUnit.NANOSECONDS);assertNotNull("Repository callback timed out",delivery);delivery.run();}
            assertEquals(1,result.calls);
        }
        void assertStorageFailure(Result<?> result){
            assertNull(result.value);assertNotNull(result.error);assertEquals(Failure.Code.STORAGE,result.error.code);assertEquals("G04",result.error.storageCode);
            assertTrue(result.error.message.contains("G04"));assertFalse(result.error.message.contains(ACCESS));assertFalse(result.error.message.contains(REFRESH));
            assertFalse(repository.hasSession());assertEquals("",repository.currentAccountId());assertNull(new TokenStore(context).load());assertFalse(preferences.contains("session"));
            assertEquals(1,refusedCommits.get());assertEquals(0,fixture.me.get());assertEquals(0,fixture.provider.get());assertEquals(0,fixture.acks.get());
        }
        public void close()throws Exception{
            repository.logout();List<ExecutorService> executors=new ArrayList<>();
            for(Field field:NetworkTvRepository.class.getDeclaredFields())if(ExecutorService.class.isAssignableFrom(field.getType())){field.setAccessible(true);ExecutorService executor=(ExecutorService)field.get(repository);executors.add(executor);executor.shutdownNow();}
            for(ExecutorService executor:executors)assertTrue("Repository worker did not stop",executor.awaitTermination(2,TimeUnit.SECONDS));
            preferences.edit().clear().commit();remove(files);
        }
        private void remove(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)remove(child);assertTrue(file.delete());}
    }
    @Test public void manualLoginReportsStorageFailureWithoutInstallingOrResurrectingTheSession()throws Exception{
        try(Harness h=new Harness()){
            Result<Account> result=new Result<>();h.repository.login("FIXTURECODE12345",result);h.await(result);h.assertStorageFailure(result);
            assertEquals(1,h.fixture.logins.get());assertEquals(0,h.fixture.starts.get());assertEquals(0,h.fixture.polls.get());
        }
    }
    @Test public void approvedQrReportsStorageFailureWithoutAckOrAccountRequests()throws Exception{
        try(Harness h=new Harness()){
            Result<DeviceLogin.Attempt> start=new Result<>();h.repository.startDeviceLogin(start);h.await(start);assertNull(start.error);assertNotNull(start.value);
            Result<DeviceLogin.Poll> poll=new Result<>();start.value.poll(poll);h.await(poll);assertNull(poll.error);assertEquals("authorized",poll.value.status);
            Result<Void> adopted=new Result<>();start.value.adopt(()->true,adopted);h.await(adopted);h.assertStorageFailure(adopted);
            assertEquals(0,h.fixture.logins.get());assertEquals(1,h.fixture.starts.get());assertEquals(1,h.fixture.polls.get());start.value.cancel();
        }
    }
}
