package vip.flixify.tv.data;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.TvRepository;
import vip.flixify.tv.DeviceLogin;
import vip.flixify.tv.DeviceLoginQr;
import vip.flixify.tv.BackgroundWorkGate;
import vip.flixify.tv.WelcomeOffer;

/** Personal-provider-only repository. URLs and credentials never leave memory or become error text. */
public final class NetworkTvRepository implements TvRepository {
    private static final String API = "https://api.flixify.vip";
    private static final int MAX_BYTES=20*1024*1024, TIMEOUT_MS=15000;
    private final Object lock=new Object();
    private final Handler main=new Handler(Looper.getMainLooper());
    // One worker also serializes rotating refresh tokens. Concurrent callers join the same pending operation.
    private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(64),r->{Thread t=new Thread(r,"flixify-personal-data");t.setDaemon(true);return t;});
    // Optional provider-only I/O never consumes the auth/bootstrap worker or rotates API tokens.
    private final ThreadPoolExecutor epgWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16),r->{Thread t=new Thread(r,"flixify-personal-epg");t.setDaemon(true);return t;});
    private final ThreadPoolExecutor primaryCatalogWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4),r->{Thread t=new Thread(r,"flixify-catalog-primary");t.setDaemon(true);return t;});
    private final ThreadPoolExecutor metadataWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4),r->{Thread t=new Thread(r,"flixify-catalog-refresh");t.setDaemon(true);return t;});
    // This lane admits memory hits only; misses return to the authority worker.
    private final ThreadPoolExecutor cacheWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(64),r->{Thread t=new Thread(r,"flixify-cache-delivery");t.setDaemon(true);return t;});
    // Dropping optional writes under pressure must never delay a verified result.
    private final ThreadPoolExecutor persistenceWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4),r->{Thread t=new Thread(r,"flixify-metadata-persistence");t.setDaemon(true);return t;});
    private final ScheduledExecutorService timeout=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"flixify-request-deadline");t.setDaemon(true);return t;});
    interface Clock { long now(); }
    interface ConnectionFactory { HttpURLConnection open(URL url) throws Exception; }
    private final Clock clock;
    private final ConnectionFactory connectionFactory;
    private final java.util.concurrent.Executor callbacks;
    private final TokenStore tokenStore;
    private final SharedPreferences positions;
    private final SharedPreferences welcomeMemo;
    private final MetadataDiskCache metadataDisk;
    private final SourceGuard guard=new SourceGuard();
    private volatile TokenStore.Session tokens;
    private volatile Account currentAccount;
    private volatile long accountCheckedAt, bootstrapCheckedAt;
    private long authGeneration;
    private long pairingEpoch;
    private PairingAttempt pairingAttempt;
    private final ThreadPoolExecutor pairingWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16),r->{Thread t=new Thread(r,"flixify-device-login");t.setDaemon(true);return t;});
    private final Map<String,Pending<?>> pending=new HashMap<>();
    private final Set<HttpURLConnection> connections=new HashSet<>();
    private final Map<Kind,Catalog> catalogs=new EnumMap<>(Kind.class);
    private final Map<Kind,Long> catalogSavedAt=new EnumMap<>(Kind.class);
    private final Map<Kind,Long> catalogValidUntil=new EnumMap<>(Kind.class);
    private final Map<Kind,Long> catalogFetches=new EnumMap<>(Kind.class);
    private final Map<Kind,Long> foregroundCatalogFetches=new EnumMap<>(Kind.class);
    private final LinkedHashMap<String,SeriesDetail> details=new LinkedHashMap<>(16,.75f,true);
    private final Map<String,Long> detailSavedAt=new HashMap<>();
    private final Map<String,Long> detailValidUntil=new HashMap<>();
    private final Map<String,Long> detailFetches=new HashMap<>();
    private final Map<String,Long> foregroundDetailFetches=new HashMap<>();
    private final Set<String> metadataRefreshes=new HashSet<>();
    private final Set<CatalogObserver> catalogObservers=new HashSet<>();
    private final Set<String> favoriteRefs=new HashSet<>(), watchedRefs=new HashSet<>();
    private String libraryScope="";
    private long librarySavedAt,libraryValidUntil,libraryEpoch;
    private List<Item> favoriteItems=Collections.emptyList();
    private Map<String,Item> resolvedFavorites=Collections.emptyMap();
    private Set<String> favoriteMembership=Collections.emptySet();
    private final Map<Kind,Map<String,Item>> catalogIndexes=new EnumMap<>(Kind.class);
    private static final long LIBRARY_FRESH_MS=60000;
    private volatile long optionalWorkPausedUntil;
    private long memoryEpoch;

    private Catalog curatedInput;
    private String curatedRevision="";
    private LiveChannelCuration.Projection curatedLive;
    private MetadataDiskCache.Snapshot<Catalog> liveRawSnapshot;
    private volatile PolicyIdentity verifiedLivePolicy=new PolicyIdentity(null);
    private static final class PolicyIdentity {
        final ProviderParser.LivePolicy policy;final String key;
        PolicyIdentity(ProviderParser.LivePolicy policy){
            this.policy=policy;if(policy==null){key="";return;}
            try{
                StringBuilder values=new StringBuilder();for(String id:new java.util.TreeSet<>(policy.excludedIds))values.append(id).append('\0');
                byte[] hash=MessageDigest.getInstance("SHA-256").digest(values.toString().getBytes(StandardCharsets.UTF_8));StringBuilder digest=new StringBuilder(64);
                for(byte value:hash){digest.append(Character.forDigit((value&255)>>>4,16));digest.append(Character.forDigit(value&15,16));}
                key=policy.revision+":"+digest;
            }catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
        }
    }
    private static final class MemoryProjectionMiss extends RuntimeException {}
    private Runnable refreshTimer, expiryTimer;

    public NetworkTvRepository(Context context) { this(context,null,null,null); }
    NetworkTvRepository(Context context,ConnectionFactory connectionFactory,Clock clock,java.util.concurrent.Executor callbacks) {
        this.connectionFactory=connectionFactory==null?url->(HttpURLConnection)url.openConnection():connectionFactory;
        this.clock=clock==null?System::currentTimeMillis:clock;
        this.callbacks=callbacks==null?main::post:callbacks;
        Context app=context.getApplicationContext(); tokenStore=new TokenStore(app);
        positions=app.getSharedPreferences("tv_scoped_resume",Context.MODE_PRIVATE);
        welcomeMemo=app.getSharedPreferences("tv_welcome_resolved_v1",Context.MODE_PRIVATE);
        metadataDisk=new MetadataDiskCache(new java.io.File(app.getFilesDir(),"catalog-cache-v1"));
        tokens=tokenStore.load();pairingWorker.allowCoreThreadTimeOut(true); worker.allowCoreThreadTimeOut(true);epgWorker.allowCoreThreadTimeOut(true);primaryCatalogWorker.allowCoreThreadTimeOut(true);metadataWorker.allowCoreThreadTimeOut(true);cacheWorker.allowCoreThreadTimeOut(true);persistenceWorker.allowCoreThreadTimeOut(true);
    }
    @Override public boolean hasSession() { return tokens!=null; }
    @Override public String currentAccountId(){TokenStore.Session value=tokens;return value==null?"":value.accountId;}
    private String welcomeKey(long auth)throws Exception{
        TokenStore.Session value=requireTokens(auth);String account=value.accountId;
        if(account.isEmpty())account=loadAccount(auth,false).id;
        if(account.isEmpty())throw new ProviderParser.Invalid();
        byte[] bytes=MessageDigest.getInstance("SHA-256").digest(account.getBytes(StandardCharsets.UTF_8));StringBuilder key=new StringBuilder(64);
        for(byte b:bytes)key.append(String.format(Locale.ROOT,"%02x",b&255));return key.toString();
    }
    private WelcomeOffer rememberWelcome(long auth,String key,WelcomeOffer value)throws Exception{
        synchronized(lock){checkAuth(auth);if(!value.showPrompt())welcomeMemo.edit().putString(key,value.state).apply();}
        return value;
    }
    @Override public void welcomeOffer(Callback<WelcomeOffer> callback){
        enqueue("welcome-offer",false,callback,auth->{
            String key=welcomeKey(auth);String state=welcomeMemo.getString(key,"");checkAuth(auth);
            if("not_eligible".equals(state) || "dismissed".equals(state) || "redeemed".equals(state))return new WelcomeOffer(state,"dismissed".equals(state),0,0,0);
            WelcomeOffer value=WelcomeOfferParser.parse(ProviderParser.object(api("/me/welcome-offer","GET",null,auth)));
            return rememberWelcome(auth,key,value);
        });
    }
    @Override public void chooseWelcomeOffer(String choice,Callback<WelcomeOffer> callback){
        if(!"trial".equals(choice) && !"monthly".equals(choice)){callbacks.execute(()->callback.onError(failure(new ProviderParser.Invalid())));return;}
        enqueue("welcome-choice-"+choice,false,callback,auth->{
            String key=welcomeKey(auth);WelcomeOffer value=WelcomeOfferParser.parse(ProviderParser.object(api("/me/welcome-offer/choice","POST",new JSONObject().put("choice",choice),auth)));
            if(value.showPrompt())throw new ProviderParser.Invalid();return rememberWelcome(auth,key,value);
        });
    }
    @Override public String currentScope() {
        ProviderParser.Bootstrap b=guard.current(); return b!=null && b.expiresAtMs>clock.now()?b.scope():"";
    }
    private static final class Problem extends Exception {
        final Failure.Code code;
        Problem(Failure.Code code) { super("Personal operation unavailable");this.code=code; }
    }
    private static Failure failure(Exception error) {
        Failure.Code code=error instanceof Problem?((Problem)error).code:error instanceof ProviderParser.Invalid?Failure.Code.INVALID:Failure.Code.NETWORK;
        String message;
        switch(code) {
            case AUTH: message="Oturumun yenilenemedi. Kodunla tekrar giriş yap."; break;
            case INELIGIBLE: message="İzleme erişimin şu anda açık değil."; break;
            case STALE: message="Hesap veya içerik kaynağı değişti. İçeriği yeniden aç."; break;
            case LIMIT: message="İşlem sınırına ulaşıldı. Biraz sonra tekrar dene."; break;
            case INVALID: message="Kişisel içerik bilgisi doğrulanamadı."; break;
            default: message="Bağlantı kurulamadı. Tekrar deneyebilirsin.";
        }
        return new Failure(code,message);
    }
    private interface Work<T> { T run(long auth) throws Exception; }
    private static final class CatalogDemand {
        volatile boolean foreground;
        CatalogDemand(boolean foreground){this.foreground=foreground;}
    }
    private static final class Pending<T> {
        final long auth; final String scope; final boolean sourceBound; final List<Callback<T>> callbacks=new ArrayList<>();
        CatalogDemand catalogDemand;long preparedSource=-1;String preparedScope;
        FutureTask<Void> catalogTask;ThreadPoolExecutor catalogExecutor;Runnable catalogRejected;
        Pending(long auth,String scope,boolean sourceBound) {this.auth=auth;this.scope=scope;this.sourceBound=sourceBound;}
    }
    private static final class Prepared<T> {
        final Work<T> work; final long source; final String scope; final java.util.concurrent.Executor background;
        Prepared(Work<T> work,long source,String scope) {this(work,source,scope,null);}
        Prepared(Work<T> work,long source,String scope,java.util.concurrent.Executor background) {this.work=work;this.source=source;this.scope=scope;this.background=background;}
    }
    private interface Preparation<T> { Prepared<T> run(long auth) throws Exception; }
    private <T> void enqueue(String name,boolean sourceBound,Callback<T> callback,Work<T> work) {
        enqueuePrepared(name,sourceBound,callback,auth->new Prepared<>(work,-1,null),false);
    }
    private <T> void enqueuePrepared(String name,boolean sourceBound,Callback<T> callback,Preparation<T> preparation,boolean optional) {
        enqueuePrepared(name,sourceBound,callback,preparation,optional,null);
    }
    private <T> void enqueuePrepared(String name,boolean sourceBound,Callback<T> callback,Preparation<T> preparation,boolean optional,CatalogDemand demand) {
        enqueuePrepared(name,sourceBound,callback,preparation,optional,demand,null);
    }
    private <T> void enqueuePrepared(String name,boolean sourceBound,Callback<T> callback,Preparation<T> preparation,boolean optional,CatalogDemand demand,Preparation<T> fastPreparation) {
        final Pending<T> operation; final String key;
        synchronized(lock) {
            String scope=currentScope();String selected=name+"@"+authGeneration+"@"+scope;
            // The first catalog may have been enqueued before bootstrap established its scope.
            if(demand!=null && !scope.isEmpty() && !pending.containsKey(selected)){
                String initial=name+"@"+authGeneration+"@";Pending<?> candidate=pending.get(initial);
                if(candidate!=null && scope.equals(candidate.preparedScope) && guard.active(candidate.preparedSource,scope,clock.now()))selected=initial;
            }
            key=selected;
            @SuppressWarnings("unchecked") Pending<T> existing=(Pending<T>)pending.get(key);
            if(demand!=null && existing!=null && existing.preparedScope!=null && !guard.active(existing.preparedSource,existing.preparedScope,clock.now()))existing=null;
            if(existing!=null) {
                if(demand!=null && demand.foreground && existing.catalogDemand!=null)existing.catalogDemand.foreground=true;
                if(callback!=null) { if(existing.callbacks.size()>=64) { callbacks.execute(()->callback.onError(failure(new Problem(Failure.Code.LIMIT))));return; } existing.callbacks.add(callback); }
                if(demand!=null && demand.foreground)promoteCatalog(existing);return;
            }
            operation=new Pending<>(authGeneration,scope,sourceBound);operation.catalogDemand=demand; if(callback!=null) operation.callbacks.add(callback); pending.put(key,operation);
        }
        Runnable authority=()->prepareOperation(key,operation,preparation,optional);
        try {
            if(fastPreparation==null)worker.execute(authority);
            else cacheWorker.execute(()->{
                try {
                    checkAuth(operation.auth);Prepared<T> cached=fastPreparation.run(operation.auth);checkAuth(operation.auth);
                    if(cached==null)worker.execute(authority);else dispatchPrepared(key,operation,cached,optional,true);
                }catch(RejectedExecutionException rejected){complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),-1,null);}
                catch(Exception error){complete(key,operation,null,failure(error),-1,null);}
            });
        } catch(RejectedExecutionException ignored) {
            // Cache delivery is optional; saturation still admits the existing authority path.
            try{worker.execute(authority);}catch(RejectedExecutionException rejected){complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),-1,null);}
        }
    }
    private <T> void prepareOperation(String key,Pending<T> operation,Preparation<T> preparation,boolean optional){
        try{
            checkAuth(operation.auth);Prepared<T> prepared=preparation.run(operation.auth);checkAuth(operation.auth);
            dispatchPrepared(key,operation,prepared,optional);
        }catch(RejectedExecutionException rejected){complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),-1,null);}
        catch(Exception error){complete(key,operation,null,failure(error),-1,null);}
    }
    private <T> void dispatchPrepared(String key,Pending<T> operation,Prepared<T> prepared,boolean optional){dispatchPrepared(key,operation,prepared,optional,false);}
    private <T> void dispatchPrepared(String key,Pending<T> operation,Prepared<T> prepared,boolean optional,boolean memoryOnly){
        synchronized(lock){operation.preparedSource=prepared.source;operation.preparedScope=prepared.scope;}
        Runnable request=()->runPrepared(key,operation,prepared,memoryOnly);
        if(prepared.background==primaryCatalogWorker && operation.catalogDemand!=null){
            synchronized(lock){
                operation.catalogTask=new FutureTask<>(request,null);
                operation.catalogRejected=()->complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),prepared.source,prepared.scope);
                operation.catalogExecutor=operation.catalogDemand.foreground?primaryCatalogWorker:metadataWorker;
                operation.catalogExecutor.execute(operation.catalogTask);
            }
        }else if(prepared.background!=null)prepared.background.execute(request);else if(optional)epgWorker.execute(request);else request.run();
    }
    private void promoteCatalog(Pending<?> operation){
        if(operation.catalogTask==null || operation.catalogExecutor!=metadataWorker || !metadataWorker.remove(operation.catalogTask))return;
        try{primaryCatalogWorker.execute(operation.catalogTask);operation.catalogExecutor=primaryCatalogWorker;}
        catch(RejectedExecutionException full){
            try{metadataWorker.execute(operation.catalogTask);}
            catch(RejectedExecutionException unavailable){operation.catalogTask.cancel(false);operation.catalogRejected.run();}
        }
    }
    private ProviderParser.Bootstrap freshMemoryBootstrap(long auth)throws Problem{
        requireTokens(auth);ProviderParser.Bootstrap b=guard.current();long now=clock.now();
        if(b==null || !guard.active(guard.generation(),b.scope(),now) || now<bootstrapCheckedAt || now-bootstrapCheckedAt>=60000)return null;
        TokenStore.Session session=requireTokens(auth);
        return session.accountId.isEmpty() || session.accountId.equals(b.accountId)?b:null;
    }
    private Prepared<Catalog> memoryCatalog(long auth,Kind kind)throws Exception{
        synchronized(lock){
            ProviderParser.Bootstrap b=freshMemoryBootstrap(auth);if(b==null || !cacheAgeValid(catalogSavedAt.get(kind),catalogValidUntil.get(kind)))return null;
            Catalog value=catalogs.get(kind);if(value==null || kind==Kind.LIVE && !hasLiveProjection(value))return null;long source=guard.generation();
            return new Prepared<>(cachedAuth->{active(cachedAuth,source,b.scope());return value;},source,b.scope());
        }
    }
    private Prepared<List<Item>> memoryFavorites(long auth)throws Exception{
        synchronized(lock){
            ProviderParser.Bootstrap b=freshMemoryBootstrap(auth);if(b==null || !b.scope().equals(libraryScope) || !cacheAgeValid(librarySavedAt,libraryValidUntil))return null;
            for(String reference:favoriteRefs){
                if(resolvedFavorites.containsKey(reference))continue;
                if(reference.startsWith("LIVE::") && b.livePolicy!=null && b.livePolicy.excludedIds.contains(reference.substring(6)))continue;
                return null;
            }
            Catalog live=catalogs.get(Kind.LIVE);if(live!=null && !hasLiveProjection(live))return null;
            List<Item> value=favoriteItems;long source=guard.generation();
            return new Prepared<>(cachedAuth->{active(cachedAuth,source,b.scope());return value;},source,b.scope());
        }
    }
    private void persistMetadata(Runnable write){try{persistenceWorker.execute(write);}catch(RejectedExecutionException ignored){}}
    private boolean persistenceLease(long auth,long source,String scope,long epoch){
        synchronized(lock){return auth==authGeneration && memoryEpoch==epoch && guard.active(source,scope,clock.now()) && optionalWorkAllowed();}
    }
    private <T> void runPrepared(String key,Pending<T> operation,Prepared<T> prepared,boolean memoryOnly) {
        T value=null;Failure issue=null;
        try {checkAuth(operation.auth);value=prepared.work.run(operation.auth);checkAuth(operation.auth);}
        catch(Exception error) {issue=failure(error);}
        complete(key,operation,value,issue,prepared.source,prepared.scope,memoryOnly);
    }
    private <T> void complete(String key,Pending<T> operation,T value,Failure issue,long preparedSource,String preparedScope) {complete(key,operation,value,issue,preparedSource,preparedScope,false);}
    private <T> void complete(String key,Pending<T> operation,T value,Failure issue,long preparedSource,String preparedScope,boolean memoryOnly) {
        final String completedScope;final long completedSource;
        synchronized(lock) {
            completedScope=preparedScope==null?currentScope():preparedScope;
            completedSource=preparedScope==null?guard.generation():preparedSource;
        }
        final boolean favorites=key.startsWith("favorites@");
        final boolean policyBound=value instanceof Catalog && ((Catalog)value).kind==Kind.LIVE || favorites && value instanceof List;
        T projection=value;String revision=currentPolicyRevision();long favoriteEpoch;synchronized(lock){favoriteEpoch=libraryEpoch;}Failure preparedIssue=issue;
        if(issue==null && policyBound) {
            try {
                for(int attempt=0;attempt<3;attempt++){
                    revision=currentPolicyRevision();synchronized(lock){favoriteEpoch=libraryEpoch;}projection=policyResult(value,favorites,memoryOnly);
                    boolean unchanged;synchronized(lock){unchanged=!favorites || favoriteEpoch==libraryEpoch;}
                    if(unchanged && revision.equals(currentPolicyRevision()))break;
                    if(attempt==2)throw new IllegalStateException();
                }
            }catch(MemoryProjectionMiss retry){
                try{worker.execute(()->complete(key,operation,value,issue,preparedSource,preparedScope));}
                catch(RejectedExecutionException rejected){complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),preparedSource,preparedScope);}return;
            }catch(RuntimeException ignored){preparedIssue=failure(new Problem(Failure.Code.STALE));}
        }
        final T published=projection;final String publishedPolicy=revision;final long publishedLibraryEpoch=favoriteEpoch;final Failure finalIssue=preparedIssue;
        callbacks.execute(()->{
            boolean changed;synchronized(lock){changed=!publishedPolicy.equals(currentPolicyRevision()) || favorites && publishedLibraryEpoch!=libraryEpoch;}
            if(finalIssue==null && policyBound && changed){
                boolean current;synchronized(lock){current=operation.auth==authGeneration && guard.active(completedSource,completedScope,clock.now());}
                if(current){try{worker.execute(()->complete(key,operation,value,null,completedSource,completedScope));}catch(RejectedExecutionException ignored){complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),completedSource,completedScope);}return;}
            }
            List<Callback<T>> deliveries;
            synchronized(lock) {if(pending.get(key)==operation)pending.remove(key);deliveries=new ArrayList<>(operation.callbacks);}
            for(Callback<T> cb:deliveries) {
                Failure delivered=finalIssue;
                synchronized(lock) {
                    boolean playableAccount=published instanceof Account && ((Account)published).canPlay;
                    boolean needsLease=operation.sourceBound || playableAccount;
                    boolean wrongInitialSource=operation.sourceBound && !operation.scope.isEmpty() && !operation.scope.equals(currentScope());
                    boolean wrongPreparedSource=preparedScope!=null && (completedSource!=guard.generation() || !completedScope.equals(currentScope()));
                    boolean inactiveResult=finalIssue==null && needsLease && (!guard.active(completedSource,completedScope,clock.now()) || (playableAccount && ((Account)published).expiresAtMs<=clock.now()));
                    if(operation.auth!=authGeneration || wrongInitialSource || wrongPreparedSource || inactiveResult)delivered=failure(new Problem(Failure.Code.STALE));
                }
                if(delivered==null && published instanceof Playback && ProviderParser.liveExcluded(((Playback)published).item,guard.current()))delivered=failure(new Problem(Failure.Code.INVALID));
                if(delivered==null)cb.onResult(published);else cb.onError(delivered);
            }
        });
    }
    private String currentPolicyRevision(){return verifiedLivePolicy.key;}
    private boolean hasLiveProjection(Catalog raw){return curatedInput==raw && curatedLive!=null && curatedRevision.equals(currentPolicyRevision());}
    private LiveChannelCuration.Projection liveProjection(Catalog raw){return liveProjection(raw,false);}
    private LiveChannelCuration.Projection liveProjection(Catalog raw,boolean memoryOnly) {
        for(int attempt=0;attempt<3;attempt++){
            final String revision;final Set<String> excluded;
            synchronized(lock){revision=currentPolicyRevision();if(hasLiveProjection(raw))return curatedLive;if(memoryOnly)throw new MemoryProjectionMiss();ProviderParser.Bootstrap b=guard.current();excluded=b==null || b.livePolicy==null?Collections.emptySet():b.livePolicy.excludedIds;}
            LiveChannelCuration.Projection projected=LiveChannelCuration.curate(raw,excluded);boolean current=false,remember=false;
            synchronized(lock){if(revision.equals(currentPolicyRevision())){current=true;remember=catalogs.get(Kind.LIVE)==raw;if(remember){curatedInput=raw;curatedRevision=revision;curatedLive=projected;}}}
            if(current){if(remember)persistReadyLive(raw,projected,revision);return projected;}
        }
        throw new IllegalStateException("Live projection changed");
    }
    private void persistReadyLive(Catalog raw,LiveChannelCuration.Projection projection,String policy){
        final long auth,source,memory;final Long ticket;final ProviderParser.Bootstrap b;
        synchronized(lock){
            b=guard.current();if(b==null || catalogs.get(Kind.LIVE)!=raw || !policy.equals(currentPolicyRevision()) || !optionalWorkAllowed())return;
            auth=authGeneration;source=guard.generation();memory=memoryEpoch;ticket=catalogFetches.get(Kind.LIVE);
        }
        persistMetadata(()->{
            final MetadataDiskCache.Snapshot<Catalog> snapshot;final long effectiveUntil;
            synchronized(lock){
                snapshot=liveRawSnapshot;ProviderParser.Bootstrap current=guard.current();
                if(snapshot==null || snapshot.value!=raw || current==null)return;
                effectiveUntil=Math.min(snapshot.expiresAt,Math.min(b.expiresAtMs,current.expiresAtMs));
            }
            MetadataDiskCache.Valid valid=()->{synchronized(lock){ProviderParser.Bootstrap current=guard.current();return current!=null && current.expiresAtMs>=effectiveUntil
                && snapshot==liveRawSnapshot && snapshot.value==catalogs.get(Kind.LIVE)
                && curatedInput==raw && curatedLive==projection && policy.equals(currentPolicyRevision()) && java.util.Objects.equals(ticket,catalogFetches.get(Kind.LIVE))
                && persistenceLease(auth,source,b.scope(),memory);}};
            if(valid.get())metadataDisk.writeReadyLive(b.scope(),effectiveUntil,clock.now(),snapshot,policy,projection,valid);
        });
    }
    private Catalog currentLiveCatalog(Catalog value) {return value.kind==Kind.LIVE?liveProjection(value).catalog:value;}
    private Item resolveLiveItem(Catalog fallback,String id) {Catalog raw;synchronized(lock){raw=catalogs.get(Kind.LIVE);}return liveProjection(raw==null?fallback:raw).resolve(id);}
    private List<Item> savedLiveAliases(Item item) {
        List<Item> result=new ArrayList<>();Catalog raw;Set<String> saved;
        synchronized(lock){raw=catalogs.get(Kind.LIVE);saved=new HashSet<>(favoriteRefs);}if(raw==null)return result;
        LiveChannelCuration.Projection projection=liveProjection(raw);Item selected=projection.resolve(item.id);
        if(selected!=null)for(String id:projection.aliases(selected.id)){Item original=projection.original(id);if(original!=null && saved.contains(refKey(original)))result.add(original);}
        return result;
    }
    private void rebuildFavorites(){rebuildFavorites(false);}
    private void rebuildFavorites(boolean memoryOnly){
        final Set<String> refs;final Map<String,Item> prior;final Map<Kind,Map<String,Item>> indexes;final Map<Kind,Catalog> snapshots;final Catalog live;final String scope,revision;final long epoch;final Set<String> excluded;
        synchronized(lock){refs=new HashSet<>(favoriteRefs);prior=resolvedFavorites;indexes=new EnumMap<>(catalogIndexes);snapshots=new EnumMap<>(catalogs);live=catalogs.get(Kind.LIVE);scope=libraryScope;epoch=libraryEpoch;revision=currentPolicyRevision();ProviderParser.Bootstrap b=guard.current();excluded=b==null || b.livePolicy==null?Collections.emptySet():b.livePolicy.excludedIds;}
        LiveChannelCuration.Projection projection=live==null?null:liveProjection(live,memoryOnly);Map<String,Item> resolved=new LinkedHashMap<>(),unique=new LinkedHashMap<>();Set<String> membership=new HashSet<>();
        for(String ref:refs){
            String[] parts=ref.split(":",-1);if(parts.length!=3)continue;Kind kind;try{kind=Kind.valueOf(parts[0]);}catch(IllegalArgumentException ignored){continue;}
            if(kind==Kind.LIVE && excluded.contains(parts[2]))continue;
            Map<String,Item> index=indexes.get(kind);Item item=kind==Kind.LIVE && projection!=null?projection.resolve(parts[2]):index==null?prior.get(ref):index.get(parts[2]);
            if(item==null || !scope.equals(item.scope) || kind!=item.kind || kind==Kind.EPISODE || kind==Kind.LIVE && excluded.contains(item.id))continue;
            resolved.put(ref,item);unique.put(refKey(item),item);membership.add(refKey(item));membership.add(ref);
        }
        synchronized(lock){if(epoch==libraryEpoch && scope.equals(libraryScope) && revision.equals(currentPolicyRevision()) && snapshots.equals(catalogs)){resolvedFavorites=Collections.unmodifiableMap(resolved);favoriteItems=Collections.unmodifiableList(new ArrayList<>(unique.values()));favoriteMembership=Collections.unmodifiableSet(membership);}}
    }
    @SuppressWarnings("unchecked") private <T> T policyResult(T value,boolean favorites,boolean memoryOnly) {
        if(value instanceof Catalog){Catalog catalog=(Catalog)value;return (T)(catalog.kind==Kind.LIVE?liveProjection(catalog,memoryOnly).catalog:catalog);}
        if(favorites && value instanceof List){rebuildFavorites(memoryOnly);synchronized(lock){return (T)favoriteItems;}}
        return value;
    }
    private void checkAuth(long auth) throws Problem { synchronized(lock) { if(auth!=authGeneration) throw new Problem(Failure.Code.STALE); } }
    private TokenStore.Session requireTokens(long auth) throws Problem {
        checkAuth(auth); TokenStore.Session t=tokens; if(t==null) throw new Problem(Failure.Code.AUTH); return t;
    }
    private void active(long auth,long source,String scope) throws Problem {
        checkAuth(auth);
        if(!guard.active(source,scope,clock.now())) {
            ProviderParser.Bootstrap b=guard.current();
            throw new Problem(b!=null && b.scope().equals(scope) && b.expiresAtMs<=clock.now()?Failure.Code.INELIGIBLE:Failure.Code.STALE);
        }
    }
    @Override public void login(String code,Callback<Account> callback) {
        String normalized=code==null?"":code.trim().toUpperCase(Locale.ROOT);
        if(!normalized.matches("[A-Z0-9]{16}")) {callbacks.execute(()->callback.onError(failure(new ProviderParser.Invalid())));return;}
        // A login attempt supersedes work from the previous account immediately.
        clearSession();
        enqueue("login",false,callback,auth->{
            JSONObject body=new JSONObject().put("code",normalized).put("deviceName","Flixify Android TV").put("platform","android-tv").put("installationId",tokenStore.installationId());
            JSONObject response=ProviderParser.object(request(API+"/auth/login-by-code","POST",body,null,auth,-1,null));
            installTokens(response,auth,null); return loadAccount(auth,true);
        });
    }
    @Override public void startDeviceLogin(Callback<DeviceLogin.Attempt> callback){
        final PairingAttempt next,previous;
        synchronized(lock){
            if(tokens!=null){callbacks.execute(()->callback.onError(failure(new Problem(Failure.Code.STALE))));return;}
            previous=pairingAttempt;next=new PairingAttempt(authGeneration,++pairingEpoch);pairingAttempt=next;
        }
        if(previous!=null)previous.cancel();
        next.submit(callback,()->{
            JSONObject input=new JSONObject().put("platform","android_tv").put("deviceName","Flixify Android TV").put("installationId",tokenStore.installationId());
            JSONObject raw=next.exchange("start",input,false);
            String id=ProviderParser.secret(raw.opt("requestId"),64),proof=ProviderParser.secret(raw.opt("deviceSecret"),64);
            if(!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}") || !proof.matches("[A-Za-z0-9_-]{43}"))throw new ProviderParser.Invalid();
            synchronized(lock){
                if(next.cancelled || next.auth!=authGeneration || next.epoch!=pairingEpoch){next.cleanup(new JSONObject().put("requestId",id).put("deviceSecret",proof));throw new Problem(Failure.Code.STALE);}
                next.requestId=id;next.secret=proof;
            }
            String code=ProviderParser.text(raw.opt("userCode"),9),png=ProviderParser.secret(raw.opt("qrPngBase64"),350000);
            if(!code.matches("[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}") || !"https://flixify.vip/cihaz".equals(raw.optString("verificationUri")) || !("https://flixify.vip/cihaz?code="+code).equals(raw.optString("verificationUriComplete")) || raw.optInt("expiresInSeconds")!=180 || raw.optInt("intervalSeconds")<2 || raw.optInt("intervalSeconds")>60 || ProviderParser.date(raw.opt("expiresAt"))<=0)throw new ProviderParser.Invalid();
            android.graphics.Bitmap image=DeviceLoginQr.decode(png);if(image==null)throw new ProviderParser.Invalid();image.recycle();
            synchronized(lock){next.checkCurrent();next.presentation=new DeviceLogin.Display(code,png,180,raw.getInt("intervalSeconds"));}
            return next;
        });
    }
    private interface PairingWork<T>{T run()throws Exception;}
    private final class PairingAttempt implements DeviceLogin.Attempt {
        final long auth,epoch;String requestId="",secret="";DeviceLogin.Display presentation;TokenStore.Session issued;
        boolean cancelled,adopted,polling;HttpURLConnection connection;
        PairingAttempt(long auth,long epoch){this.auth=auth;this.epoch=epoch;}
        void checkCurrent()throws Problem{if(cancelled || adopted || auth!=authGeneration || epoch!=pairingEpoch || pairingAttempt!=this || tokens!=null)throw new Problem(Failure.Code.STALE);}
        @Override public DeviceLogin.Display display(){return presentation;}
        <T> void submit(Callback<T> callback,PairingWork<T> work){
            try{pairingWorker.execute(()->{
                T value=null;Failure error=null;
                try{value=work.run();}catch(Exception issue){error=failure(issue);}
                final T result=value;final Failure problem=error;
                callbacks.execute(()->{
                    if(problem!=null){if(presentation==null)cancel();callback.onError(problem);return;}
                    synchronized(lock){try{if(auth!=authGeneration)throw new Problem(Failure.Code.STALE);if(!adopted)checkCurrent();}catch(Problem stale){cancel();callback.onError(failure(stale));return;}}
                    callback.onResult(result);
                });
            });}catch(RejectedExecutionException unavailable){callback.onError(failure(new Problem(Failure.Code.LIMIT)));}
        }
        JSONObject proof()throws Exception{synchronized(lock){if(requestId.isEmpty() || secret.isEmpty())throw new Problem(Failure.Code.STALE);return new JSONObject().put("requestId",requestId).put("deviceSecret",secret);}}
        @Override public void poll(Callback<DeviceLogin.Poll> callback){
            synchronized(lock){try{checkCurrent();if(polling)throw new Problem(Failure.Code.LIMIT);polling=true;}catch(Problem issue){callbacks.execute(()->callback.onError(failure(issue)));return;}}
            submit(new Callback<DeviceLogin.Poll>(){public void onResult(DeviceLogin.Poll value){synchronized(lock){polling=false;}callback.onResult(value);}public void onError(Failure failure){synchronized(lock){polling=false;}callback.onError(failure);}},()->{
                    JSONObject raw=exchange("token",proof(),false);String status=raw.optString("status");
                    if(!status.matches("pending|authorized|slow_down|denied|cancelled|expired|complete"))throw new ProviderParser.Invalid();
                    int interval=raw.has("intervalSeconds")?raw.getInt("intervalSeconds"):2;if(interval<2 || interval>240)throw new ProviderParser.Invalid();
                    synchronized(lock){checkCurrent();issued="authorized".equals(status)?parsePairingSession(ProviderParser.object(raw.opt("session"))):null;}
                    return new DeviceLogin.Poll(status,interval);
            });
        }
        @Override public void adopt(DeviceLogin.AdoptionGuard allowed,Callback<Void> callback){submit(callback,()->{
            synchronized(lock){
                checkCurrent();if(issued==null || !allowed.allowed())throw new Problem(Failure.Code.STALE);
                tokenStore.save(issued);tokens=issued;issued=null;adopted=true;
            }return null;
        });}
        @Override public void ack(Callback<Void> callback){submit(callback,()->{
            synchronized(lock){if(!adopted || cancelled || auth!=authGeneration)throw new Problem(Failure.Code.STALE);if(secret.isEmpty())return null;}
            JSONObject raw=exchange("ack",proof(),true);if(!"complete".equals(raw.optString("status")))throw new ProviderParser.Invalid();
            synchronized(lock){secret="";requestId="";}return null;
        });}
        @Override public void cancel(){
            final HttpURLConnection running;final JSONObject input;
            synchronized(lock){
                if(adopted || cancelled)return;cancelled=true;issued=null;running=connection;
                if(pairingAttempt==this){pairingAttempt=null;pairingEpoch++;}
                JSONObject body=null;try{if(!secret.isEmpty())body=proof();}catch(Exception ignored){}input=body;secret="";requestId="";
            }
            if(running!=null)running.disconnect();if(input!=null)cleanup(input);
        }
        void cleanup(JSONObject input){try{pairingWorker.execute(()->{try{exchange("cancel",input,true);}catch(Exception ignored){}});}catch(RejectedExecutionException ignored){}}
        JSONObject exchange(String operation,JSONObject body,boolean detached)throws Exception{
            HttpURLConnection current=null;ScheduledFuture<?> deadline=null;
            try{
                if(!detached)synchronized(lock){checkCurrent();}
                current=connectionFactory.open(new URL(API+"/auth/device/"+operation));current.setInstanceFollowRedirects(false);current.setConnectTimeout(TIMEOUT_MS);current.setReadTimeout(TIMEOUT_MS);current.setUseCaches(false);current.setRequestMethod("POST");current.setDoOutput(true);
                current.setRequestProperty("Content-Type","application/json; charset=utf-8");current.setRequestProperty("Accept","application/json");current.setRequestProperty("Cache-Control","no-store");current.setRequestProperty("Referer","");current.setRequestProperty("Cookie","");
                if(!detached)synchronized(lock){checkCurrent();connection=current;}
                HttpURLConnection bounded=current;deadline=timeout.schedule(bounded::disconnect,TIMEOUT_MS,TimeUnit.MILLISECONDS);
                byte[] encoded=body.toString().getBytes(StandardCharsets.UTF_8);current.setFixedLengthStreamingMode(encoded.length);try(OutputStream output=current.getOutputStream()){output.write(encoded);}
                int status=current.getResponseCode();if(status==429)throw new Problem(Failure.Code.LIMIT);if(status==404 || status==400)throw new ProviderParser.Invalid();if(status<200 || status>=300)throw new Problem(Failure.Code.NETWORK);
                String contentLength=current.getHeaderField("Content-Length");if(contentLength!=null && Long.parseLong(contentLength)>400000)throw new ProviderParser.Invalid();
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();long started=System.nanoTime();
                try(InputStream input=current.getInputStream()){
                    byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>400000 || TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)>TIMEOUT_MS)throw new ProviderParser.Invalid();bytes.write(buffer,0,count);}
                }
                return ProviderParser.object(ProviderParser.parseJson(new String(bytes.toByteArray(),StandardCharsets.UTF_8)));
            }finally{if(deadline!=null)deadline.cancel(false);if(current!=null){synchronized(lock){if(connection==current)connection=null;}current.disconnect();}}
        }
    }
    private TokenStore.Session parsePairingSession(JSONObject raw)throws Exception{
        String access=ProviderParser.secret(raw.opt("accessToken"),16384),refresh=ProviderParser.secret(raw.opt("refreshToken"),16384);JSONObject user=ProviderParser.object(raw.opt("user"));
        String id=ProviderParser.secret(user.opt("id"),256),suffix=ProviderParser.text(user.opt("codeSuffix"),4);
        if(access.isEmpty() || refresh.isEmpty() || id.isEmpty() || suffix.length()!=4)throw new ProviderParser.Invalid();return new TokenStore.Session(access,refresh,id,suffix);
    }
    @Override public void account(boolean force,Callback<Account> callback) {
        enqueue(force?"access-refresh":"account",false,callback,auth->loadAccount(auth,force));
    }
    @Override public void packages(Callback<java.util.List<vip.flixify.tv.PackagePlan>> callback){
        enqueue("public-packages",false,callback,auth->PackageCatalogParser.parse(ProviderParser.object(request(API+"/admin/packages/public","GET",null,null,auth,-1,null))));
    }
    @Override public void refreshAccess(Callback<Account> callback) { account(true,callback); }
    private Account loadAccount(long auth,boolean force) throws Exception {
        requireTokens(auth); long now=clock.now(); Account cached=currentAccount;
        if(!force && cached!=null && now-accountCheckedAt<60000 && (!cached.canPlay || cached.expiresAtMs>now)) return cached;
        JSONObject response=ProviderParser.object(api("/me","GET",null,auth));
        JSONObject user=ProviderParser.object(response.opt("user"));
        String id=ProviderParser.secret(user.opt("id"),256); TokenStore.Session t=requireTokens(auth);
        if(!t.accountId.isEmpty() && !t.accountId.equals(id)) { clearProvider();throw new Problem(Failure.Code.STALE); }
        if(!(user.opt("hasAssignedLink") instanceof Boolean) || !(user.opt("hasActiveSubscription") instanceof Boolean)) throw new ProviderParser.Invalid();
        JSONObject pkg=user.optJSONObject("activePackage"); String title=pkg==null?"":ProviderParser.text(pkg.opt("title"),256);
        long appExpiry=pkg==null?0:ProviderParser.date(pkg.opt("endsAt"));
        boolean trial="3 Saat Deneme".equals(title) || "24 Saat Test".equals(title);
        boolean eligible=AccountAccessParser.reason(user,now)==Account.Access.ACTIVE;
        String suffix=ProviderParser.text(user.opt("codeSuffix"),16); if(suffix.isEmpty())suffix=t.codeSuffix;
        if(suffix.length()>4)suffix=suffix.substring(suffix.length()-4);
        String message=eligible?"İzleme erişimin açık.":"blocked".equals(user.optString("status"))?"Hesabın için destek ekibimizle iletişime geç.":!user.optBoolean("hasAssignedLink")?"İçerik bağlantın henüz hazır değil.":"Aktif izleme erişimin bulunmuyor.";
        Account.Access reason=AccountAccessParser.reason(user,now);
        if(reason==Account.Access.EXPIRED)message="Aktif paketin bulunmuyor veya paketinin süresi doldu.";
        if(reason==Account.Access.TRIAL_PENDING)message="review".equals(user.optString("trialProvisionStatus"))?"Deneme erişimin inceleniyor. Destek ekibimizle iletişime geç.":"Deneme erişimin hazırlanıyor. Lütfen tekrar kontrol et.";
        Account account=new Account(id,suffix,title,appExpiry,false,trial,message,reason);
        if(eligible) {
            try {
                ProviderParser.Bootstrap b=bootstrap(auth,force);
                if(!b.accountId.equals(id)) { clearProvider();throw new Problem(Failure.Code.STALE); }
                account=new Account(id,suffix,title,b.expiresAtMs,true,trial,message);
            } catch(Problem issue) {
                if(issue.code==Failure.Code.INELIGIBLE) account=new Account(id,suffix,title,appExpiry,false,trial,"Paketin aktif. İçerik hizmetine şu anda ulaşılamıyor.",Account.Access.SERVICE_UNAVAILABLE);
                else if(issue.code==Failure.Code.NETWORK && cached!=null && cached.canPlay && guard.current()!=null && guard.current().expiresAtMs>clock.now()) account=new Account(id,suffix,title,guard.current().expiresAtMs,true,trial,"Son doğrulanan erişim bilgisi gösteriliyor.");
                else throw issue;
            }
        } else clearProvider();
        checkAuth(auth); currentAccount=account;accountCheckedAt=clock.now();return account;
    }
    private void installTokens(JSONObject raw,long auth,TokenStore.Session previous) throws Exception {
        String access=ProviderParser.secret(raw.opt("accessToken"),16384), refresh=ProviderParser.secret(raw.opt("refreshToken"),16384);
        JSONObject user=ProviderParser.object(raw.opt("user")); String account=ProviderParser.secret(user.opt("id"),256);
        if(previous!=null && !previous.accountId.isEmpty() && !previous.accountId.equals(account)) throw new Problem(Failure.Code.STALE);
        String suffix=ProviderParser.text(user.opt("codeSuffix"),16); if(suffix.length()>4)suffix=suffix.substring(suffix.length()-4);
        TokenStore.Session replacement=new TokenStore.Session(access,refresh,account,suffix);
        synchronized(lock) { checkAuth(auth);tokenStore.save(replacement);tokens=replacement; }
    }
    private Object api(String path,String method,JSONObject body,long auth) throws Exception {
        TokenStore.Session before=requireTokens(auth);
        try { return request(API+path,method,body,before.accessToken,auth,-1,null); }
        catch(Problem problem) {
            if(problem.code!=Failure.Code.AUTH) { if(problem.code==Failure.Code.INELIGIBLE)clearProvider();throw problem; }
            // Worker serialization means only one refresh can consume a rotating refresh token.
            try {
                JSONObject response=ProviderParser.object(request(API+"/auth/refresh","POST",new JSONObject().put("refreshToken",before.refreshToken),null,auth,-1,null));
                installTokens(response,auth,before);
            } catch(Problem refreshProblem) {
                if(refreshProblem.code==Failure.Code.AUTH || refreshProblem.code==Failure.Code.INELIGIBLE || refreshProblem.code==Failure.Code.STALE) revokeAuth(auth);
                throw refreshProblem;
            }
            try { return request(API+path,method,body,requireTokens(auth).accessToken,auth,-1,null); }
            catch(Problem denied) { if(denied.code==Failure.Code.AUTH)revokeAuth(auth);else if(denied.code==Failure.Code.INELIGIBLE)clearProvider();throw denied; }
        }
    }
    private ProviderParser.Bootstrap bootstrap(long auth,boolean force) throws Exception {
        requireTokens(auth); ProviderParser.Bootstrap old=guard.current(); long now=clock.now();
        if(old!=null && old.expiresAtMs<=now) {clearProvider();old=null;}
        if(!force && old!=null && now-bootstrapCheckedAt<60000) return old;
        ProviderParser.Bootstrap incoming;
        try { incoming=ProviderParser.bootstrap(ProviderParser.object(api("/me/provider-session","GET",null,auth)),clock.now()); }
        catch(Problem error) { if(error.code==Failure.Code.INELIGIBLE || error.code==Failure.Code.AUTH)clearProvider();throw error; }
        catch(ProviderParser.Invalid invalid) { clearProvider();throw invalid; }
        checkAuth(auth); TokenStore.Session t=requireTokens(auth);
        if(!t.accountId.isEmpty() && !t.accountId.equals(incoming.accountId)) {clearProvider();throw new Problem(Failure.Code.STALE);}
        incoming=ProviderParser.retainLivePolicy(incoming,old);
        PolicyIdentity priorPolicy=verifiedLivePolicy;final PolicyIdentity incomingPolicy=incoming.livePolicy==priorPolicy.policy?priorPolicy:new PolicyIdentity(incoming.livePolicy);
        Catalog policyCatalog=null;long policySource=-1;
        synchronized(lock) {
            checkAuth(auth);
            if(!incoming.sameIdentity(old)) clearMetadataLocked();
            String previousPolicy=currentPolicyRevision();verifiedLivePolicy=incomingPolicy;
            guard.install(incoming);bootstrapCheckedAt=clock.now();scheduleAccessLocked(auth,incoming);
            String nextPolicy=currentPolicyRevision();
            if(!previousPolicy.equals(nextPolicy)){policyCatalog=catalogs.get(Kind.LIVE);policySource=guard.generation();}
        }
        if(old!=null && !incoming.sameIdentity(old))metadataDisk.clear();
        if(policyCatalog!=null){rebuildFavorites();publishPolicyCatalog(policyCatalog,auth,policySource,incoming.scope());}
        return incoming;
    }
    private void scheduleAccessLocked(long auth,ProviderParser.Bootstrap b) {
        final long source=guard.generation();
        if(refreshTimer!=null)main.removeCallbacks(refreshTimer); if(expiryTimer!=null)main.removeCallbacks(expiryTimer);
        refreshTimer=()->{synchronized(lock){if(auth!=authGeneration || guard.current()==null)return;} refreshAccess(new Callback<Account>() {
            @Override public void onResult(Account value) { }
            @Override public void onError(Failure failure) { synchronized(lock) { ProviderParser.Bootstrap current=guard.current();if(auth==authGeneration && current!=null && current.expiresAtMs>clock.now() && refreshTimer!=null)main.postDelayed(refreshTimer,60000); } }
        });};
        main.postDelayed(refreshTimer,60000);
        expiryTimer=()->{
            synchronized(lock) {
                ProviderParser.Bootstrap current=guard.current(); if(auth!=authGeneration || current==null || !current.sameIdentity(b))return;
                long remaining=current.expiresAtMs-clock.now();
                if(remaining>0){main.postDelayed(expiryTimer,Math.min(remaining,Integer.MAX_VALUE));return;}
            }
            clearProvider(auth,source,b.scope(),true);
        };
        main.postDelayed(expiryTimer,Math.min(Math.max(1,b.expiresAtMs-clock.now()),Integer.MAX_VALUE));
    }
    private void clearMetadataLocked() { liveRawSnapshot=null;curatedInput=null;curatedLive=null;curatedRevision="";catalogs.clear();catalogIndexes.clear();catalogSavedAt.clear();catalogValidUntil.clear();catalogFetches.clear();foregroundCatalogFetches.clear();details.clear();detailSavedAt.clear();detailValidUntil.clear();detailFetches.clear();foregroundDetailFetches.clear();metadataRefreshes.clear();favoriteRefs.clear();watchedRefs.clear();libraryScope="";librarySavedAt=0;libraryValidUntil=0;libraryEpoch++;favoriteItems=Collections.emptyList();resolvedFavorites=Collections.emptyMap();favoriteMembership=Collections.emptySet(); }
    private void clearProvider() {clearProvider(-1,-1,null);}
    private void clearProvider(long auth,long source,String scope) {clearProvider(auth,source,scope,false);}
    private void clearProvider(long auth,long source,String scope,boolean expiredOnly) {
        List<HttpURLConnection> cancel;
        synchronized(lock) {
            // A late optional denial may revoke only the lease that issued its request.
            if(scope!=null) {
                ProviderParser.Bootstrap current=guard.current();
                if(auth!=authGeneration || source!=guard.generation() || current==null || !scope.equals(current.scope()))return;
                if(expiredOnly?current.expiresAtMs>clock.now():!guard.active(source,scope,clock.now()))return;
            }
            guard.clear();verifiedLivePolicy=new PolicyIdentity(null);bootstrapCheckedAt=0;clearMetadataLocked();
            Account previous=currentAccount;if(previous!=null && previous.canPlay)currentAccount=new Account(previous.id,previous.codeSuffix,previous.packageTitle,previous.expiresAtMs,false,previous.trial,"İçerik hizmetine şu anda ulaşılamıyor.",Account.Access.SERVICE_UNAVAILABLE);
            accountCheckedAt=0;
            if(refreshTimer!=null)main.removeCallbacks(refreshTimer);if(expiryTimer!=null)main.removeCallbacks(expiryTimer);
            refreshTimer=null;expiryTimer=null;cancel=new ArrayList<>(connections);
        }
        metadataDisk.clear();
        for(HttpURLConnection connection:cancel)connection.disconnect();
    }
    private void clearSession() {
        PairingAttempt old;
        synchronized(lock) {authGeneration++;pairingEpoch++;old=pairingAttempt;pairingAttempt=null;tokens=null;currentAccount=null;accountCheckedAt=0;tokenStore.clear();}
        if(old!=null)old.cancel();
        clearProvider();
    }
    private void revokeAuth(long auth) { synchronized(lock) { if(auth==authGeneration) {tokens=null;currentAccount=null;accountCheckedAt=0;tokenStore.clear();} } clearProvider(); }
    @Override public void logout() { clearSession(); }

    @Override public void catalog(Kind kind,boolean force,Callback<Catalog> callback) {loadCatalog(kind,force,callback,true);}
    @Override public void homeCatalog(Kind kind,boolean force,Callback<Catalog> callback){loadCatalog(kind,force,callback,false);}
    private void loadCatalog(Kind kind,boolean force,Callback<Catalog> callback,boolean foreground){
        CatalogDemand demand=new CatalogDemand(foreground);
        enqueuePrepared("catalog-"+kind+(force?"-fresh":""),true,new Callback<Catalog>(){
            public void onResult(Catalog value){if(callback!=null)callback.onResult(value);if(!force)refreshCatalogIfStale(kind);refreshLibraryIfStale();}
            public void onError(Failure issue){if(callback!=null)callback.onError(issue);}
        },auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);
            Catalog local=force?null:cachedCatalog(auth,b,kind);long source=guard.generation();
            if(local!=null)return new Prepared<>(cachedAuth->{active(cachedAuth,source,b.scope());return local;},source,b.scope());
            // Only provider metadata runs here; API calls and token rotation stay in preparation.
            return new Prepared<>(optionalAuth->{
                metadataActive(optionalAuth,source,b.scope(),true,demand);
                Catalog cached=force?null:cachedCatalog(optionalAuth,b,kind,!demand.foreground);if(cached!=null)return cached;
                long ticket;synchronized(lock){Long current=catalogFetches.get(kind);ticket=current==null?0:current;}
                return fetchCatalog(optionalAuth,b,source,kind,true,ticket,true,force,demand);
            },source,b.scope(),primaryCatalogWorker);
        },false,demand,force?null:auth->memoryCatalog(auth,kind));
    }
    private boolean optionalWorkAllowed(){return !BackgroundWorkGate.isPlaybackActive() && clock.now()>=optionalWorkPausedUntil;}
    private boolean optionalWorkAllowed(CatalogDemand demand){return demand!=null && demand.foreground || optionalWorkAllowed();}
    private boolean pendingLivePlaybackLocked(String scope){
        if(scope.isEmpty())return false;
        for(Map.Entry<String,Pending<?>> entry:pending.entrySet()){
            Pending<?> operation=entry.getValue();
            if(entry.getKey().startsWith("playback-LIVE::") && operation.auth==authGeneration && operation.sourceBound && !operation.callbacks.isEmpty() && (operation.scope.isEmpty() || operation.scope.equals(scope)))return true;
        }
        return false;
    }
    @Override public void trimMemory(Kind keep){
        synchronized(lock){
            long now=clock.now();optionalWorkPausedUntil=Math.max(optionalWorkPausedUntil,now>Long.MAX_VALUE-60000?Long.MAX_VALUE:now+60000);memoryEpoch++;liveRawSnapshot=null;
            // A prepared main-thread playback callback still validates its canonical LIVE projection.
            boolean pendingLive=pendingLivePlaybackLocked(currentScope());
            for(Kind kind:new Kind[]{Kind.LIVE,Kind.MOVIE,Kind.SERIES})if(kind!=keep && !(kind==Kind.LIVE && pendingLive)){catalogs.remove(kind);catalogIndexes.remove(kind);catalogSavedAt.remove(kind);catalogValidUntil.remove(kind);}
            if(keep!=Kind.LIVE && !pendingLive){curatedInput=null;curatedLive=null;curatedRevision="";}
            details.clear();detailSavedAt.clear();detailValidUntil.clear();
        }
    }
    @Override public void prepareOfflineData(){
        enqueue("offline-preparation",true,null,auth->{
            if(!optionalWorkAllowed())return Boolean.FALSE;
            ProviderParser.Bootstrap b=bootstrap(auth,false);restoreLibrary(auth,b);long source=guard.generation();String key="offline:"+auth+":"+source;
            synchronized(lock){if(!metadataRefreshes.add(key))return Boolean.FALSE;}
            try{metadataWorker.execute(()->{
                try{
                    metadataActive(auth,source,b.scope(),true);long epoch;boolean stale;synchronized(lock){epoch=libraryEpoch;stale=!b.scope().equals(libraryScope) || clock.now()-librarySavedAt>=LIBRARY_FRESH_MS;}
                    boolean changed=false;if(stale)try{changed=fetchLibrary(auth,b,source,true,epoch);}catch(Exception ignored){}
                    for(Kind kind:new Kind[]{Kind.LIVE,Kind.MOVIE,Kind.SERIES}){
                        metadataActive(auth,source,b.scope(),true);
                        try{
                            Catalog cached=cachedCatalog(auth,b,kind,true);long ticket;Long saved;synchronized(lock){Long current=catalogFetches.get(kind);ticket=current==null?0:current;saved=catalogSavedAt.get(kind);}
                            if(cached==null || cacheStale(saved))fetchCatalog(auth,b,source,kind,true,ticket,cached==null);
                        }catch(Exception ignored){}
                    }
                    rebuildFavorites();persistLibrary(auth,b,source);if(changed)notifyFavoriteCatalogs(auth,source,b.scope());
                }catch(Exception ignored){}finally{synchronized(lock){metadataRefreshes.remove(key);}}
            });}catch(RejectedExecutionException ignored){synchronized(lock){metadataRefreshes.remove(key);}}
            return Boolean.TRUE;
        });
    }
    @Override public AutoCloseable observeCatalog(CatalogObserver observer) {
        if(observer==null)return ()->{};
        synchronized(lock){catalogObservers.add(observer);}
        return ()->{synchronized(lock){catalogObservers.remove(observer);}};
    }
    private static Map<String,Item> indexCatalog(Catalog value){Map<String,Item> index=new HashMap<>();if(value.kind!=Kind.LIVE)for(Item item:value.items)index.put(item.id,item);return Collections.unmodifiableMap(index);}
    private Catalog cachedCatalog(long auth,ProviderParser.Bootstrap b,Kind kind)throws Exception{return cachedCatalog(auth,b,kind,false);}
    private Catalog cachedCatalog(long auth,ProviderParser.Bootstrap b,Kind kind,boolean optional)throws Exception{
        long source=guard.generation();metadataActive(auth,source,b.scope(),optional);if(kind==null || kind==Kind.EPISODE)throw new ProviderParser.Invalid();
        Catalog memory=null;final Long previousTicket;final long epoch;
        synchronized(lock){epoch=memoryEpoch;previousTicket=catalogFetches.get(kind);if(cacheAgeValid(catalogSavedAt.get(kind),catalogValidUntil.get(kind)))memory=catalogs.get(kind);}if(memory!=null)return memory;
        MetadataDiskCache.Snapshot<Catalog> cached=metadataDisk.readCatalog(b.scope(),kind,b.expiresAtMs,clock.now());metadataActive(auth,source,b.scope(),optional);if(cached==null)return null;
        final String policy;final Set<String> excluded;
        synchronized(lock){policy=currentPolicyRevision();ProviderParser.Bootstrap current=guard.current();excluded=current==null || current.livePolicy==null?Collections.emptySet():current.livePolicy.excludedIds;}
        LiveChannelCuration.Projection ready=kind==Kind.LIVE?metadataDisk.readReadyLive(b.scope(),b.expiresAtMs,clock.now(),cached,policy,excluded):null;
        Map<String,Item> index=indexCatalog(cached.value);
        synchronized(lock){
            metadataActive(auth,source,b.scope(),optional);if(optional && epoch!=memoryEpoch)throw new Problem(Failure.Code.STALE);
            if(!java.util.Objects.equals(previousTicket,catalogFetches.get(kind)))memory=catalogs.get(kind);
            else{
                catalogs.put(kind,cached.value);catalogIndexes.put(kind,index);catalogSavedAt.put(kind,cached.savedAt);catalogValidUntil.put(kind,cached.expiresAt);memory=cached.value;
                if(kind==Kind.LIVE){
                    liveRawSnapshot=epoch==memoryEpoch?cached:null;curatedInput=null;curatedLive=null;curatedRevision="";
                    if(ready!=null && epoch==memoryEpoch && policy.equals(currentPolicyRevision())){curatedInput=cached.value;curatedLive=ready;curatedRevision=policy;}
                }
            }
        }
        if(memory==null)return null;rebuildFavorites();persistLibrary(auth,b,source);return memory;
    }
    private Catalog catalogFor(long auth,ProviderParser.Bootstrap b,Kind kind,boolean force) throws Exception {
        if(!force){Catalog cached=cachedCatalog(auth,b,kind);if(cached!=null)return cached;}
        return fetchCatalog(auth,b,guard.generation(),kind,false,-1);
    }
    private Catalog fetchCatalog(long auth,ProviderParser.Bootstrap b,long source,Kind kind,boolean optional,long queuedTicket) throws Exception {return fetchCatalog(auth,b,source,kind,optional,queuedTicket,false);}
    private Catalog fetchCatalog(long auth,ProviderParser.Bootstrap b,long source,Kind kind,boolean optional,long queuedTicket,boolean allowMissing) throws Exception {return fetchCatalog(auth,b,source,kind,optional,queuedTicket,allowMissing,false);}
    private Catalog fetchCatalog(long auth,ProviderParser.Bootstrap b,long source,Kind kind,boolean optional,long queuedTicket,boolean allowMissing,boolean allowFresh) throws Exception {return fetchCatalog(auth,b,source,kind,optional,queuedTicket,allowMissing,allowFresh,null);}
    private Catalog fetchCatalog(long auth,ProviderParser.Bootstrap b,long source,Kind kind,boolean optional,long queuedTicket,boolean allowMissing,boolean allowFresh,CatalogDemand demand) throws Exception {
        final long ticket;final boolean primary=!optional || demand!=null;
        synchronized(lock){
            metadataActive(auth,source,b.scope(),optional,demand);Long previous=catalogFetches.get(kind);long current=previous==null?0:previous;
            if(optional && (current!=queuedTicket || foregroundCatalogFetches.containsKey(kind) || !allowMissing && !catalogs.containsKey(kind) || !allowFresh && catalogs.containsKey(kind) && !cacheStale(catalogSavedAt.get(kind))))throw new Problem(Failure.Code.STALE);
            ticket=current+1;catalogFetches.put(kind,ticket);if(kind==Kind.LIVE)liveRawSnapshot=null;if(primary)foregroundCatalogFetches.put(kind,ticket);
        }
        try {
            String prefix=kind==Kind.MOVIE?"vod":kind.name().toLowerCase(Locale.ROOT);
            Object groups=provider(auth,b,source,"get_"+prefix+"_categories",null,this::readJson,optional,demand);
            catalogFetchActive(auth,source,b.scope(),kind,ticket,optional,demand);
            Catalog parsed=provider(auth,b,source,kind==Kind.SERIES?"get_series":"get_"+prefix+"_streams",null,
                input->ProviderCatalogReader.read(new InputStreamReader(input,StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)),kind,groups,b.scope()),optional,demand);
            catalogFetchActive(auth,source,b.scope(),kind,ticket,optional,demand);
            List<Item> cleaned=new ArrayList<>(); for(Item item:parsed.items)cleaned.add(safeArtwork(item,b));
            Catalog result=new Catalog(kind,cleaned,parsed.categories);active(auth,source,b.scope());
            long saved=clock.now();Map<String,Item> index=indexCatalog(result);final long persistenceEpoch;
            synchronized(lock) {catalogFetchActive(auth,source,b.scope(),kind,ticket,optional,demand);persistenceEpoch=memoryEpoch;catalogs.put(kind,result);catalogIndexes.put(kind,index);catalogSavedAt.put(kind,saved);catalogValidUntil.put(kind,b.expiresAtMs);}
            persistMetadata(()->{
                MetadataDiskCache.Valid valid=()->{synchronized(lock){return catalogs.get(kind)==result && persistenceLease(auth,source,b.scope(),persistenceEpoch) && catalogWriteLease(auth,source,b.scope(),kind,ticket);}};
                MetadataDiskCache.Snapshot<Catalog> committed=metadataDisk.writeCatalog(b.scope(),b.expiresAtMs,saved,result,valid);
                if(kind==Kind.LIVE && committed!=null)synchronized(lock){if(valid.get())liveRawSnapshot=committed;}
            });
            rebuildFavorites();persistLibrary(auth,b,source);
            catalogFetchActive(auth,source,b.scope(),kind,ticket,optional,demand);if(optional && (demand==null || !demand.foreground))publishCatalog(result,auth,source,b.scope(),ticket);return result;
        } finally {
            if(primary)synchronized(lock){Long current=foregroundCatalogFetches.get(kind);if(current!=null && current==ticket)foregroundCatalogFetches.remove(kind);}
        }
    }
    private void metadataActive(long auth,long source,String scope,boolean optional)throws Problem {metadataActive(auth,source,scope,optional,null);}
    private void metadataActive(long auth,long source,String scope,boolean optional,CatalogDemand demand)throws Problem {active(auth,source,scope);if(optional && !optionalWorkAllowed(demand))throw new Problem(Failure.Code.NETWORK);}
    private void catalogFetchActive(long auth,long source,String scope,Kind kind,long ticket,boolean optional)throws Problem{catalogFetchActive(auth,source,scope,kind,ticket,optional,null);}
    private void catalogFetchActive(long auth,long source,String scope,Kind kind,long ticket,boolean optional,CatalogDemand demand)throws Problem{synchronized(lock){metadataActive(auth,source,scope,optional,demand);Long current=catalogFetches.get(kind);if(current==null || current!=ticket)throw new Problem(Failure.Code.STALE);}}
    private boolean catalogWriteLease(long auth,long source,String scope,Kind kind,long ticket){try{catalogFetchActive(auth,source,scope,kind,ticket,true);return true;}catch(Problem ignored){return false;}}
    private boolean cacheAgeValid(Long saved,Long until){long now=clock.now();return saved!=null && until!=null && saved<=now && now-saved<MetadataDiskCache.MAX_AGE_MS && until>now;}
    private boolean cacheStale(Long saved){return saved==null || clock.now()-saved>=MetadataDiskCache.FRESH_MS;}
    private void refreshCatalogIfStale(Kind kind) {
        final ProviderParser.Bootstrap b;final long auth,source,queuedTicket;final String key;
        synchronized(lock){b=guard.current();if(b==null || !catalogs.containsKey(kind) || !cacheStale(catalogSavedAt.get(kind)) || !optionalWorkAllowed())return;auth=authGeneration;source=guard.generation();Long current=catalogFetches.get(kind);queuedTicket=current==null?0:current;key="catalog:"+kind+":"+auth+":"+source;if(!metadataRefreshes.add(key))return;}
        try{metadataWorker.execute(()->{try{fetchCatalog(auth,b,source,kind,true,queuedTicket);}catch(Exception ignored){}finally{synchronized(lock){metadataRefreshes.remove(key);}}});}
        catch(RejectedExecutionException ignored){synchronized(lock){metadataRefreshes.remove(key);}}
    }
    private void publishPolicyCatalog(Catalog value,long auth,long source,String scope) {
        synchronized(lock){if(catalogObservers.isEmpty())return;}
        final String revision=currentPolicyRevision();final Catalog published=currentLiveCatalog(value);
        if(!revision.equals(currentPolicyRevision())){try{worker.execute(()->publishPolicyCatalog(value,auth,source,scope));}catch(RejectedExecutionException ignored){}return;}
        callbacks.execute(()->{
            List<CatalogObserver> observers;
            synchronized(lock){if(auth!=authGeneration || !guard.active(source,scope,clock.now()) || catalogs.get(value.kind)!=value)return;observers=new ArrayList<>(catalogObservers);}
            if(!revision.equals(currentPolicyRevision())){try{worker.execute(()->publishPolicyCatalog(value,auth,source,scope));}catch(RejectedExecutionException ignored){}return;}
            for(CatalogObserver observer:observers){synchronized(lock){if(!catalogObservers.contains(observer) || auth!=authGeneration || !guard.active(source,scope,clock.now()) || catalogs.get(value.kind)!=value)continue;}observer.onCatalog(published);}
        });
    }
    private void publishCatalog(Catalog value,long auth,long source,String scope,long ticket){
        final String revision=currentPolicyRevision();final Catalog published=currentLiveCatalog(value);
        if(!revision.equals(currentPolicyRevision())){try{worker.execute(()->publishCatalog(value,auth,source,scope,ticket));}catch(RejectedExecutionException ignored){}return;}
        callbacks.execute(()->{
            if(!catalogWriteLease(auth,source,scope,value.kind,ticket))return;List<CatalogObserver> observers;
            synchronized(lock){observers=new ArrayList<>(catalogObservers);}
            if(!revision.equals(currentPolicyRevision())){try{worker.execute(()->publishCatalog(value,auth,source,scope,ticket));}catch(RejectedExecutionException ignored){}return;}
            for(CatalogObserver observer:observers){synchronized(lock){if(!catalogObservers.contains(observer) || catalogs.get(value.kind)!=value)continue;}if(!catalogWriteLease(auth,source,scope,value.kind,ticket))return;observer.onCatalog(published);}
        });
    }
    private Item safeArtwork(Item item,ProviderParser.Bootstrap b) throws ProviderParser.Invalid {
        String art=item.artwork;
        String decoded=art;try{decoded=new java.net.URI(art).getPath();}catch(Exception ignored){art="";}
        if(art.contains(b.username) || art.contains(b.password) || art.contains(ProviderParser.encode(b.username)) || art.contains(ProviderParser.encode(b.password)) || (decoded!=null && (decoded.contains(b.username) || decoded.contains(b.password))))art="";
        return new Item(item.kind,item.id,item.title,item.categoryId,item.categoryName,art,item.extension,item.scope,item.seriesId,item.season,item.episode,item.description,item.sourceTitle,item.releaseYear);
    }
    @Override public void series(Item series,Callback<SeriesDetail> callback) {
        enqueue("series-"+(series==null?"":series.id),true,new Callback<SeriesDetail>(){
            @Override public void onResult(SeriesDetail value){if(callback!=null)callback.onResult(value);refreshSeriesIfStale(value.series);}
            @Override public void onError(Failure issue){if(callback!=null)callback.onError(issue);}
        },auth->{ProviderParser.Bootstrap b=bootstrap(auth,false);library(auth,b,false);return seriesFor(auth,b,series,false);});
    }
    @Override public void startingEpisode(Item series,Callback<Item> callback) {
        String identity=series==null?"null":series.kind+":"+series.scope.length()+":"+series.scope+":"+series.id;
        enqueue("starting-episode-"+identity,true,callback,auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);library(auth,b,false);
            SeriesDetail detail=seriesFor(auth,b,series,false);long source=guard.generation();active(auth,source,b.scope());
            Map<String,?> saved=positions.getAll();Set<String> watched;synchronized(lock){watched=new HashSet<>(watchedRefs);}
            Item first=null,unwatched=null,resumable=null;long latest=Long.MIN_VALUE;
            for(Season season:detail.seasons)for(Item episode:season.episodes) {
                if(first==null)first=episode;
                if(unwatched==null && !watched.contains(refKey(episode)))unwatched=episode;
                if(saved.isEmpty())continue;
                String key=positionKey(episode);Object position=saved.get(key);
                if(!(position instanceof Long) || (Long)position<=0)continue;
                Object stamp=saved.get(key+".time");long time=stamp instanceof Long?(Long)stamp:0;
                if(resumable==null || time>latest){resumable=episode;latest=time;}
            }
            Item selected=resumable!=null?resumable:unwatched!=null?unwatched:first;
            if(selected==null)throw new ProviderParser.Invalid();active(auth,source,b.scope());return selected;
        });
    }
    private Item find(Catalog catalog,String id) {for(Item item:catalog.items)if(item.id.equals(id))return item;return null;}
    private SeriesDetail seriesFor(long auth,ProviderParser.Bootstrap b,Item candidate,boolean force) throws Exception {
        if(candidate==null || candidate.kind!=Kind.SERIES)throw new ProviderParser.Invalid();ProviderParser.reference(candidate,b.scope());
        long source=guard.generation();active(auth,source,b.scope());
        synchronized(lock) {if(!force && details.containsKey(candidate.id) && cacheAgeValid(detailSavedAt.get(candidate.id),detailValidUntil.get(candidate.id)))return details.get(candidate.id);}
        if(!force){MetadataDiskCache.Snapshot<SeriesDetail> cached=metadataDisk.readSeries(b.scope(),candidate.id,b.expiresAtMs,clock.now());active(auth,source,b.scope());if(cached!=null){synchronized(lock){active(auth,source,b.scope());details.put(candidate.id,cached.value);detailSavedAt.put(candidate.id,cached.savedAt);detailValidUntil.put(candidate.id,cached.expiresAt);trimDetailsLocked();}return cached.value;}}
        Item parent=find(catalogFor(auth,b,Kind.SERIES,false),candidate.id);if(parent==null)parent=find(catalogFor(auth,b,Kind.SERIES,true),candidate.id);if(parent==null)throw new ProviderParser.Invalid();
        return fetchSeries(auth,b,source,parent,false,-1);
    }
    private SeriesDetail fetchSeries(long auth,ProviderParser.Bootstrap b,long source,Item parent,boolean optional,long queuedTicket)throws Exception {
        final long ticket;
        synchronized(lock){
            metadataActive(auth,source,b.scope(),optional);Long previous=detailFetches.get(parent.id);long current=previous==null?0:previous;
            if(optional && (current!=queuedTicket || foregroundDetailFetches.containsKey(parent.id) || !details.containsKey(parent.id) || !cacheStale(detailSavedAt.get(parent.id))))throw new Problem(Failure.Code.STALE);
            ticket=current+1;detailFetches.put(parent.id,ticket);if(!optional)foregroundDetailFetches.put(parent.id,ticket);
        }
        try {
            SeriesDetail parsed=ProviderParser.series(provider(auth,b,source,"get_series_info",parent.id,optional),parent);seriesFetchActive(auth,source,b.scope(),parent.id,ticket,optional);
            List<Season> seasons=new ArrayList<>();for(Season season:parsed.seasons){List<Item> episodes=new ArrayList<>();for(Item episode:season.episodes)episodes.add(safeArtwork(episode,b));seasons.add(new Season(season.number,episodes));}
            SeriesDetail result=new SeriesDetail(safeArtwork(parsed.series,b),seasons);long saved=clock.now();final long persistenceEpoch;
            synchronized(lock){seriesFetchActive(auth,source,b.scope(),parent.id,ticket,optional);persistenceEpoch=memoryEpoch;details.put(parent.id,result);detailSavedAt.put(parent.id,saved);detailValidUntil.put(parent.id,b.expiresAtMs);trimDetailsLocked();}
            persistMetadata(()->metadataDisk.writeSeries(b.scope(),b.expiresAtMs,saved,result,()->{synchronized(lock){try{if(!persistenceLease(auth,source,b.scope(),persistenceEpoch))return false;seriesFetchActive(auth,source,b.scope(),parent.id,ticket,true);return true;}catch(Problem ignored){return false;}}}));seriesFetchActive(auth,source,b.scope(),parent.id,ticket,optional);return result;
        } finally {
            if(!optional)synchronized(lock){Long current=foregroundDetailFetches.get(parent.id);if(current!=null && current==ticket)foregroundDetailFetches.remove(parent.id);}
        }
    }
    private void seriesFetchActive(long auth,long source,String scope,String id,long ticket,boolean optional)throws Problem{synchronized(lock){metadataActive(auth,source,scope,optional);Long current=detailFetches.get(id);if(current==null || current!=ticket)throw new Problem(Failure.Code.STALE);}}
    private void trimDetailsLocked(){while(details.size()>12){String first=details.keySet().iterator().next();details.remove(first);detailSavedAt.remove(first);detailValidUntil.remove(first);}}
    private void refreshSeriesIfStale(Item parent){
        final ProviderParser.Bootstrap b;final long auth,source,queuedTicket;final String key;
        synchronized(lock){b=guard.current();if(b==null || parent==null || !parent.scope.equals(b.scope()) || !details.containsKey(parent.id) || !cacheStale(detailSavedAt.get(parent.id)) || !optionalWorkAllowed())return;auth=authGeneration;source=guard.generation();Long current=detailFetches.get(parent.id);queuedTicket=current==null?0:current;key="series:"+parent.id+":"+auth+":"+source;if(!metadataRefreshes.add(key))return;}
        try{metadataWorker.execute(()->{try{fetchSeries(auth,b,source,parent,true,queuedTicket);}catch(Exception ignored){}finally{synchronized(lock){metadataRefreshes.remove(key);}}});}catch(RejectedExecutionException ignored){synchronized(lock){metadataRefreshes.remove(key);}}
    }
    private Object provider(long auth,ProviderParser.Bootstrap b,long source,String action,String id) throws Exception {return provider(auth,b,source,action,id,this::readJson);}
    private Object provider(long auth,ProviderParser.Bootstrap b,long source,String action,String id,boolean optional)throws Exception{return provider(auth,b,source,action,id,this::readJson,optional);}
    private <T> T provider(long auth,ProviderParser.Bootstrap b,long source,String action,String id,ResponseReader<T> reader)throws Exception{return provider(auth,b,source,action,id,reader,false);}
    private <T> T provider(long auth,ProviderParser.Bootstrap b,long source,String action,String id,ResponseReader<T> reader,boolean optional) throws Exception {return provider(auth,b,source,action,id,reader,optional,null);}
    private <T> T provider(long auth,ProviderParser.Bootstrap b,long source,String action,String id,ResponseReader<T> reader,boolean optional,CatalogDemand demand) throws Exception {
        metadataActive(auth,source,b.scope(),optional,demand);
        if(!java.util.Arrays.asList("get_vod_categories","get_vod_streams","get_series_categories","get_series","get_live_categories","get_live_streams","get_series_info","get_short_epg").contains(action))throw new ProviderParser.Invalid();
        String url=b.origin+"/player_api.php?username="+ProviderParser.encode(b.username)+"&password="+ProviderParser.encode(b.password)+"&action="+action;
        if("get_series_info".equals(action)||"get_short_epg".equals(action)) {if(ProviderParser.id(id).isEmpty())throw new ProviderParser.Invalid();url+=("get_series_info".equals(action)?"&series_id=":"&stream_id=")+id;}
        if("get_short_epg".equals(action))url+="&limit=24";
        try { return request(url,"GET",null,null,auth,source,b.scope(),reader,optional,demand); }
        catch(Problem denied) { if(denied.code==Failure.Code.AUTH || denied.code==Failure.Code.INELIGIBLE)clearProvider(auth,source,b.scope());throw denied; }
    }
    @Override public void epg(Item live,Callback<List<Programme>> callback) {
        enqueuePrepared("epg-"+(live==null?"":live.id),true,callback,auth->{
            // Bootstrap and catalog preparation stay serialized with all API/token operations.
            ProviderParser.Bootstrap b=bootstrap(auth,false);
            if(live==null || live.kind!=Kind.LIVE)throw new ProviderParser.Invalid();ProviderParser.reference(live,b.scope());
            Item verified=resolveLiveItem(catalogFor(auth,b,Kind.LIVE,false),live.id);if(verified==null)throw new ProviderParser.Invalid();
            long source=guard.generation();active(auth,source,b.scope());
            return new Prepared<>(optionalAuth->{
                active(optionalAuth,source,b.scope());
                List<Programme> result=ProviderParser.epg(provider(optionalAuth,b,source,"get_short_epg",verified.id));
                active(optionalAuth,source,b.scope());return result;
            },source,b.scope());
        },true);
    }
    private Callback<Playback> curatedPlaybackCallback(Item requested,Callback<Playback> callback) {
        if(requested==null || requested.kind!=Kind.LIVE || callback==null)return callback;
        return new Callback<Playback>() {
            public void onResult(Playback value) {
                boolean valid;
                synchronized(lock){Catalog raw=catalogs.get(Kind.LIVE);Item selected=raw==null || curatedInput!=raw || !curatedRevision.equals(currentPolicyRevision()) || curatedLive==null?null:curatedLive.resolve(requested.id);valid=selected!=null && requested.scope.equals(currentScope()) && selected.id.equals(value.item.id);}
                if(valid)callback.onResult(value);else callback.onError(failure(new Problem(Failure.Code.INVALID)));
            }
            public void onError(Failure issue){callback.onError(issue);}
        };
    }
    @Override public void playback(Item candidate,Callback<Playback> callback) {
        enqueue("playback-"+(candidate==null?"":refKey(candidate)),true,curatedPlaybackCallback(candidate,callback),auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,true); if(candidate==null)throw new ProviderParser.Invalid();ProviderParser.reference(candidate,b.scope());
            Item verified=null,next=null;
            if(candidate.kind==Kind.EPISODE) {
                Item parent=new Item(Kind.SERIES,candidate.seriesId,"","","","","",b.scope(),"",0,0,"");
                SeriesDetail detail=seriesFor(auth,b,parent,false);Long saved;synchronized(lock){saved=detailSavedAt.get(parent.id);}if(cacheStale(saved))detail=seriesFor(auth,b,parent,true);List<Item> all=new ArrayList<>();for(Season season:detail.seasons)all.addAll(season.episodes);
                for(int i=0;i<all.size();i++)if(all.get(i).id.equals(candidate.id)){verified=all.get(i);if(i+1<all.size())next=all.get(i+1);break;}
            } else if(candidate.kind!=Kind.SERIES) {
                Catalog catalog=catalogFor(auth,b,candidate.kind,false);
                verified=candidate.kind==Kind.LIVE?resolveLiveItem(catalog,candidate.id):find(catalog,candidate.id);
                Long saved;synchronized(lock){saved=catalogSavedAt.get(candidate.kind);}
                if(candidate.kind!=Kind.LIVE && (verified==null || cacheStale(saved))){catalog=catalogFor(auth,b,candidate.kind,true);verified=find(catalog,candidate.id);}
            }
            if(verified==null)throw new ProviderParser.Invalid();long source=guard.generation();active(auth,source,b.scope());
            // Read the current identity's deadline: a metadata refresh can shorten or extend it.
            ProviderParser.Bootstrap current=guard.current();String url=ProviderParser.mediaUrl(current,verified,clock.now());
            String mime="m3u8".equals(verified.extension)?"application/x-mpegURL":"ts".equals(verified.extension)?"video/mp2t":"mkv".equals(verified.extension)?"video/x-matroska":"avi".equals(verified.extension)?"video/x-msvideo":"video/mp4";
            return new Playback(verified,url,mime,current.expiresAtMs,resumePosition(verified),next);
        });
    }
    private String refKey(Item item) {return item.kind.name()+":"+item.seriesId+":"+item.id;}
    @Override public boolean isFavorite(Item item) {
        synchronized(lock){return item!=null && item.scope.equals(currentScope()) && (favoriteRefs.contains(refKey(item)) || favoriteMembership.contains(refKey(item)));}
    }
    private boolean restoreLibrary(long auth,ProviderParser.Bootstrap b)throws Exception{
        long source=guard.generation();active(auth,source,b.scope());final long epoch;
        synchronized(lock){if(libraryScope.equals(b.scope()) && cacheAgeValid(librarySavedAt,libraryValidUntil))return true;epoch=libraryEpoch;}
        MetadataDiskCache.Snapshot<MetadataDiskCache.Library> stored=metadataDisk.readLibrary(b.scope(),b.expiresAtMs,clock.now());active(auth,source,b.scope());if(stored==null)return false;
        synchronized(lock){active(auth,source,b.scope());if(epoch!=libraryEpoch)return libraryScope.equals(b.scope()) && cacheAgeValid(librarySavedAt,libraryValidUntil);favoriteRefs.clear();favoriteRefs.addAll(stored.value.favorites);watchedRefs.clear();watchedRefs.addAll(stored.value.watched);resolvedFavorites=stored.value.resolved;libraryScope=b.scope();librarySavedAt=stored.savedAt;libraryValidUntil=stored.expiresAt;libraryEpoch++;}
        rebuildFavorites();return true;
    }
    private void library(long auth,ProviderParser.Bootstrap b,boolean force) throws Exception {
        if(!force && restoreLibrary(auth,b))return;
        fetchLibrary(auth,b,guard.generation(),false,-1);
    }
    private boolean fetchLibrary(long auth,ProviderParser.Bootstrap b,long source,boolean optional,long epoch)throws Exception{
        metadataActive(auth,source,b.scope(),optional);TokenStore.Session before=requireTokens(auth);
        synchronized(lock){if(optional && libraryEpoch!=epoch)throw new Problem(Failure.Code.STALE);}
        JSONObject raw;
        try{raw=ProviderParser.object(optional?request(API+"/me/personal-library","GET",null,before.accessToken,auth,source,b.scope(),this::readJson,true):api("/me/personal-library","GET",null,auth));}
        catch(Problem issue){if(optional && issue.code==Failure.Code.INELIGIBLE)clearProvider(auth,source,b.scope());throw issue;}
        JSONArray favorites=ProviderParser.list(raw.opt("favorites"),500),watched=ProviderParser.list(raw.opt("watched"),20000);
        Set<String> newFavorites=libraryRefs(favorites,b,false),newWatched=libraryRefs(watched,b,true);metadataActive(auth,source,b.scope(),optional);final boolean changed;
        synchronized(lock){metadataActive(auth,source,b.scope(),optional);if(optional && (libraryEpoch!=epoch || tokens!=before))throw new Problem(Failure.Code.STALE);changed=!newFavorites.equals(favoriteRefs);favoriteRefs.clear();favoriteRefs.addAll(newFavorites);watchedRefs.clear();watchedRefs.addAll(newWatched);libraryScope=b.scope();librarySavedAt=clock.now();libraryValidUntil=b.expiresAtMs;libraryEpoch++;}
        rebuildFavorites();persistLibrary(auth,b,source);return changed;
    }
    private void persistLibrary(long auth,ProviderParser.Bootstrap b,long source){
        final MetadataDiskCache.Library value;final Map<String,Item> resolved;final long saved,until,epoch,persistenceEpoch;
        synchronized(lock){if(!b.scope().equals(libraryScope) || librarySavedAt<=0)return;resolved=resolvedFavorites;value=new MetadataDiskCache.Library(favoriteRefs,watchedRefs,resolved);saved=librarySavedAt;until=Math.min(libraryValidUntil,b.expiresAtMs);epoch=libraryEpoch;persistenceEpoch=memoryEpoch;}
        persistMetadata(()->metadataDisk.writeLibrary(b.scope(),until,saved,value,()->{synchronized(lock){return persistenceLease(auth,source,b.scope(),persistenceEpoch) && epoch==libraryEpoch && resolvedFavorites==resolved;}}));
    }
    private void refreshLibraryIfStale(){
        final ProviderParser.Bootstrap b;final long auth,source;final String key;
        synchronized(lock){b=guard.current();if(b==null || !optionalWorkAllowed() || b.scope().equals(libraryScope) && cacheAgeValid(librarySavedAt,libraryValidUntil) && clock.now()-librarySavedAt<LIBRARY_FRESH_MS)return;auth=authGeneration;source=guard.generation();key="library:"+auth+":"+source;if(!metadataRefreshes.add(key))return;}
        try{metadataWorker.execute(()->{try{
            metadataActive(auth,source,b.scope(),true);long before;synchronized(lock){before=libraryEpoch;}
            restoreLibrary(auth,b);metadataActive(auth,source,b.scope(),true);
            long epoch;boolean fresh,restored;synchronized(lock){epoch=libraryEpoch;restored=epoch!=before;fresh=b.scope().equals(libraryScope) && cacheAgeValid(librarySavedAt,libraryValidUntil) && clock.now()-librarySavedAt<LIBRARY_FRESH_MS;}
            if(restored)notifyFavoriteCatalogs(auth,source,b.scope());
            if(!fresh && fetchLibrary(auth,b,source,true,epoch))notifyFavoriteCatalogs(auth,source,b.scope());
        }catch(Exception ignored){}finally{synchronized(lock){metadataRefreshes.remove(key);}}});}
        catch(RejectedExecutionException ignored){synchronized(lock){metadataRefreshes.remove(key);}}
    }
    private void notifyFavoriteCatalogs(long auth,long source,String scope){List<Catalog> snapshots;synchronized(lock){if(catalogObservers.isEmpty())return;snapshots=new ArrayList<>(catalogs.values());}for(Catalog snapshot:snapshots)publishPolicyCatalog(snapshot,auth,source,scope);}
    private Set<String> libraryRefs(JSONArray rows,ProviderParser.Bootstrap b,boolean episodes) throws Exception {
        Set<String> output=new HashSet<>();for(int i=0;i<rows.length();i++){
            JSONObject raw=rows.optJSONObject(i);if(raw==null || !"personal".equals(raw.opt("source")) || !b.sourceVersion.equals(raw.opt("sourceVersion")))continue;
            Kind kind;try{kind=Kind.valueOf(raw.optString("kind").toUpperCase(Locale.ROOT));}catch(IllegalArgumentException ignored){continue;}
            if(episodes!=(kind==Kind.EPISODE))continue;String id=ProviderParser.id(raw.opt("id")),parent=kind==Kind.EPISODE?ProviderParser.id(raw.opt("seriesId")):"";
            if(id.isEmpty() || (kind==Kind.EPISODE && parent.isEmpty()) || (kind!=Kind.EPISODE && raw.has("seriesId")))continue;
            output.add(kind.name()+":"+parent+":"+id);
        }return output;
    }
    @Override public void favorites(Callback<List<Item>> callback) {
        enqueuePrepared("favorites",true,new Callback<List<Item>>(){public void onResult(List<Item> value){if(callback!=null)callback.onResult(value);refreshLibraryIfStale();}public void onError(Failure failure){if(callback!=null)callback.onError(failure);}},auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);long source=guard.generation();
            return new Prepared<>(favoriteAuth->{
                active(favoriteAuth,source,b.scope());library(favoriteAuth,b,false);rebuildFavorites();Set<String> wanted;Map<String,Item> resolved;
                synchronized(lock){wanted=new HashSet<>(favoriteRefs);resolved=resolvedFavorites;}
                for(Kind kind:new Kind[]{Kind.LIVE,Kind.MOVIE,Kind.SERIES}){
                    boolean needed=false;
                    for(String key:wanted){
                        if(!key.startsWith(kind.name()+":") || resolved.containsKey(key))continue;
                        if(kind==Kind.LIVE && b.livePolicy!=null && b.livePolicy.excludedIds.contains(key.substring(key.lastIndexOf(':')+1)))continue;
                        needed=true;break;
                    }
                    if(needed)catalogFor(favoriteAuth,b,kind,false);
                }
                rebuildFavorites();persistLibrary(favoriteAuth,b,source);synchronized(lock){return favoriteItems;}
            },source,b.scope());
        },false,null,this::memoryFavorites);
    }
    @Override public void toggleFavorite(Item candidate,Callback<Boolean> callback) {
        enqueue("favorite-toggle-"+(candidate==null?"":candidate.key()),true,callback,auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);if(candidate==null || candidate.kind==Kind.EPISODE)throw new ProviderParser.Invalid();ProviderParser.reference(candidate,b.scope());
            Catalog catalog=catalogFor(auth,b,candidate.kind,false);
            Item item=candidate.kind==Kind.LIVE?resolveLiveItem(catalog,candidate.id):find(catalog,candidate.id);if(item==null)throw new ProviderParser.Invalid();library(auth,b,false);
            List<Item> stored;if(item.kind==Kind.LIVE)stored=savedLiveAliases(item);else synchronized(lock){stored=favoriteRefs.contains(refKey(item))?Collections.singletonList(item):Collections.emptyList();}
            long source=guard.generation();
            if(!stored.isEmpty()) {
                for(Item original:stored) {
                    active(auth,source,b.scope());JSONObject accepted=ProviderParser.object(api("/me/personal-library/favorites","DELETE",new JSONObject().put("ref",ProviderParser.reference(original,b.scope())),auth));if(!accepted.optBoolean("ok"))throw new ProviderParser.Invalid();
                    synchronized(lock){active(auth,source,b.scope());favoriteRefs.remove(refKey(original));libraryEpoch++;librarySavedAt=clock.now();}
                }
                rebuildFavorites();persistLibrary(auth,b,source);return false;
            }
            JSONObject accepted=ProviderParser.object(api("/me/personal-library/favorites","PUT",new JSONObject().put("ref",ProviderParser.reference(item,b.scope())),auth));if(!accepted.optBoolean("ok"))throw new ProviderParser.Invalid();
            synchronized(lock){active(auth,source,b.scope());favoriteRefs.add(refKey(item));libraryEpoch++;librarySavedAt=clock.now();}rebuildFavorites();persistLibrary(auth,b,source);return true;
        });
    }
    @Override public void markWatched(Item episode) {
        if(episode==null || episode.kind!=Kind.EPISODE)return;
        enqueue("watched-"+episode.seriesId+":"+episode.id,true,null,auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);ProviderParser.reference(episode,b.scope());
            Item parent=new Item(Kind.SERIES,episode.seriesId,"","","","","",b.scope(),"",0,0,"");
            SeriesDetail detail=seriesFor(auth,b,parent,false);Item verified=null;for(Season season:detail.seasons)for(Item e:season.episodes)if(e.id.equals(episode.id))verified=e;
            if(verified==null)throw new ProviderParser.Invalid();long source=guard.generation();
            JSONObject accepted=ProviderParser.object(api("/me/personal-library/watched","PUT",new JSONObject().put("ref",ProviderParser.reference(verified,b.scope())),auth));if(!accepted.optBoolean("ok"))throw new ProviderParser.Invalid();active(auth,source,b.scope());synchronized(lock){active(auth,source,b.scope());watchedRefs.add(refKey(verified));libraryEpoch++;librarySavedAt=clock.now();}persistLibrary(auth,b,source);return Boolean.TRUE;
        });
    }
    private String positionKey(Item item) {
        if(item==null || item.kind==Kind.LIVE || item.kind==Kind.SERIES || !item.scope.equals(currentScope()))return "";
        try {
            ProviderParser.reference(item,currentScope());byte[] hash=MessageDigest.getInstance("SHA-256").digest((item.scope+":"+refKey(item)).getBytes(StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte b:hash)result.append(String.format(Locale.ROOT,"%02x",b&255));return result.toString();
        }catch(Exception ignored){return "";}
    }
    @Override public long resumePosition(Item item) {
        String key=positionKey(item);if(key.isEmpty())return 0;return Math.max(0,positions.getLong(key,0));
    }
    @Override public void savePosition(Item item,long positionMs,long durationMs) {
        String key=positionKey(item);if(key.isEmpty() || positionMs<0 || durationMs<=0)return;
        long value=positionMs>=durationMs-15000 || positionMs>=durationMs*.95?0:Math.min(positionMs,durationMs);
        SharedPreferences.Editor edit=positions.edit(); if(value==0)edit.remove(key).remove(key+".time");else edit.putLong(key,value).putLong(key+".time",clock.now());
        Map<String,?> all=positions.getAll();if(all.size()>4000){String oldest=null;long time=Long.MAX_VALUE;for(Map.Entry<String,?> entry:all.entrySet())if(entry.getKey().endsWith(".time") && entry.getValue() instanceof Long && (Long)entry.getValue()<time){time=(Long)entry.getValue();oldest=entry.getKey().substring(0,entry.getKey().length()-5);}if(oldest!=null)edit.remove(oldest).remove(oldest+".time");}
        edit.apply();
    }
    private static final class ResponseProblem extends java.io.IOException{final Problem problem;ResponseProblem(Problem problem){this.problem=problem;}}
    private interface ResponseReader<T>{T read(InputStream input)throws Exception;}
    private Object readJson(InputStream input)throws Exception{
        try(ByteArrayOutputStream output=new ByteArrayOutputStream(8192)){
            byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
            return ProviderParser.parseJson(json);
        }
    }
    private Object request(String url,String method,JSONObject body,String bearer,long auth,long source,String scope) throws Exception {return request(url,method,body,bearer,auth,source,scope,this::readJson);}
    private <T>T request(String url,String method,JSONObject body,String bearer,long auth,long source,String scope,ResponseReader<T> reader) throws Exception{return request(url,method,body,bearer,auth,source,scope,reader,false);}
    private <T>T request(String url,String method,JSONObject body,String bearer,long auth,long source,String scope,ResponseReader<T> reader,boolean optional) throws Exception {return request(url,method,body,bearer,auth,source,scope,reader,optional,null);}
    private <T>T request(String url,String method,JSONObject body,String bearer,long auth,long source,String scope,ResponseReader<T> reader,boolean optional,CatalogDemand demand) throws Exception {
        checkAuth(auth);if(scope!=null)metadataActive(auth,source,scope,optional,demand);
        HttpURLConnection connection=null;ScheduledFuture<?> deadline=null,playbackCancellation=null;
        try {
            URL target=new URL(url);if(!"https".equals(target.getProtocol()) || target.getUserInfo()!=null)throw new ProviderParser.Invalid();
            connection=connectionFactory.open(target);connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(TIMEOUT_MS);connection.setReadTimeout(TIMEOUT_MS);connection.setUseCaches(false);connection.setRequestMethod(method);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Cache-Control","no-store");connection.setRequestProperty("Cookie","");connection.setRequestProperty("Referer","");
            if(bearer!=null)connection.setRequestProperty("Authorization","Bearer "+bearer);
            synchronized(lock){checkAuth(auth);connections.add(connection);}
            HttpURLConnection timed=connection;deadline=timeout.schedule(timed::disconnect,TIMEOUT_MS,TimeUnit.MILLISECONDS);
            if(optional)playbackCancellation=timeout.scheduleWithFixedDelay(()->{if(!optionalWorkAllowed(demand))timed.disconnect();},100,100,TimeUnit.MILLISECONDS);
            long started=System.nanoTime();
            if(body!=null){byte[] encoded=body.toString().getBytes(StandardCharsets.UTF_8);if(encoded.length>65536)throw new ProviderParser.Invalid();connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setFixedLengthStreamingMode(encoded.length);try(OutputStream out=connection.getOutputStream()){out.write(encoded);}}
            int status=connection.getResponseCode();checkAuth(auth);if(scope!=null)metadataActive(auth,source,scope,optional,demand);
            if(status==401)throw new Problem(Failure.Code.AUTH);if(status==403)throw new Problem(Failure.Code.INELIGIBLE);if(status==409 || status==429)throw new Problem(Failure.Code.LIMIT);if(status<200 || status>=300)throw new Problem(Failure.Code.NETWORK);
            long contentLength=-1;String lengthHeader=connection.getHeaderField("Content-Length");if(lengthHeader!=null){try{contentLength=Long.parseLong(lengthHeader);}catch(NumberFormatException ignored){throw new ProviderParser.Invalid();}}if(contentLength>MAX_BYTES)throw new Problem(Failure.Code.LIMIT);
            try(InputStream raw=connection.getInputStream()){
                InputStream input=new FilterInputStream(raw){
                    private long total;
                    private void checked(int count)throws java.io.IOException{
                        try{checkAuth(auth);if(scope!=null)metadataActive(auth,source,scope,optional,demand);if(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)>=TIMEOUT_MS)throw new Problem(Failure.Code.NETWORK);if(count>0 && (total+=count)>MAX_BYTES)throw new Problem(Failure.Code.LIMIT);}
                        catch(Problem issue){throw new ResponseProblem(issue);}
                    }
                    @Override public int read()throws java.io.IOException{checked(0);int value=in.read();checked(value<0?0:1);return value;}
                    @Override public int read(byte[] bytes,int offset,int length)throws java.io.IOException{checked(0);int count=in.read(bytes,offset,length);checked(count);return count;}
                };
                T value=reader.read(input);checkAuth(auth);if(scope!=null)metadataActive(auth,source,scope,optional,demand);return value;
            }
        }catch(ResponseProblem response){throw response.problem;}
        catch(Problem | ProviderParser.Invalid known){throw known;}
        catch(Exception ignored){checkAuth(auth);if(scope!=null)active(auth,source,scope);throw new Problem(Failure.Code.NETWORK);}
        finally{if(deadline!=null)deadline.cancel(false);if(playbackCancellation!=null)playbackCancellation.cancel(false);if(connection!=null){synchronized(lock){connections.remove(connection);}connection.disconnect();}}
    }
}
