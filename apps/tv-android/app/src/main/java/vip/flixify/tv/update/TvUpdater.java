package vip.flixify.tv.update;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;
import vip.flixify.tv.BackgroundWorkGate;

public final class TvUpdater implements AutoCloseable {
    public interface Callback<T> {void onResult(T result);void onError(String message);}
    public interface DownloadCallback {void onProgress(int percent);void onReady(File file);void onError(String message);}
    private interface Work {void run(Operation operation) throws Exception;}
    private final Object lock=new Object();
    private final Context context;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor executor=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1));
    interface InstallLauncher {boolean launch(Activity activity,File file) throws Exception;}
    private final PackageChecks verifier;
    private final InstallLauncher launcher;
    private final UpdateIo io;
    private final Map<String,UpdateInfo> issued=new HashMap<>();
    private boolean closed;
    private Operation active;

    public TvUpdater(Context context) {
        this(context,new UpdateIo(url->{Object connection=url.openConnection();if(!(connection instanceof HttpsURLConnection))throw new UpdateFailure();return (HttpURLConnection)connection;},System::nanoTime));
    }
    TvUpdater(Context context,UpdateIo io) {this(context,io,new AndroidApkVerifier(context),null);}
    TvUpdater(Context context,UpdateIo io,PackageChecks verifier,InstallLauncher launcher) {
        this.context=context.getApplicationContext();this.verifier=verifier;this.io=io;this.launcher=launcher==null?this::launchVerified:launcher;
    }
    public void check(Callback<UpdateInfo> callback) {
        if(callback==null)return;
        submit(operation->{UpdatePolicy policy=verifier.policy();UpdateInfo info=policy.parse(io.manifest(operation));operation.check();post(operation,()->callback.onResult(info.versionCode>policy.installedVersion?info:null));},callback::onError);
    }
    public void download(UpdateInfo info,DownloadCallback callback) {
        if(callback==null)return;
        submit(operation->{
            verifier.policy().validate(info,true);operation.check();File directory=directory();
            synchronized(lock){if(!current(operation))return;issued.clear();}
            File file=io.download(info,directory,operation,percent->post(operation,()->callback.onProgress(percent)),verifier);
            synchronized(lock){if(!current(operation)){file.delete();return;}issued.put(file.getCanonicalPath(),info);}
            post(operation,()->callback.onReady(file));
        },callback::onError);
    }
    private interface ErrorCallback {void onError(String message);}
    private void submit(Work work,ErrorCallback error) {
        synchronized(lock){
            if(closed)return;
            if(active!=null)active.cancel();executor.getQueue().clear();Operation operation=new Operation();active=operation;
            executor.execute(()->{try{operation.check();work.run(operation);}catch(Exception failure){String message=failure instanceof UpdateFailure?failure.getMessage():"Güncelleme bağlantısı kurulamadı. Tekrar deneyebilirsiniz.";post(operation,()->error.onError(message));}});
        }
    }
    private boolean current(Operation operation){return !closed && active==operation && !operation.cancelled;}
    private void post(Operation operation,Runnable callback){main.post(()->{synchronized(lock){if(!current(operation))return;}callback.run();});}
    public void cancel(){synchronized(lock){if(active!=null)active.cancel();active=null;executor.getQueue().clear();}}
    @Override public void close(){synchronized(lock){if(closed)return;closed=true;if(active!=null)active.cancel();active=null;issued.clear();executor.shutdownNow();}}

    private final class Operation implements UpdateIo.Guard {
        volatile boolean cancelled;
        private volatile HttpURLConnection connection;
        @Override public void check() throws UpdateFailure {
            if(cancelled || Thread.currentThread().isInterrupted())throw new UpdateFailure("Güncelleme işlemi iptal edildi.");
            if(BackgroundWorkGate.isPlaybackActive())throw new UpdateFailure("Güncellemeyi oynatıcı kapalıyken tekrar deneyin.");
        }
        @Override public void connected(HttpURLConnection next) throws UpdateFailure {connection=next;if(cancelled){next.disconnect();throw new UpdateFailure();}check();}
        void cancel(){cancelled=true;HttpURLConnection current=connection;if(current!=null)current.disconnect();}
    }
    private File directory() throws IOException {
        File cache=context.getCacheDir().getCanonicalFile(),directory=new File(cache,"apk-updates");
        if(!directory.getCanonicalFile().getParentFile().equals(cache))throw new UpdateFailure();
        return directory.getCanonicalFile();
    }
    public boolean canInstallPackages(){return Build.VERSION.SDK_INT<26 || context.getPackageManager().canRequestPackageInstalls();}
    private void verifyIssued(File file,UpdateIo.Guard guard) throws IOException {
        guard.check();if(file==null)throw new UpdateFailure();UpdateInfo info;
        synchronized(lock){if(closed)throw new UpdateFailure();info=issued.get(file.getCanonicalPath());}
        if(info==null || !file.getCanonicalFile().getParentFile().equals(directory()))throw new UpdateFailure();
        UpdateIo.verifyBytes(file,info,guard);verifier.verify(file,info);guard.check();
    }
    private boolean launchVerified(Activity activity,File file) {
        if(Build.VERSION.SDK_INT>=26 && !canInstallPackages()){activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.getPackageName())));return false;}
        Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".updates",file);
        Intent install=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        install.setClipData(ClipData.newRawUri("Güncelleme",uri));activity.startActivity(install);return true;
    }
    public void requestInstallAsync(Activity activity,File file,Callback<Boolean> callback) {
        if(callback==null)return;
        WeakReference<Activity> owner=new WeakReference<>(activity);
        submit(operation->{
            verifyIssued(file,operation);
            post(operation,()->{
                Activity currentActivity=owner.get();
                if(currentActivity==null || currentActivity.isFinishing() || currentActivity.isDestroyed())return;
                try {
                    operation.check();boolean launched=launcher.launch(currentActivity,file);
                    synchronized(lock){if(!current(operation))return;}
                    callback.onResult(launched);
                }catch(Exception error){
                    synchronized(lock){if(!current(operation))return;}
                    callback.onError(error instanceof UpdateFailure?error.getMessage():"Güncelleme açılamadı. İzinleri kontrol edip tekrar deneyin.");
                }
            });
        },callback::onError);
    }
    public boolean requestInstall(Activity activity,File file) {
        if(activity==null || file==null)throw new IllegalStateException("Güncelleme dosyası doğrulanamadı.");
        try {
            UpdateIo.Guard guard=new UpdateIo.Guard(){public void check() throws UpdateFailure {synchronized(lock){if(closed)throw new UpdateFailure();}if(BackgroundWorkGate.isPlaybackActive())throw new UpdateFailure("Önce oynatıcıyı kapatın.");}public void connected(HttpURLConnection connection){}};
            verifyIssued(file,guard);return launcher.launch(activity,file);
        }catch(Exception error){throw new IllegalStateException("Güncelleme açılamadı. İzinleri ve dosyayı kontrol edip tekrar deneyin.");}
    }
}
