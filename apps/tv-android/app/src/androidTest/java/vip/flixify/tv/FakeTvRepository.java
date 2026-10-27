package vip.flixify.tv;

import java.util.*;
import vip.flixify.tv.TvModels.*;

/** Entirely offline account/catalog fixture. No provider or media connection is opened. */
final class FakeTvRepository implements TvRepository {
    boolean session;
    boolean failCatalog;
    boolean delayCatalog;
    boolean bootstrapOnCatalog;
    boolean bootstrapped=true;
    Callback<Catalog> delayedCatalog;
    final Set<String> saved = new HashSet<>();
    final String scope = "fixture-account:fixture-source";
    final Item movie = item(Kind.MOVIE,"101","Uzay Yolculuğu","1","Bilim Kurgu","",0,0);
    final Item movie2 = item(Kind.MOVIE,"102","Sessiz Deniz","2","Drama","",0,0);
    final Item show = item(Kind.SERIES,"201","Yıldız Günlükleri","3","Macera","",0,0);
    final Item episode = item(Kind.EPISODE,"301","İlk Görev","3","Macera","201",1,1);
    final Item episode2 = item(Kind.EPISODE,"302","Dönüş","3","Macera","201",2,1);
    final Item live = item(Kind.LIVE,"401","Örnek TV","4","Genel","",0,0);
    private Item item(Kind k,String id,String title,String category,String categoryName,String series,int season,int episode) {
        return new Item(k,id,title,category,categoryName,"","mp4",scope,series,season,episode,"Çevrimdışı test açıklaması");
    }
    private Account user() { return new Account("fixture-account","1234","Test Paketi",1893456000000L,true,false,"Hesabınız aktif"); }
    public boolean hasSession() { return session; }
    public String currentScope() { return session && bootstrapped ? scope : ""; }
    public void login(String code,Callback<Account> cb) {
        if (!"1234567890123456".equals(code)) { cb.onError(new Failure(Failure.Code.AUTH,"Kod geçersiz")); return; }
        session=true; cb.onResult(user());
    }
    public void account(boolean force,Callback<Account> cb) { cb.onResult(user()); }
    public void refreshAccess(Callback<Account> cb) { cb.onResult(user()); }
    public void catalog(Kind kind,boolean force,Callback<Catalog> cb) {
        if(bootstrapOnCatalog)bootstrapped=true;
        if (delayCatalog) { delayedCatalog=cb; return; }
        if (failCatalog) { cb.onError(new Failure(Failure.Code.NETWORK,"Bağlantı kurulamadı")); return; }
        List<Item> rows = kind==Kind.SERIES?Arrays.asList(show):kind==Kind.LIVE?Arrays.asList(live):Arrays.asList(movie,movie2);
        List<Category> categories = kind==Kind.MOVIE?Arrays.asList(new Category("1","Bilim Kurgu"),new Category("2","Drama")):Arrays.asList(new Category(rows.get(0).categoryId,rows.get(0).categoryName));
        cb.onResult(new Catalog(kind,rows,categories));
    }
    void releaseDelayedCatalog() {
        Callback<Catalog> cb=delayedCatalog; delayedCatalog=null; delayCatalog=false;
        if (cb!=null) cb.onResult(new Catalog(Kind.MOVIE,Arrays.asList(movie,movie2),Arrays.asList(new Category("1","Bilim Kurgu"),new Category("2","Drama"))));
    }
    public void series(Item item,Callback<SeriesDetail> cb) { cb.onResult(new SeriesDetail(show,Arrays.asList(new Season(1,Arrays.asList(episode)),new Season(2,Arrays.asList(episode2))))); }
    public void favorites(Callback<List<Item>> cb) {
        List<Item> rows=new ArrayList<>(); for (Item i:Arrays.asList(movie,movie2,show,live)) if(saved.contains(i.key()))rows.add(i); cb.onResult(rows);
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
