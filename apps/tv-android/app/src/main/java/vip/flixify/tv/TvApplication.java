package vip.flixify.tv;

import android.app.Application;
import android.content.Context;
import vip.flixify.tv.data.NetworkTvRepository;

public final class TvApplication extends Application {
    private static volatile TvRepository instance;
    public static TvRepository repository(Context context) {
        if(instance==null) synchronized(TvApplication.class) {
            if(instance==null) instance=new NetworkTvRepository(context.getApplicationContext());
        }
        return instance;
    }
    /** No Intent/URL triggers this hook; removed from the optimized release build. */
    public static synchronized void setRepositoryForTests(TvRepository repository) {
        if(!BuildConfig.DEBUG) throw new IllegalStateException("Test repository disabled");
        instance=repository;
    }
}
