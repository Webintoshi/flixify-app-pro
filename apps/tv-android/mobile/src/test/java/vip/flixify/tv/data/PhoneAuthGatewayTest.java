package vip.flixify.tv.data;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import vip.flixify.tv.TvRepository;
import vip.flixify.tv.TvModels.Failure;
import static org.junit.Assert.*;

public class PhoneAuthGatewayTest {
    private PhoneAuthGateway gateway;
    private final MemoryStore store=new MemoryStore();
    private final List<Reply> replies=new ArrayList<>();
    private final List<Connection> requests=Collections.synchronizedList(new ArrayList<>());
    private long now;
    private static final class MemoryStore implements PhoneAuthGateway.Storage {
        TokenStore.Session value;boolean fail;
        public TokenStore.Session load(){return value;}
        public void save(TokenStore.Session next)throws Exception{if(fail)throw new IOException("fixture storage unavailable");value=next;}
        public String installationId(){return "fixture-installation";}
    }
    private static final class Reply {
        final int status;final String body;CountDownLatch arrived,release;
        Reply(int status,String body){this.status=status;this.body=body;}
    }
    private static final class Connection extends HttpURLConnection {
        final Reply reply;final ByteArrayOutputStream posted=new ByteArrayOutputStream();final Map<String,String> headers=new HashMap<>();volatile boolean disconnected;
        Connection(URL url,Reply reply){super(url);this.reply=reply;}
        @Override public void setRequestProperty(String key,String value){headers.put(key,value);}
        @Override public OutputStream getOutputStream(){return posted;}
        @Override public int getResponseCode()throws IOException{
            if(reply.arrived!=null)reply.arrived.countDown();
            if(reply.release!=null)try{if(!reply.release.await(2,TimeUnit.SECONDS))throw new IOException("fixture timeout");}catch(InterruptedException e){throw new IOException(e);}
            if(disconnected)throw new IOException("cancelled");return reply.status;
        }
        @Override public InputStream getInputStream(){return new ByteArrayInputStream(reply.body.getBytes(StandardCharsets.UTF_8));}
        @Override public InputStream getErrorStream(){return getInputStream();}
        @Override public void connect(){}
        @Override public boolean usingProxy(){return false;}
        @Override public void disconnect(){disconnected=true;}
        JSONObject body()throws Exception{return new JSONObject(posted.toString("UTF-8"));}
    }
    private static final class Result<T> implements TvRepository.Callback<T> {
        final CountDownLatch done=new CountDownLatch(1);T value;Failure failure;Runnable successful;
        public void onResult(T result){value=result;if(successful!=null)successful.run();done.countDown();}
        public void onError(Failure error){failure=error;done.countDown();}
        void await()throws Exception{assertTrue("fixture callback missing",done.await(3,TimeUnit.SECONDS));}
    }
    private void create(){gateway=new PhoneAuthGateway(store,url->{Reply reply; synchronized(replies){reply=replies.remove(0);}Connection connection=new Connection(url,reply);requests.add(connection);return connection;},Runnable::run,()->now);}
    private void reply(int status,String body){replies.add(new Reply(status,body));}
    private String session()throws Exception{return new JSONObject().put("accessToken","fixture-access-token").put("refreshToken","fixture-refresh-token").put("kryptoniteCode",JSONObject.NULL).put("user",new JSONObject().put("id","fixture-account").put("codeSuffix","ABCD")).toString();}
    private String challenge()throws Exception{return new JSONObject().put("challengeId","11111111-1111-4111-8111-111111111111").put("challengeSecret",String.join("",Collections.nCopies(43,"a"))).put("expiresInSeconds",300).put("resendAfterSeconds",60).put("maskedPhone","+90••••1234").put("delivery","accepted").toString();}
    @After public void close(){if(gateway!=null)gateway.close();}

