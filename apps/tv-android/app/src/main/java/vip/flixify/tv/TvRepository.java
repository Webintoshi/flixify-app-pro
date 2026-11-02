package vip.flixify.tv;

import java.util.List;
import vip.flixify.tv.TvModels.*;

/** All callbacks run on the main thread. Stale account/source callbacks must fail STALE. */
public interface TvRepository {
    interface Callback<T> { void onResult(T value); void onError(Failure failure); }
    interface CatalogObserver {void onCatalog(Catalog catalog);}
    default AutoCloseable observeCatalog(CatalogObserver observer) {return ()->{};}
    /** Bounded metadata preparation; never downloads media or delays navigation. */
    default void prepareOfflineData() {}
    /** Releases memory, retaining only a visible catalogue and private disk snapshots. */
    default void trimMemory(Kind keep) {}
    default String currentAccountId(){return currentScope();}
    default void welcomeOffer(Callback<WelcomeOffer> callback){callback.onResult(WelcomeOffer.notEligible());}
    default void chooseWelcomeOffer(String choice,Callback<WelcomeOffer> callback){callback.onError(new Failure(Failure.Code.INVALID,"Seçimin kaydedilemedi. Tekrar dene."));}
    default void packages(Callback<List<PackagePlan>> callback){callback.onError(new Failure(Failure.Code.NETWORK,"Paketler yüklenemedi."));}
    boolean hasSession();
    String currentScope();
    void login(String code,Callback<Account> callback);
    void account(boolean force,Callback<Account> callback);
    void refreshAccess(Callback<Account> callback);
    void catalog(Kind kind,boolean force,Callback<Catalog> callback);
    /** Home shelves may yield provider-only work when a player opens. */
    default void homeCatalog(Kind kind,boolean force,Callback<Catalog> callback){catalog(kind,force,callback);}
    void series(Item series,Callback<SeriesDetail> callback);
    /** Latest resumable episode, then first unwatched; completed series restart at the first episode. */
    void startingEpisode(Item series,Callback<Item> callback);
    void favorites(Callback<List<Item>> callback);
    boolean isFavorite(Item item);
    void toggleFavorite(Item item,Callback<Boolean> callback);
    void playback(Item item,Callback<Playback> callback);
    void epg(Item live,Callback<List<Programme>> callback);
    void markWatched(Item episode);
    void savePosition(Item item,long positionMs,long durationMs);
    long resumePosition(Item item);
    void logout();
}
