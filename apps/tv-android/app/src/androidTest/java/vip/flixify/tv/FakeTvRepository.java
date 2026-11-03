package vip.flixify.tv;

import java.util.*;
import vip.flixify.tv.TvModels.*;

/** Entirely offline account/catalog fixture. No provider or media connection is opened. */
final class FakeTvRepository implements TvRepository {
    boolean session;
    DeviceLogin.Attempt pairingAttempt;
    int pairingStarts;
    @Override public void startDeviceLogin(Callback<DeviceLogin.Attempt> callback){pairingStarts++;if(pairingAttempt!=null)callback.onResult(pairingAttempt);else callback.onError(new Failure(Failure.Code.NETWORK,"Offline fixture"));}
    String accountId="fixture-account";
    WelcomeOffer welcome=WelcomeOffer.notEligible();
    boolean delayWelcome,delayWelcomeChoice,failWelcome,failWelcomeChoice;
    int welcomeRequests,welcomeChoices,catalogRequests;
    String lastWelcomeChoice;
    Callback<WelcomeOffer> delayedWelcome,delayedWelcomeChoice;
    @Override public String currentAccountId(){return session?accountId:"";}
    @Override public void welcomeOffer(Callback<WelcomeOffer> callback){welcomeRequests++;if(delayWelcome){delayedWelcome=callback;return;}if(failWelcome){callback.onError(new Failure(Failure.Code.NETWORK,"Offline fixture"));return;}callback.onResult(welcome);}
    @Override public void chooseWelcomeOffer(String choice,Callback<WelcomeOffer> callback){welcomeChoices++;lastWelcomeChoice=choice;if(delayWelcomeChoice){delayedWelcomeChoice=callback;return;}if(failWelcomeChoice){callback.onError(new Failure(Failure.Code.NETWORK,"Offline fixture"));return;}welcome=new WelcomeOffer("dismissed",true,11955,12677,1675);callback.onResult(welcome);}
    void releaseWelcome(){Callback<WelcomeOffer> callback=delayedWelcome;delayedWelcome=null;delayWelcome=false;if(callback!=null)callback.onResult(welcome);}
    void releaseWelcomeChoice(){Callback<WelcomeOffer> callback=delayedWelcomeChoice;delayedWelcomeChoice=null;delayWelcomeChoice=false;if(callback!=null){welcome=new WelcomeOffer("dismissed",true,11955,12677,1675);callback.onResult(welcome);}}
    int preparationRequests;
    Kind retainedOnTrim;
    int trimRequests;
    @Override public void trimMemory(Kind keep){retainedOnTrim=keep;trimRequests++;}
    @Override public void prepareOfflineData(){preparationRequests++;}
    Account accountOverride;
    Failure.Code catalogFailureCode=Failure.Code.NETWORK;
    boolean delayAccess;
    Callback<Account> delayedAccess;
    boolean failPackages,failAccess,expireAuth,delayPackages;
    Callback<List<PackagePlan>> delayedPackages;
    void releasePackages(){Callback<List<PackagePlan>> cb=delayedPackages;delayedPackages=null;delayPackages=false;if(cb!=null)packages(cb);}
    public void packages(Callback<List<PackagePlan>> cb){if(delayPackages){delayedPackages=cb;return;}if(failPackages){cb.onError(new Failure(Failure.Code.NETWORK,"Offline fixture"));return;}List<PackagePlan> plans=new ArrayList<>();for(int users:new int[]{1,2})for(int months:new int[]{1,6,12})plans.add(new PackagePlan(PackagePlan.slug(months,users),months,users,(users==1?(months==1?"250 ₺":months==6?"699 ₺":"999 ₺"):(months==1?"399 ₺":months==6?"999 ₺":"1.399 ₺"))));cb.onResult(plans);}
    boolean revokeCatalog;
    int accessRequests;
    boolean failCatalog;
    boolean delayFavorites;
    Callback<List<Item>> delayedFavorites;
    boolean failAccount;
    boolean delayAccount;
    Callback<Account> delayedAccount;
    boolean delayCatalog;
    boolean bootstrapOnCatalog;
    boolean bootstrapped=true;
    boolean lastCatalogForced;
    CatalogObserver catalogObserver;
    Callback<Catalog> delayedCatalog;
    final Set<String> saved = new HashSet<>();
    String scope = "fixture-account:fixture-source";
    final Map<Kind,Catalog> catalogOverrides=new EnumMap<>(Kind.class);
    final Item movie = item(Kind.MOVIE,"101","Uzay Yolculuğu","1","Bilim Kurgu","",0,0);
    final Item movie2 = item(Kind.MOVIE,"102","Sessiz Deniz","2","Drama","",0,0);
    final Item show = item(Kind.SERIES,"201","Yıldız Günlükleri","3","Macera","",0,0);
    final Item episode = item(Kind.EPISODE,"301","İlk Görev","3","Macera","201",1,1);
    final Item episode2 = item(Kind.EPISODE,"302","Dönüş","3","Macera","201",2,1);
    final Item live = item(Kind.LIVE,"401","Örnek TV","4","Genel","",0,0);
    private Item item(Kind k,String id,String title,String category,String categoryName,String series,int season,int episode) {
        return new Item(k,id,title,category,categoryName,"","mp4",scope,series,season,episode,"Çevrimdışı test açıklaması");
    }
    private Account user() { if(accountOverride!=null)return accountOverride;return new Account("fixture-account","1234","Test Paketi",1893456000000L,true,false,"Hesabınız aktif"); }
    public boolean hasSession() { return session; }
    public String currentScope() { return session && bootstrapped ? scope : ""; }
    public void login(String code,Callback<Account> cb) {
        if (!"1234567890123456".equals(code)) { cb.onError(new Failure(Failure.Code.AUTH,"Kod geçersiz")); return; }
        session=true; cb.onResult(user());
    }
    public void account(boolean force,Callback<Account> cb) {
        if(delayAccount){delayedAccount=cb;return;}
        if(failAccount){cb.onError(new Failure(Failure.Code.NETWORK,"Hesap bilgisi alınamadı"));return;}
        cb.onResult(user());
    }
    void releaseDelayedAccount() {
        Callback<Account> cb=delayedAccount;delayedAccount=null;delayAccount=false;
        if(cb!=null)account(true,cb);
    }
    public void refreshAccess(Callback<Account> cb) { accessRequests++; if(expireAuth){session=false;cb.onError(new Failure(Failure.Code.AUTH,"Oturumun sona erdi."));return;}if(failAccess){cb.onError(new Failure(Failure.Code.NETWORK,"Offline fixture"));return;} if(delayAccess){delayedAccess=cb;return;}cb.onResult(user()); }
    void releaseAccess(){Callback<Account> cb=delayedAccess;delayedAccess=null;delayAccess=false;if(cb!=null)cb.onResult(user());}
    public AutoCloseable observeCatalog(CatalogObserver observer) {
        catalogObserver=observer;
        return ()->{if(catalogObserver==observer)catalogObserver=null;};
    }
    void publishCatalog(Catalog catalog) {catalogOverrides.put(catalog.kind,catalog);if(catalogObserver!=null)catalogObserver.onCatalog(catalog);}
    public void catalog(Kind kind,boolean force,Callback<Catalog> cb) {
        catalogRequests++;
        if(revokeCatalog){scope="";cb.onError(new Failure(Failure.Code.STALE,"Revoked fixture lease"));return;}
        lastCatalogForced=force;
        if(bootstrapOnCatalog)bootstrapped=true;
        if (delayCatalog) { delayedCatalog=cb; return; }
        if (failCatalog) { cb.onError(new Failure(catalogFailureCode,"Bağlantı kurulamadı")); return; }
        if(catalogOverrides.containsKey(kind)){cb.onResult(catalogOverrides.get(kind));return;}
        List<Item> rows = kind==Kind.SERIES?Arrays.asList(show):kind==Kind.LIVE?Arrays.asList(live):Arrays.asList(movie,movie2);
        List<Category> categories = kind==Kind.MOVIE?Arrays.asList(new Category("1","Bilim Kurgu"),new Category("2","Drama")):Arrays.asList(new Category(rows.get(0).categoryId,rows.get(0).categoryName));
        cb.onResult(new Catalog(kind,rows,categories));
    }
    void releaseDelayedCatalog() {
        Callback<Catalog> cb=delayedCatalog; delayedCatalog=null; delayCatalog=false;
        if (cb!=null) cb.onResult(new Catalog(Kind.MOVIE,Arrays.asList(movie,movie2),Arrays.asList(new Category("1","Bilim Kurgu"),new Category("2","Drama"))));
    }
    public void series(Item item,Callback<SeriesDetail> cb) { cb.onResult(new SeriesDetail(show,Arrays.asList(new Season(1,Arrays.asList(episode)),new Season(2,Arrays.asList(episode2))))); }
    public void startingEpisode(Item item,Callback<Item> cb) { cb.onResult(episode); }
    public void favorites(Callback<List<Item>> cb) {
        if(delayFavorites){delayedFavorites=cb;return;}
        List<Item> rows=new ArrayList<>();
        for(Kind kind:new Kind[]{Kind.MOVIE,Kind.SERIES,Kind.LIVE}){
            List<Item> source=catalogOverrides.containsKey(kind)?catalogOverrides.get(kind).items:kind==Kind.MOVIE?Arrays.asList(movie,movie2):kind==Kind.SERIES?Arrays.asList(show):Arrays.asList(live);
            for(Item item:source)if(saved.contains(item.key()))rows.add(item);
        }
        cb.onResult(rows);
    }
    public boolean isFavorite(Item item) { return saved.contains(item.key()); }
    public void toggleFavorite(Item item,Callback<Boolean> cb) { if(!saved.remove(item.key()))saved.add(item.key()); cb.onResult(saved.contains(item.key())); }
    public void playback(Item item,Callback<Playback> cb) { cb.onError(new Failure(Failure.Code.INVALID,"Bu test medya oynatmaz")); }
    public void epg(Item item,Callback<List<Programme>> cb) { cb.onResult(Arrays.asList(new Programme("Örnek Yayın",1700000000000L,1700003600000L))); }
    public void markWatched(Item item) {}
    public void savePosition(Item item,long p,long d) {}
    public long resumePosition(Item item) { return 0; }
    public void logout() { session=false; saved.clear(); }
}