    @Test public void oldApiStatus404DisablesPhoneWithoutBlockingCodeLogin()throws Exception{
        reply(404,"<html>not found</html>");reply(200,session());create();Result<Boolean> status=new Result<>();gateway.status(status);status.await();assertEquals(Boolean.FALSE,status.value);
        Result<Boolean> login=new Result<>();login.successful=()->assertNotNull(store.value);gateway.loginCode("ab12-cd34 ef56-gh78",login);login.await();assertEquals(Boolean.TRUE,login.value);
        assertEquals("AB12CD34EF56GH78",requests.get(1).body().getString("code"));assertEquals("android_phone",requests.get(1).body().getString("platform"));
        assertEquals("android_phone",requests.get(1).headers.get("X-Flixify-Client-Runtime"));assertFalse(requests.get(1).headers.containsKey("Origin"));
    }
    @Test public void oldWebOnlyEnabledStatusStillFallsBackToUsableCodeLogin()throws Exception{
        reply(200,"{\"enabled\":true,\"deliveryChannel\":\"whatsapp\"}");reply(200,session());create();
        Result<Boolean> status=new Result<>();gateway.status(status);status.await();assertEquals(Boolean.FALSE,status.value);assertNull(status.failure);
        Result<Boolean> login=new Result<>();gateway.loginCode("AB12CD34EF56GH78",login);login.await();assertEquals(Boolean.TRUE,login.value);assertNotNull(store.value);
        assertEquals("/auth/login-by-code",requests.get(1).getURL().getPath());assertEquals(2,requests.size());
    }
    @Test public void nativePhoneRequiresAnExplicitTrueCapability()throws Exception{
        reply(200,"{\"enabled\":true,\"deliveryChannel\":\"whatsapp\",\"nativePhoneLogin\":true}");
        reply(200,"{\"enabled\":true,\"deliveryChannel\":\"whatsapp\",\"nativePhoneLogin\":\"true\"}");
        reply(200,"{\"enabled\":false,\"deliveryChannel\":\"whatsapp\",\"nativePhoneLogin\":true}");create();
        Result<Boolean> supported=new Result<>();gateway.status(supported);supported.await();assertEquals(Boolean.TRUE,supported.value);
        Result<Boolean> stringValue=new Result<>();gateway.status(stringValue);stringValue.await();assertEquals(Boolean.FALSE,stringValue.value);
        Result<Boolean> disabled=new Result<>();gateway.status(disabled);disabled.await();assertEquals(Boolean.FALSE,disabled.value);
        assertNull(store.value);for(Connection request:requests)assertEquals("/auth/phone/status",request.getURL().getPath());
    }
    @Test public void requestAndVerificationKeepProofPrivateAndPersistBeforeCallback()throws Exception{
        reply(200,challenge());reply(200,session());create();Result<String> requested=new Result<>();gateway.request("+905551231234",true,"",requested);requested.await();assertEquals("+90••••1234",requested.value);
        assertEquals("register",requests.get(0).body().getString("intent"));assertEquals("fixture-installation",requests.get(0).body().getString("installationId"));
        Result<Boolean> verified=new Result<>();verified.successful=()->assertEquals("fixture-account",store.value.accountId);gateway.verify("123456",verified);verified.await();assertEquals(Boolean.TRUE,verified.value);
        assertEquals(43,requests.get(1).body().getString("challengeSecret").length());assertEquals("fixture-installation",requests.get(1).body().getString("installationId"));
        assertEquals("/auth/phone/verify",requests.get(1).getURL().getPath());assertEquals("ABCD",store.value.codeSuffix);
    }
    @Test public void expiryAndCooldownNeverAutomaticallySendAnotherMessage()throws Exception{
        reply(200,challenge());create();Result<String> first=new Result<>();gateway.request("+905551231234",false,"",first);first.await();
        Result<String> again=new Result<>();gateway.request("+905551231234",false,"",again);again.await();assertEquals(Failure.Code.LIMIT,again.failure.code);assertEquals(1,requests.size());
        now=300_001;Result<Boolean> expired=new Result<>();gateway.verify("123456",expired);expired.await();assertEquals(Failure.Code.INVALID,expired.failure.code);assertEquals(1,requests.size());assertNull(store.value);
    }
    @Test public void cancellationCannotSaveOrPublishALateLogin()throws Exception{
        Reply reply=new Reply(200,session());reply.arrived=new CountDownLatch(1);reply.release=new CountDownLatch(1);replies.add(reply);create();Result<Boolean> result=new Result<>();gateway.loginCode("AB12CD34EF56GH78",result);
        assertTrue(reply.arrived.await(2,TimeUnit.SECONDS));gateway.close();reply.release.countDown();assertFalse(result.done.await(150,TimeUnit.MILLISECONDS));assertNull(store.value);
    }
    @Test public void concurrentAccountChangePreventsReplacement()throws Exception{
        Reply reply=new Reply(200,session());reply.arrived=new CountDownLatch(1);reply.release=new CountDownLatch(1);replies.add(reply);create();Result<Boolean> result=new Result<>();gateway.loginCode("AB12CD34EF56GH78",result);
        assertTrue(reply.arrived.await(2,TimeUnit.SECONDS));store.value=new TokenStore.Session("other-access","other-refresh","other-account","");reply.release.countDown();result.await();assertEquals(Failure.Code.STALE,result.failure.code);assertEquals("other-account",store.value.accountId);
    }
    @Test public void failedSecureSaveDoesNotReportAuthenticationSuccess()throws Exception{
        reply(200,session());store.fail=true;create();Result<Boolean> result=new Result<>();gateway.loginCode("AB12CD34EF56GH78",result);result.await();assertNull(result.value);assertNotNull(result.failure);assertNull(store.value);
    }
    @Test public void providerErrorMessagesAndInvalidInputNeverLeakOrTriggerUnwantedRegistration()throws Exception{
        reply(409,"{\"reason\":\"registration_required\",\"message\":\"personal provider password\"}");create();Result<String> result=new Result<>();gateway.request("+905551231234",false,"",result);result.await();assertFalse(result.failure.message.contains("password"));assertEquals(1,requests.size());assertNull(store.value);assertEquals(PhoneAuthGateway.Recovery.NONE,gateway.recoveryFor(result.failure));
        Result<Boolean> invalid=new Result<>();gateway.loginCode("short",invalid);invalid.await();assertEquals(Failure.Code.INVALID,invalid.failure.code);assertEquals(1,requests.size());
    }
    @Test public void verifiedRegistrationRejectionRetiresConsumedCodeWithoutSendingAgain()throws Exception{
        reply(200,challenge());reply(409,"{\"reason\":\"registration_required\",\"message\":\"fixture private text\"}");create();
        Result<String> issued=new Result<>();gateway.request("+905551231234",false,"",issued);issued.await();
        Result<Boolean> rejected=new Result<>();gateway.verify("123456",rejected);rejected.await();
        assertNotNull(rejected.failure);assertEquals(Failure.Code.INVALID,rejected.failure.code);
        assertEquals(PhoneAuthGateway.Recovery.REGISTRATION_REQUIRED,gateway.recoveryFor(rejected.failure));
        assertEquals(PhoneAuthGateway.Recovery.NONE,gateway.recoveryFor(new Failure(Failure.Code.INVALID,rejected.failure.message)));
        assertEquals("A consumed code cannot stay available for verification",0,gateway.remainingSeconds());
        Result<Boolean> repeated=new Result<>();gateway.verify("123456",repeated);repeated.await();
        assertEquals(Failure.Code.INVALID,repeated.failure.code);assertEquals(2,requests.size());assertNull(store.value);
    }

