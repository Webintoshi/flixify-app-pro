package vip.flixify.tv.data;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Objects;
import java.util.concurrent.*;
import vip.flixify.tv.TvRepository.Callback;
import vip.flixify.tv.TvModels.Failure;

public final class PhoneAuthGateway implements AutoCloseable {
    public enum Recovery { NONE, REGISTRATION_REQUIRED, EXISTING_ACCOUNT, ACCOUNT_CONFLICT }
    private static final String API="https://api.flixify.vip";
    private static final int TIMEOUT=15000,MAX_BYTES=65536;
    interface Storage {TokenStore.Session load();void save(TokenStore.Session value)throws Exception;String installationId();}
    interface Connections {HttpURLConnection open(URL url)throws Exception;}
    interface Clock {long now();}
    private interface Work<T> {T run(long ticket)throws Exception;}
    private final Object lock=new Object();
    private final Storage storage;private final Connections connections;private final java.util.concurrent.Executor callbacks;private final Clock clock;
    private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(2));
    private long generation;private boolean closed;private HttpURLConnection active;private Challenge challenge;private Failure recoveryFailure;private Recovery recovery=Recovery.NONE;
    private static final class Response {final int status;final JSONObject body;Response(int status,JSONObject body){this.status=status;this.body=body;}}
    private static final class Issue extends Exception {
        final Failure.Code code;final String text;final Recovery recovery;
        Issue(Failure.Code code,String text){this(code,text,Recovery.NONE);}
        Issue(Failure.Code code,String text,Recovery recovery){this.code=code;this.text=text;this.recovery=recovery;}
    }
    private static final class Challenge {
        final String id,proof,phone,installation;final long expiry,resend;final TokenStore.Session before;
        Challenge(String id,String proof,String phone,String installation,long expiry,long resend,TokenStore.Session before){this.id=id;this.proof=proof;this.phone=phone;this.installation=installation;this.expiry=expiry;this.resend=resend;this.before=before;}
    }
    public PhoneAuthGateway(Context context){
        TokenStore tokens=new TokenStore(context.getApplicationContext());
        storage=new Storage(){public TokenStore.Session load(){return tokens.load();}public void save(TokenStore.Session value)throws Exception{tokens.save(value);}public String installationId(){return tokens.installationId();}};
        connections=url->(HttpURLConnection)url.openConnection();Handler main=new Handler(Looper.getMainLooper());callbacks=main::post;clock=()->System.nanoTime()/1_000_000L;worker.allowCoreThreadTimeOut(true);
    }
    PhoneAuthGateway(Storage storage,Connections connections,java.util.concurrent.Executor callbacks,Clock clock){this.storage=storage;this.connections=connections;this.callbacks=callbacks;this.clock=clock;worker.allowCoreThreadTimeOut(true);}

    public void status(Callback<Boolean> callback){submit(callback,ticket->{Response response=exchange("/auth/phone/status",null,null,ticket);if(response.status==404)return false;requireSuccess(response);return response.body.opt("enabled") instanceof Boolean&&response.body.optBoolean("enabled")&&"whatsapp".equals(response.body.optString("deliveryChannel"))&&Boolean.TRUE.equals(response.body.opt("nativePhoneLogin"));});}
    public void loginCode(String value,Callback<Boolean> callback){submit(callback,ticket->{
        String code=value==null?"":value.replaceAll("[^a-zA-Z0-9]","").toUpperCase(Locale.ROOT);
        if(!code.matches("[A-Z0-9]{16}"))throw invalid("16 haneli kullanıcı kodunu kontrol et.");
        TokenStore.Session before=storage.load();
        JSONObject body=metadata().put("code",code);Response response=exchange("/auth/login-by-code",body,null,ticket);requireSuccess(response);
        persist(response.body,before,ticket);return true;
    });}
    public void request(String e164,boolean register,String existingCode,Callback<String> callback){submit(callback,ticket->{
        if(e164==null||!e164.matches("\\+[1-9][0-9]{7,14}")||e164.startsWith("+900"))throw invalid("Telefon numaranı ülke koduyla kontrol et.");
        synchronized(lock){if(challenge!=null&&challenge.phone.equals(e164)&&clock.now()<challenge.resend)throw new Issue(Failure.Code.LIMIT,"Yeni kod istemeden önce bir dakika bekle.");}
        TokenStore.Session before=storage.load();String installation=storage.installationId();
        JSONObject body=metadata(installation).put("phone",e164).put("intent",register?"register":"login");
        String old=existingCode==null?"":existingCode.replaceAll("[^a-zA-Z0-9]","").toUpperCase(Locale.ROOT);
        if(!old.isEmpty()){if(!old.matches("[A-Z0-9]{16}"))throw invalid("Mevcut kullanıcı kodunu kontrol et.");body.put("existingCode",old);}
        Response response=exchange("/auth/phone/request",body,before==null?null:before.accessToken,ticket);
        try{requireSuccess(response);}catch(Issue issue){throw new Issue(issue.code,issue.text);}
        JSONObject raw=response.body;String id=raw.optString("challengeId"),proof=raw.optString("challengeSecret");
        long lifetime=integer(raw.opt("expiresInSeconds"),1,900),cooldown=integer(raw.opt("resendAfterSeconds"),0,lifetime);
        String masked=raw.optString("maskedPhone");
        if(!id.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")||!proof.matches("[A-Za-z0-9_-]{43}")||!masked.matches("[+0-9•* -]{4,40}")||!"accepted".equals(raw.optString("delivery")))throw invalid("Doğrulama yanıtı geçersiz. Tekrar dene.");
        synchronized(lock){check(ticket);long now=clock.now();challenge=new Challenge(id,proof,e164,installation,now+lifetime*1000,now+cooldown*1000,before);}
        return masked;
    });}
    public void verify(String code,Callback<Boolean> callback){submit(callback,ticket->{
        final Challenge issued;synchronized(lock){issued=challenge;}
        if(issued==null||clock.now()>=issued.expiry||code==null||!code.matches("[0-9]{6}"))throw invalid("Kodunu kontrol et veya yeni bir kod iste.");
        JSONObject body=new JSONObject().put("challengeId",issued.id).put("challengeSecret",issued.proof).put("code",code).put("installationId",issued.installation);
        Response response=exchange("/auth/phone/verify",body,null,ticket);
        try{requireSuccess(response);}catch(Issue issue){if(issue.recovery!=Recovery.NONE)synchronized(lock){if(challenge==issued)challenge=null;}throw issue;}
        persist(response.body,issued.before,ticket);synchronized(lock){check(ticket);challenge=null;}return true;
    });}
    public int remainingSeconds(){synchronized(lock){return seconds(challenge==null?0:challenge.expiry-clock.now());}}
    public int resendSeconds(){synchronized(lock){return seconds(challenge==null?0:challenge.resend-clock.now());}}
    public Recovery recoveryFor(Failure failure){synchronized(lock){return failure!=null&&failure==recoveryFailure?recovery:Recovery.NONE;}}
    private static int seconds(long value){return (int)Math.max(0,Math.min(900,(value+999)/1000));}
    private JSONObject metadata()throws Exception{return metadata(storage.installationId());}
    private JSONObject metadata(String installation)throws Exception{return new JSONObject().put("platform","android_phone").put("deviceName","Flixify Android").put("installationId",installation);}
    private static long integer(Object value,long min,long max)throws Issue{if(!(value instanceof Integer||value instanceof Long)||((Number)value).longValue()<min||((Number)value).longValue()>max)throw invalid("Doğrulama yanıtı geçersiz.");return ((Number)value).longValue();}
    private static Issue invalid(String text){return new Issue(Failure.Code.INVALID,text);}
    private static boolean same(TokenStore.Session left,TokenStore.Session right){return left==null?right==null:right!=null&&Objects.equals(left.accessToken,right.accessToken)&&Objects.equals(left.refreshToken,right.refreshToken)&&Objects.equals(left.accountId,right.accountId);}
    private void persist(JSONObject raw,TokenStore.Session before,long ticket)throws Exception{
        JSONObject user=ProviderParser.object(raw.opt("user"));
        TokenStore.Session next=new TokenStore.Session(ProviderParser.secret(raw.opt("accessToken"),16384),ProviderParser.secret(raw.opt("refreshToken"),16384),ProviderParser.secret(user.opt("id"),256),ProviderParser.text(user.opt("codeSuffix"),4));
        synchronized(lock){check(ticket);if(!same(before,storage.load()))throw new Issue(Failure.Code.STALE,"Hesap değişti. Yeniden giriş yap.");storage.save(next);}
    }
    private <T> void submit(Callback<T> callback,Work<T> work){
        final long ticket;synchronized(lock){if(closed)return;ticket=++generation;recoveryFailure=null;recovery=Recovery.NONE;if(active!=null)active.disconnect();worker.getQueue().clear();}
        try{worker.execute(()->{
            T value=null;Failure failure=null;
            try{check(ticket);value=work.run(ticket);}catch(Exception issue){failure=failure(issue);}
            final T result=value;final Failure error=failure;
            callbacks.execute(()->{synchronized(lock){if(closed||ticket!=generation)return;}if(error==null)callback.onResult(result);else callback.onError(error);});
        });}catch(RejectedExecutionException ignored){callbacks.execute(()->{synchronized(lock){if(closed||ticket!=generation)return;}callback.onError(new Failure(Failure.Code.LIMIT,"İşlem sürüyor. Biraz sonra tekrar dene."));});}
    }
    private void check(long ticket)throws Issue{synchronized(lock){if(closed||ticket!=generation||Thread.currentThread().isInterrupted())throw new Issue(Failure.Code.STALE,"İşlem iptal edildi.");}}
    private Response exchange(String path,JSONObject body,String bearer,long ticket)throws Exception{
        check(ticket);HttpURLConnection connection=connections.open(new URL(API+path));
        synchronized(lock){check(ticket);active=connection;}
        try{
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(TIMEOUT);connection.setReadTimeout(TIMEOUT);connection.setUseCaches(false);connection.setRequestMethod(body==null?"GET":"POST");
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("X-Flixify-Client-Runtime","android_phone");
            if(bearer!=null)connection.setRequestProperty("Authorization","Bearer "+bearer);
            if(body!=null){connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream output=connection.getOutputStream()){output.write(bytes);}}
            int status=connection.getResponseCode();check(ticket);
            if(status>=300&&status<400)throw new Issue(Failure.Code.NETWORK,"Giriş bağlantısı doğrulanamadı. Tekrar dene.");
            InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream();long started=clock.now();
            if(input!=null)try(InputStream stream=input){byte[] bytes=new byte[4096];int read;while((read=stream.read(bytes))!=-1){check(ticket);if(buffer.size()+read>MAX_BYTES||clock.now()-started>TIMEOUT)throw invalid("Yanıt alınamadı. Tekrar dene.");buffer.write(bytes,0,read);}}
            check(ticket);JSONObject raw;
            try{raw=new JSONObject(buffer.toString("UTF-8"));}catch(Exception invalid){if(status==200)throw invalid("Yanıt alınamadı. Tekrar dene.");raw=new JSONObject();}
            return new Response(status,raw);
        }finally{connection.disconnect();synchronized(lock){if(active==connection)active=null;}}
    }
    private static void requireSuccess(Response response)throws Issue{
        if(response.status==200)return;
        String reason=response.body.optString("reason");
        if("registration_required".equals(reason))throw new Issue(Failure.Code.INVALID,"Bu numara henüz bir hesaba bağlı değil. Hesap oluşturabilir veya mevcut hesabını bağlayabilirsin.",Recovery.REGISTRATION_REQUIRED);
        if("installation_limit".equals(reason))throw new Issue(Failure.Code.LIMIT,"Bu cihazda daha önce hesap oluşturulmuş. Mevcut hesabını bağla veya kullanıcı kodunla giriş yap.",Recovery.EXISTING_ACCOUNT);
        if("registration_ip_limit".equals(reason))throw new Issue(Failure.Code.LIMIT,"Bu internet bağlantısının iki hesaplık kayıt sınırına ulaşıldı. Mevcut hesabınla giriş yap.",Recovery.EXISTING_ACCOUNT);
        if("account_conflict".equals(reason))throw new Issue(Failure.Code.INVALID,"Bu numara başka bir hesapla eşleşiyor. Mevcut kullanıcı kodunla giriş yap veya farklı bir numara kullan.",Recovery.ACCOUNT_CONFLICT);
        if("reauthentication_required".equals(reason)||"account_unavailable".equals(reason))throw new Issue(Failure.Code.AUTH,"Mevcut hesabını kullanıcı kodunla doğrulayarak devam et.",Recovery.EXISTING_ACCOUNT);
        if("existing_account_unverified".equals(reason))throw invalid("Mevcut hesap bilgilerini kontrol et.");
        if(response.status==429)throw new Issue(Failure.Code.LIMIT,"Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.");
        if(response.status==400||response.status==401||response.status==409||response.status==422)throw invalid("Bilgilerini ve doğrulama kodunu kontrol et.");
        throw new Issue(Failure.Code.NETWORK,"Giriş şu an tamamlanamıyor. Lütfen tekrar dene.");
    }
    private Failure failure(Exception error){
        if(error instanceof Issue){Issue issue=(Issue)error;Failure result=new Failure(issue.code,issue.text);synchronized(lock){recoveryFailure=result;recovery=issue.recovery;}return result;}
        if(error instanceof TokenStore.StorageException){TokenStore.StorageException storage=(TokenStore.StorageException)error;return new Failure(Failure.Code.STORAGE,"Oturum bu cihazda kaydedilemedi. Tekrar dene.",storage.code);}
        return new Failure(Failure.Code.NETWORK,"Bağlantı tamamlanamadı. Lütfen tekrar dene.");
    }
    public void cancelPending(){synchronized(lock){generation++;challenge=null;if(active!=null){active.disconnect();active=null;}worker.getQueue().clear();}}
    @Override public void close(){synchronized(lock){if(closed)return;closed=true;generation++;challenge=null;if(active!=null){active.disconnect();active=null;}worker.getQueue().clear();}worker.shutdownNow();}
}
