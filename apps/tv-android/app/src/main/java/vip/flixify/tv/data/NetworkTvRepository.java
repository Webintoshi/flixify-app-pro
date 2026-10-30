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
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.TvRepository;
import vip.flixify.tv.BackgroundWorkGate;

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
    private final ThreadPoolExecutor metadataWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4),r->{Thread t=new Thread(r,"flixify-catalog-refresh");t.setDaemon(true);return t;});
    private final ScheduledExecutorService timeout=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"flixify-request-deadline");t.setDaemon(true);return t;});
    interface Clock { long now(); }
    interface ConnectionFactory { HttpURLConnection open(URL url) throws Exception; }
    private final Clock clock;
    private final ConnectionFactory connectionFactory;
    private final java.util.concurrent.Executor callbacks;
    private final TokenStore tokenStore;
    private final SharedPreferences positions;
    private final MetadataDiskCache metadataDisk;
    private final SourceGuard guard=new SourceGuard();
    private volatile TokenStore.Session tokens;
    private volatile Account currentAccount;
    private volatile long accountCheckedAt, bootstrapCheckedAt;
    private long authGeneration;
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
    private Runnable refreshTimer, expiryTimer;

    public NetworkTvRepository(Context context) { this(context,null,null,null); }
    NetworkTvRepository(Context context,ConnectionFactory connectionFactory,Clock clock,java.util.concurrent.Executor callbacks) {
        this.connectionFactory=connectionFactory==null?url->(HttpURLConnection)url.openConnection():connectionFactory;
        this.clock=clock==null?System::currentTimeMillis:clock;
        this.callbacks=callbacks==null?main::post:callbacks;
        Context app=context.getApplicationContext(); tokenStore=new TokenStore(app);
        positions=app.getSharedPreferences("tv_scoped_resume",Context.MODE_PRIVATE);
        metadataDisk=new MetadataDiskCache(new java.io.File(app.getFilesDir(),"catalog-cache-v1"));
        tokens=tokenStore.load(); worker.allowCoreThreadTimeOut(true);epgWorker.allowCoreThreadTimeOut(true);metadataWorker.allowCoreThreadTimeOut(true);
    }
    @Override public boolean hasSession() { return tokens!=null; }
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
    private static final class Pending<T> {
        final long auth; final String scope; final boolean sourceBound; final List<Callback<T>> callbacks=new ArrayList<>();
        Pending(long auth,String scope,boolean sourceBound) {this.auth=auth;this.scope=scope;this.sourceBound=sourceBound;}
    }
    private static final class Prepared<T> {
        final Work<T> work; final long source; final String scope;
        Prepared(Work<T> work,long source,String scope) {this.work=work;this.source=source;this.scope=scope;}
    }
    private interface Preparation<T> { Prepared<T> run(long auth) throws Exception; }
    private <T> void enqueue(String name,boolean sourceBound,Callback<T> callback,Work<T> work) {
        enqueuePrepared(name,sourceBound,callback,auth->new Prepared<>(work,-1,null),false);
    }
    private <T> void enqueuePrepared(String name,boolean sourceBound,Callback<T> callback,Preparation<T> preparation,boolean optional) {
        final Pending<T> operation; final String key;
        synchronized(lock) {
            String scope=currentScope(); key=name+"@"+authGeneration+"@"+scope;
            @SuppressWarnings("unchecked") Pending<T> existing=(Pending<T>)pending.get(key);
            if(existing!=null) {
                if(callback!=null) { if(existing.callbacks.size()>=64) { callbacks.execute(()->callback.onError(failure(new Problem(Failure.Code.LIMIT))));return; } existing.callbacks.add(callback); } return;
            }
            operation=new Pending<>(authGeneration,scope,sourceBound); if(callback!=null) operation.callbacks.add(callback); pending.put(key,operation);
        }
        try { worker.execute(()->{
            try {
                checkAuth(operation.auth);Prepared<T> prepared=preparation.run(operation.auth);checkAuth(operation.auth);
                Runnable request=()->runPrepared(key,operation,prepared);
                if(optional)epgWorker.execute(request);else request.run();
            } catch(RejectedExecutionException rejected) {complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),-1,null);}
            catch(Exception error) {complete(key,operation,null,failure(error),-1,null);}
        }); } catch(RejectedExecutionException ignored) {
            complete(key,operation,null,failure(new Problem(Failure.Code.LIMIT)),-1,null);
        }
    }
    private <T> void runPrepared(String key,Pending<T> operation,Prepared<T> prepared) {
        T value=null;Failure issue=null;
        try {checkAuth(operation.auth);value=prepared.work.run(operation.auth);checkAuth(operation.auth);}
        catch(Exception error) {issue=failure(error);}
        complete(key,operation,value,issue,prepared.source,prepared.scope);
    }
    private <T> void complete(String key,Pending<T> operation,T value,Failure issue,long preparedSource,String preparedScope) {
        final String completedScope;final long completedSource;
        synchronized(lock) {
            // An optional result retains the lease captured before its I/O, even if bootstrap changed meanwhile.
            completedScope=preparedScope==null?currentScope():preparedScope;
            completedSource=preparedScope==null?guard.generation():preparedSource;
        }
        callbacks.execute(()->{
            List<Callback<T>> deliveries;
            synchronized(lock) {if(pending.get(key)==operation)pending.remove(key);deliveries=new ArrayList<>(operation.callbacks);}
            for(Callback<T> cb:deliveries) {
                Failure delivered=issue;
                synchronized(lock) {
                    boolean playableAccount=value instanceof Account && ((Account)value).canPlay;
                    boolean needsLease=operation.sourceBound || playableAccount;
                    boolean wrongInitialSource=operation.sourceBound && !operation.scope.isEmpty() && !operation.scope.equals(currentScope());
                    boolean wrongPreparedSource=preparedScope!=null && (completedSource!=guard.generation() || !completedScope.equals(currentScope()));
                    boolean inactiveResult=issue==null && needsLease && (!guard.active(completedSource,completedScope,clock.now()) || (playableAccount && ((Account)value).expiresAtMs<=clock.now()));
                    if(operation.auth!=authGeneration || wrongInitialSource || wrongPreparedSource || inactiveResult)delivered=failure(new Problem(Failure.Code.STALE));
                }
                if(delivered==null)cb.onResult(value);else cb.onError(delivered);
            }
        });
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
    @Override public void account(boolean force,Callback<Account> callback) {
        enqueue(force?"access-refresh":"account",false,callback,auth->loadAccount(auth,force));
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
        boolean eligible=!"blocked".equals(user.optString("status")) && user.optBoolean("hasAssignedLink") && user.optBoolean("hasActiveSubscription") && appExpiry>now;
        String suffix=ProviderParser.text(user.opt("codeSuffix"),16); if(suffix.isEmpty())suffix=t.codeSuffix;
        if(suffix.length()>4)suffix=suffix.substring(suffix.length()-4);
        String message=eligible?"İzleme erişimin açık.":"blocked".equals(user.optString("status"))?"Hesabın için destek ekibimizle iletişime geç.":!user.optBoolean("hasAssignedLink")?"İçerik bağlantın henüz hazır değil.":"Aktif izleme erişimin bulunmuyor.";
        Account account=new Account(id,suffix,title,appExpiry,false,trial,message);
        if(eligible) {
            try {
                ProviderParser.Bootstrap b=bootstrap(auth,force);
                if(!b.accountId.equals(id)) { clearProvider();throw new Problem(Failure.Code.STALE); }
                account=new Account(id,suffix,title,b.expiresAtMs,true,trial,message);
            } catch(Problem issue) {
                if(issue.code==Failure.Code.INELIGIBLE) account=new Account(id,suffix,title,0,false,trial,"İzleme erişimin şu anda açık değil.");
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
        synchronized(lock) {
            checkAuth(auth);
            if(!incoming.sameIdentity(old)) clearMetadataLocked();
            guard.install(incoming);bootstrapCheckedAt=clock.now();scheduleAccessLocked(auth,incoming);
        }
        if(old!=null && !incoming.sameIdentity(old))metadataDisk.clear();
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
    private void clearMetadataLocked() { catalogs.clear();catalogSavedAt.clear();catalogValidUntil.clear();catalogFetches.clear();foregroundCatalogFetches.clear();details.clear();detailSavedAt.clear();detailValidUntil.clear();detailFetches.clear();foregroundDetailFetches.clear();metadataRefreshes.clear();favoriteRefs.clear();watchedRefs.clear();libraryScope=""; }
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
            guard.clear();bootstrapCheckedAt=0;clearMetadataLocked();
            Account previous=currentAccount;if(previous!=null && previous.canPlay)currentAccount=new Account(previous.id,previous.codeSuffix,previous.packageTitle,previous.expiresAtMs,false,previous.trial,"İzleme erişimin şu anda açık değil.");
            accountCheckedAt=0;
            if(refreshTimer!=null)main.removeCallbacks(refreshTimer);if(expiryTimer!=null)main.removeCallbacks(expiryTimer);
            refreshTimer=null;expiryTimer=null;cancel=new ArrayList<>(connections);
        }
        metadataDisk.clear();
        for(HttpURLConnection connection:cancel)connection.disconnect();
    }
    private void clearSession() {
        synchronized(lock) {authGeneration++;tokens=null;currentAccount=null;accountCheckedAt=0;tokenStore.clear();}
        clearProvider();
    }
    private void revokeAuth(long auth) { synchronized(lock) { if(auth==authGeneration) {tokens=null;currentAccount=null;accountCheckedAt=0;tokenStore.clear();} } clearProvider(); }
    @Override public void logout() { clearSession(); }

    @Override public void catalog(Kind kind,boolean force,Callback<Catalog> callback) {
        enqueue("catalog-"+kind+(force?"-fresh":""),true,new Callback<Catalog>() {
            @Override public void onResult(Catalog value){if(callback!=null)callback.onResult(value);if(!force)refreshCatalogIfStale(kind);}
            @Override public void onError(Failure issue){if(callback!=null)callback.onError(issue);}
        },auth->{ProviderParser.Bootstrap b=bootstrap(auth,false);library(auth,b,false);return catalogFor(auth,b,kind,force);});
    }
    @Override public AutoCloseable observeCatalog(CatalogObserver observer) {
        if(observer==null)return ()->{};
        synchronized(lock){catalogObservers.add(observer);}
        return ()->{synchronized(lock){catalogObservers.remove(observer);}};
    }
    private Catalog catalogFor(long auth,ProviderParser.Bootstrap b,Kind kind,boolean force) throws Exception {
        long source=guard.generation();active(auth,source,b.scope()); if(kind==null || kind==Kind.EPISODE)throw new ProviderParser.Invalid();
        synchronized(lock) {if(!force && catalogs.containsKey(kind) && cacheAgeValid(catalogSavedAt.get(kind),catalogValidUntil.get(kind)))return catalogs.get(kind);}
        if(!force) {
            MetadataDiskCache.Snapshot<Catalog> cached=metadataDisk.readCatalog(b.scope(),kind,b.expiresAtMs,clock.now());active(auth,source,b.scope());
            if(cached!=null){synchronized(lock){active(auth,source,b.scope());catalogs.put(kind,cached.value);catalogSavedAt.put(kind,cached.savedAt);catalogValidUntil.put(kind,cached.expiresAt);}return cached.value;}
        }
        return fetchCatalog(auth,b,source,kind,false,-1);
    }
    private Catalog fetchCatalog(long auth,ProviderParser.Bootstrap b,long source,Kind kind,boolean optional,long queuedTicket) throws Exception {
        final long ticket;
        synchronized(lock){
            metadataActive(auth,source,b.scope(),optional);Long previous=catalogFetches.get(kind);long current=previous==null?0:previous;
            if(optional && (current!=queuedTicket || foregroundCatalogFetches.containsKey(kind) || !catalogs.containsKey(kind) || !cacheStale(catalogSavedAt.get(kind))))throw new Problem(Failure.Code.STALE);
            ticket=current+1;catalogFetches.put(kind,ticket);if(!optional)foregroundCatalogFetches.put(kind,ticket);
        }
        try {
            String prefix=kind==Kind.MOVIE?"vod":kind.name().toLowerCase(Locale.ROOT);
            Object groups=provider(auth,b,source,"get_"+prefix+"_categories",null);
            catalogFetchActive(auth,source,b.scope(),kind,ticket,optional);
            Object rows=provider(auth,b,source,kind==Kind.SERIES?"get_series":"get_"+prefix+"_streams",null);
            catalogFetchActive(auth,source,b.scope(),kind,ticket,optional);
            Catalog parsed=ProviderParser.catalog(kind,rows,groups,b.scope());
            List<Item> cleaned=new ArrayList<>(); for(Item item:parsed.items)cleaned.add(safeArtwork(item,b));
            Catalog result=new Catalog(kind,cleaned,parsed.categories);active(auth,source,b.scope());
            long saved=clock.now();
            synchronized(lock) {catalogFetchActive(auth,source,b.scope(),kind,ticket,optional);catalogs.put(kind,result);catalogSavedAt.put(kind,saved);catalogValidUntil.put(kind,b.expiresAtMs);}
            metadataDisk.writeCatalog(b.scope(),b.expiresAtMs,saved,result,()->catalogWriteLease(auth,source,b.scope(),kind,ticket));
            catalogFetchActive(auth,source,b.scope(),kind,ticket,optional);if(optional)publishCatalog(result,auth,source,b.scope(),ticket);return result;
        } finally {
            if(!optional)synchronized(lock){Long current=foregroundCatalogFetches.get(kind);if(current!=null && current==ticket)foregroundCatalogFetches.remove(kind);}
        }
    }
    private void metadataActive(long auth,long source,String scope,boolean optional)throws Problem {active(auth,source,scope);if(optional && BackgroundWorkGate.isPlaybackActive())throw new Problem(Failure.Code.NETWORK);}
    private void catalogFetchActive(long auth,long source,String scope,Kind kind,long ticket,boolean optional)throws Problem{synchronized(lock){metadataActive(auth,source,scope,optional);Long current=catalogFetches.get(kind);if(current==null || current!=ticket)throw new Problem(Failure.Code.STALE);}}
    private boolean catalogWriteLease(long auth,long source,String scope,Kind kind,long ticket){try{catalogFetchActive(auth,source,scope,kind,ticket,true);return true;}catch(Problem ignored){return false;}}
    private boolean cacheAgeValid(Long saved,Long until){long now=clock.now();return saved!=null && until!=null && saved<=now && now-saved<MetadataDiskCache.MAX_AGE_MS && until>now;}
    private boolean cacheStale(Long saved){return saved==null || clock.now()-saved>=MetadataDiskCache.FRESH_MS;}
    private void refreshCatalogIfStale(Kind kind) {
        final ProviderParser.Bootstrap b;final long auth,source,queuedTicket;final String key;
        synchronized(lock){b=guard.current();if(b==null || !catalogs.containsKey(kind) || !cacheStale(catalogSavedAt.get(kind)) || BackgroundWorkGate.isPlaybackActive())return;auth=authGeneration;source=guard.generation();Long current=catalogFetches.get(kind);queuedTicket=current==null?0:current;key="catalog:"+kind+":"+auth+":"+source;if(!metadataRefreshes.add(key))return;}
        try{metadataWorker.execute(()->{try{fetchCatalog(auth,b,source,kind,true,queuedTicket);}catch(Exception ignored){}finally{synchronized(lock){metadataRefreshes.remove(key);}}});}
        catch(RejectedExecutionException ignored){synchronized(lock){metadataRefreshes.remove(key);}}
    }
    private void publishCatalog(Catalog value,long auth,long source,String scope,long ticket){
        callbacks.execute(()->{
            if(!catalogWriteLease(auth,source,scope,value.kind,ticket))return;List<CatalogObserver> observers;
            synchronized(lock){observers=new ArrayList<>(catalogObservers);}
            for(CatalogObserver observer:observers){synchronized(lock){if(!catalogObservers.contains(observer) || catalogs.get(value.kind)!=value)continue;}if(!catalogWriteLease(auth,source,scope,value.kind,ticket))return;observer.onCatalog(value);}
        });
    }
    private Item safeArtwork(Item item,ProviderParser.Bootstrap b) throws ProviderParser.Invalid {
        String art=item.artwork;
        String decoded=art;try{decoded=new java.net.URI(art).getPath();}catch(Exception ignored){art="";}
        if(art.contains(b.username) || art.contains(b.password) || art.contains(ProviderParser.encode(b.username)) || art.contains(ProviderParser.encode(b.password)) || (decoded!=null && (decoded.contains(b.username) || decoded.contains(b.password))))art="";
        return new Item(item.kind,item.id,item.title,item.categoryId,item.categoryName,art,item.extension,item.scope,item.seriesId,item.season,item.episode,item.description);
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
        Item parent=find(catalogFor(auth,b,Kind.SERIES,force),candidate.id);if(parent==null)throw new ProviderParser.Invalid();
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
            SeriesDetail parsed=ProviderParser.series(provider(auth,b,source,"get_series_info",parent.id),parent);seriesFetchActive(auth,source,b.scope(),parent.id,ticket,optional);
            List<Season> seasons=new ArrayList<>();for(Season season:parsed.seasons){List<Item> episodes=new ArrayList<>();for(Item episode:season.episodes)episodes.add(safeArtwork(episode,b));seasons.add(new Season(season.number,episodes));}
            SeriesDetail result=new SeriesDetail(safeArtwork(parsed.series,b),seasons);long saved=clock.now();
            synchronized(lock){seriesFetchActive(auth,source,b.scope(),parent.id,ticket,optional);details.put(parent.id,result);detailSavedAt.put(parent.id,saved);detailValidUntil.put(parent.id,b.expiresAtMs);trimDetailsLocked();}
            metadataDisk.writeSeries(b.scope(),b.expiresAtMs,saved,result,()->{try{seriesFetchActive(auth,source,b.scope(),parent.id,ticket,true);return true;}catch(Problem ignored){return false;}});seriesFetchActive(auth,source,b.scope(),parent.id,ticket,optional);return result;
        } finally {
            if(!optional)synchronized(lock){Long current=foregroundDetailFetches.get(parent.id);if(current!=null && current==ticket)foregroundDetailFetches.remove(parent.id);}
        }
    }
    private void seriesFetchActive(long auth,long source,String scope,String id,long ticket,boolean optional)throws Problem{synchronized(lock){metadataActive(auth,source,scope,optional);Long current=detailFetches.get(id);if(current==null || current!=ticket)throw new Problem(Failure.Code.STALE);}}
    private void trimDetailsLocked(){while(details.size()>12){String first=details.keySet().iterator().next();details.remove(first);detailSavedAt.remove(first);detailValidUntil.remove(first);}}
    private void refreshSeriesIfStale(Item parent){
        final ProviderParser.Bootstrap b;final long auth,source,queuedTicket;final String key;
        synchronized(lock){b=guard.current();if(b==null || parent==null || !parent.scope.equals(b.scope()) || !details.containsKey(parent.id) || !cacheStale(detailSavedAt.get(parent.id)) || BackgroundWorkGate.isPlaybackActive())return;auth=authGeneration;source=guard.generation();Long current=detailFetches.get(parent.id);queuedTicket=current==null?0:current;key="series:"+parent.id+":"+auth+":"+source;if(!metadataRefreshes.add(key))return;}
        try{metadataWorker.execute(()->{try{fetchSeries(auth,b,source,parent,true,queuedTicket);}catch(Exception ignored){}finally{synchronized(lock){metadataRefreshes.remove(key);}}});}catch(RejectedExecutionException ignored){synchronized(lock){metadataRefreshes.remove(key);}}
    }
    private Object provider(long auth,ProviderParser.Bootstrap b,long source,String action,String id) throws Exception {
        active(auth,source,b.scope());
        if(!java.util.Arrays.asList("get_vod_categories","get_vod_streams","get_series_categories","get_series","get_live_categories","get_live_streams","get_series_info","get_short_epg").contains(action))throw new ProviderParser.Invalid();
        String url=b.origin+"/player_api.php?username="+ProviderParser.encode(b.username)+"&password="+ProviderParser.encode(b.password)+"&action="+action;
        if("get_series_info".equals(action)||"get_short_epg".equals(action)) {if(ProviderParser.id(id).isEmpty())throw new ProviderParser.Invalid();url+=("get_series_info".equals(action)?"&series_id=":"&stream_id=")+id;}
        if("get_short_epg".equals(action))url+="&limit=24";
        try { return request(url,"GET",null,null,auth,source,b.scope()); }
        catch(Problem denied) { if(denied.code==Failure.Code.AUTH || denied.code==Failure.Code.INELIGIBLE)clearProvider(auth,source,b.scope());throw denied; }
    }
    @Override public void epg(Item live,Callback<List<Programme>> callback) {
        enqueuePrepared("epg-"+(live==null?"":live.id),true,callback,auth->{
            // Bootstrap and catalog preparation stay serialized with all API/token operations.
            ProviderParser.Bootstrap b=bootstrap(auth,false);
            if(live==null || live.kind!=Kind.LIVE)throw new ProviderParser.Invalid();ProviderParser.reference(live,b.scope());
            Item verified=find(catalogFor(auth,b,Kind.LIVE,false),live.id);if(verified==null)throw new ProviderParser.Invalid();
            long source=guard.generation();active(auth,source,b.scope());
            return new Prepared<>(optionalAuth->{
                active(optionalAuth,source,b.scope());
                List<Programme> result=ProviderParser.epg(provider(optionalAuth,b,source,"get_short_epg",verified.id));
                active(optionalAuth,source,b.scope());return result;
            },source,b.scope());
        },true);
    }
    @Override public void playback(Item candidate,Callback<Playback> callback) {
        enqueue("playback-"+(candidate==null?"":refKey(candidate)),true,callback,auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,true); if(candidate==null)throw new ProviderParser.Invalid();ProviderParser.reference(candidate,b.scope());
            Item verified=null,next=null;
            if(candidate.kind==Kind.EPISODE) {
                Item parent=new Item(Kind.SERIES,candidate.seriesId,"","","","","",b.scope(),"",0,0,"");
                SeriesDetail detail=seriesFor(auth,b,parent,true);List<Item> all=new ArrayList<>();for(Season season:detail.seasons)all.addAll(season.episodes);
                for(int i=0;i<all.size();i++)if(all.get(i).id.equals(candidate.id)){verified=all.get(i);if(i+1<all.size())next=all.get(i+1);break;}
            } else if(candidate.kind!=Kind.SERIES)verified=find(catalogFor(auth,b,candidate.kind,candidate.kind!=Kind.LIVE),candidate.id);
            if(verified==null)throw new ProviderParser.Invalid();long source=guard.generation();active(auth,source,b.scope());
            // Read the current identity's deadline: a metadata refresh can shorten or extend it.
            ProviderParser.Bootstrap current=guard.current();String url=ProviderParser.mediaUrl(current,verified,clock.now());
            String mime="m3u8".equals(verified.extension)?"application/x-mpegURL":"ts".equals(verified.extension)?"video/mp2t":"mkv".equals(verified.extension)?"video/x-matroska":"avi".equals(verified.extension)?"video/x-msvideo":"video/mp4";
            return new Playback(verified,url,mime,current.expiresAtMs,resumePosition(verified),next);
        });
    }
    private String refKey(Item item) {return item.kind.name()+":"+item.seriesId+":"+item.id;}
    @Override public boolean isFavorite(Item item) {
        synchronized(lock) {return item!=null && item.scope.equals(currentScope()) && favoriteRefs.contains(refKey(item));}
    }
    private void library(long auth,ProviderParser.Bootstrap b,boolean force) throws Exception {
        long source=guard.generation();active(auth,source,b.scope()); synchronized(lock){if(!force && libraryScope.equals(b.scope()))return;}
        JSONObject raw=ProviderParser.object(api("/me/personal-library","GET",null,auth));
        JSONArray favorites=ProviderParser.list(raw.opt("favorites"),500),watched=ProviderParser.list(raw.opt("watched"),20000);
        Set<String> newFavorites=libraryRefs(favorites,b,false),newWatched=libraryRefs(watched,b,true);active(auth,source,b.scope());
        synchronized(lock){active(auth,source,b.scope());favoriteRefs.clear();favoriteRefs.addAll(newFavorites);watchedRefs.clear();watchedRefs.addAll(newWatched);libraryScope=b.scope();}
    }
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
        enqueue("favorites",true,callback,auth->{ProviderParser.Bootstrap b=bootstrap(auth,false);library(auth,b,true);List<Item> output=new ArrayList<>();Set<String> wanted; synchronized(lock){wanted=new HashSet<>(favoriteRefs);}for(Kind kind:new Kind[]{Kind.LIVE,Kind.MOVIE,Kind.SERIES}){boolean needed=false;for(String key:wanted)if(key.startsWith(kind.name()+":")){needed=true;break;}if(needed)for(Item item:catalogFor(auth,b,kind,false).items)if(wanted.contains(refKey(item)))output.add(item);}return Collections.unmodifiableList(output);});
    }
    @Override public void toggleFavorite(Item candidate,Callback<Boolean> callback) {
        enqueue("favorite-toggle-"+(candidate==null?"":candidate.key()),true,callback,auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);if(candidate==null || candidate.kind==Kind.EPISODE)throw new ProviderParser.Invalid();ProviderParser.reference(candidate,b.scope());
            Item item=find(catalogFor(auth,b,candidate.kind,false),candidate.id);if(item==null)throw new ProviderParser.Invalid();library(auth,b,false);
            boolean old; synchronized(lock){old=favoriteRefs.contains(refKey(item));}
            long source=guard.generation();JSONObject accepted=ProviderParser.object(api("/me/personal-library/favorites",old?"DELETE":"PUT",new JSONObject().put("ref",ProviderParser.reference(item,b.scope())),auth));if(!accepted.optBoolean("ok"))throw new ProviderParser.Invalid();active(auth,source,b.scope());
            synchronized(lock){active(auth,source,b.scope());if(old)favoriteRefs.remove(refKey(item));else favoriteRefs.add(refKey(item));}return !old;
        });
    }
    @Override public void markWatched(Item episode) {
        if(episode==null || episode.kind!=Kind.EPISODE)return;
        enqueue("watched-"+episode.seriesId+":"+episode.id,true,null,auth->{
            ProviderParser.Bootstrap b=bootstrap(auth,false);ProviderParser.reference(episode,b.scope());
            Item parent=new Item(Kind.SERIES,episode.seriesId,"","","","","",b.scope(),"",0,0,"");
            SeriesDetail detail=seriesFor(auth,b,parent,false);Item verified=null;for(Season season:detail.seasons)for(Item e:season.episodes)if(e.id.equals(episode.id))verified=e;
            if(verified==null)throw new ProviderParser.Invalid();long source=guard.generation();
            JSONObject accepted=ProviderParser.object(api("/me/personal-library/watched","PUT",new JSONObject().put("ref",ProviderParser.reference(verified,b.scope())),auth));if(!accepted.optBoolean("ok"))throw new ProviderParser.Invalid();active(auth,source,b.scope());synchronized(lock){active(auth,source,b.scope());watchedRefs.add(refKey(verified));}return Boolean.TRUE;
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
    private Object request(String url,String method,JSONObject body,String bearer,long auth,long source,String scope) throws Exception {
        checkAuth(auth);if(scope!=null)active(auth,source,scope);
        HttpURLConnection connection=null;ScheduledFuture<?> deadline=null;
        try {
            URL target=new URL(url);if(!"https".equals(target.getProtocol()) || target.getUserInfo()!=null)throw new ProviderParser.Invalid();
            connection=connectionFactory.open(target);connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(TIMEOUT_MS);connection.setReadTimeout(TIMEOUT_MS);connection.setUseCaches(false);connection.setRequestMethod(method);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Cache-Control","no-store");connection.setRequestProperty("Cookie","");connection.setRequestProperty("Referer","");
            if(bearer!=null)connection.setRequestProperty("Authorization","Bearer "+bearer);
            synchronized(lock){checkAuth(auth);connections.add(connection);}
            HttpURLConnection timed=connection;deadline=timeout.schedule(timed::disconnect,TIMEOUT_MS,TimeUnit.MILLISECONDS);long started=System.nanoTime();
            if(body!=null){byte[] encoded=body.toString().getBytes(StandardCharsets.UTF_8);if(encoded.length>65536)throw new ProviderParser.Invalid();connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setFixedLengthStreamingMode(encoded.length);try(OutputStream out=connection.getOutputStream()){out.write(encoded);}}
            int status=connection.getResponseCode();checkAuth(auth);if(scope!=null)active(auth,source,scope);
            if(status==401)throw new Problem(Failure.Code.AUTH);if(status==403)throw new Problem(Failure.Code.INELIGIBLE);if(status==409 || status==429)throw new Problem(Failure.Code.LIMIT);if(status<200 || status>=300)throw new Problem(Failure.Code.NETWORK);
            long contentLength=-1;String lengthHeader=connection.getHeaderField("Content-Length");if(lengthHeader!=null){try{contentLength=Long.parseLong(lengthHeader);}catch(NumberFormatException ignored){throw new ProviderParser.Invalid();}}if(contentLength>MAX_BYTES)throw new Problem(Failure.Code.LIMIT);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream(8192)){
                byte[] buffer=new byte[16384];int count,total=0;
                while((count=input.read(buffer))!=-1){checkAuth(auth);if(scope!=null)active(auth,source,scope);if(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)>=TIMEOUT_MS)throw new Problem(Failure.Code.NETWORK);total+=count;if(total>MAX_BYTES)throw new Problem(Failure.Code.LIMIT);output.write(buffer,0,count);}
                checkAuth(auth);if(scope!=null)active(auth,source,scope);
                String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
                return ProviderParser.parseJson(json);
            }
        }catch(Problem | ProviderParser.Invalid known){throw known;}
        catch(Exception ignored){checkAuth(auth);if(scope!=null)active(auth,source,scope);throw new Problem(Failure.Code.NETWORK);}
        finally{if(deadline!=null)deadline.cancel(false);if(connection!=null){synchronized(lock){connections.remove(connection);}connection.disconnect();}}
    }
}