    @Test public void verifiedBusinessFailuresExposeOnlyTypedRecoveryAndKeepSessionsUnchanged()throws Exception{
        String[] reasons={"installation_limit","registration_ip_limit","account_conflict","reauthentication_required","account_unavailable"};
        int[] statuses={409,429,409,403,403};
        for(int i=0;i<reasons.length;i++){
            if(gateway!=null)gateway.close();replies.clear();requests.clear();
            reply(200,challenge());reply(statuses[i],new JSONObject().put("reason",reasons[i]).put("message","fixture private provider detail").toString());create();
            Result<String> issued=new Result<>();gateway.request("+905551231234",true,"",issued);issued.await();
            Result<Boolean> result=new Result<>();gateway.verify("123456",result);result.await();
            assertNotNull(result.failure);assertFalse(result.failure.message.contains("private"));
            assertEquals(reasons[i].equals("account_conflict")?PhoneAuthGateway.Recovery.ACCOUNT_CONFLICT:PhoneAuthGateway.Recovery.EXISTING_ACCOUNT,gateway.recoveryFor(result.failure));
            assertEquals(0,gateway.remainingSeconds());assertEquals(2,requests.size());assertNull(store.value);
        }
    }
    @Test public void wrongCodeAndTransientNetworkFailuresKeepTheChallengeForAnExplicitRetry()throws Exception{
        reply(200,challenge());reply(400,"{\"reason\":\"invalid_or_expired\"}");reply(503,"{\"reason\":\"temporarily_unavailable\"}");create();
        Result<String> issued=new Result<>();gateway.request("+905551231234",false,"",issued);issued.await();
        Result<Boolean> wrong=new Result<>();gateway.verify("000000",wrong);wrong.await();
        assertEquals(PhoneAuthGateway.Recovery.NONE,gateway.recoveryFor(wrong.failure));assertEquals(300,gateway.remainingSeconds());
        Result<Boolean> network=new Result<>();gateway.verify("123456",network);network.await();
        assertEquals(PhoneAuthGateway.Recovery.NONE,gateway.recoveryFor(network.failure));assertEquals(300,gateway.remainingSeconds());assertEquals(3,requests.size());assertNull(store.value);
    }

}
