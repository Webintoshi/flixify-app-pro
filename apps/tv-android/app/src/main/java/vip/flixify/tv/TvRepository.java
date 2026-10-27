package vip.flixify.tv;

import java.util.List;
import vip.flixify.tv.TvModels.*;

/** All callbacks run on the main thread. Stale account/source callbacks must fail STALE. */
public interface TvRepository {
    interface Callback<T> { void onResult(T value); void onError(Failure failure); }
    boolean hasSession();
    String currentScope();
    void login(String code,Callback<Account> callback);
    void account(boolean force,Callback<Account> callback);
    void refreshAccess(Callback<Account> callback);
    void catalog(Kind kind,boolean force,Callback<Catalog> callback);
    void series(Item series,Callback<SeriesDetail> callback);
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
