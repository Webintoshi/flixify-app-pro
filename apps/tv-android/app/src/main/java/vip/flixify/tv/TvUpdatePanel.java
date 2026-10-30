package vip.flixify.tv;

import android.app.Activity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import vip.flixify.tv.update.TvUpdater;
import vip.flixify.tv.update.UpdateInfo;

/** Account-screen update state survives permission Settings without restarting a download. */
final class TvUpdatePanel implements AutoCloseable {
    private final Activity activity;
    private final TvUpdater updater;
    private UpdateInfo available;
    private File ready;
    private TextView statusView;
    private Button action;
    private String status="Yeni sürümleri buradan kontrol edebilirsiniz.";
    private boolean busy,closed;
    private long generation;

    TvUpdatePanel(Activity activity) {this.activity=activity;updater=new TvUpdater(activity);}

    Button addTo(LinearLayout parent,int width) {
        TextView heading=TvUi.text(activity,"Uygulama güncellemeleri",20,TvUi.WHITE);
        TvUi.heading(heading);parent.addView(heading,TvUi.space(activity,-1,-2));
        parent.addView(TvUi.text(activity,"Flixify Pro · "+BuildConfig.VERSION_NAME,16,TvUi.MUTED),TvUi.space(activity,-1,-2));
        statusView=TvUi.text(activity,status,16,TvUi.MUTED);parent.addView(statusView,TvUi.space(activity,-1,-2));
        action=TvUi.button(activity,"Güncellemeleri kontrol et",this::act);
        parent.addView(action,TvUi.space(activity,Math.min(330,width),48));paint();return action;
    }

    private boolean current(long ticket) {return !closed && generation==ticket && !activity.isFinishing() && !activity.isDestroyed();}
    private void paint() {
        if(statusView!=null)statusView.setText(status);
        if(action!=null){action.setEnabled(!busy && !closed);action.setText(ready!=null?"Güncellemeyi kur":available!=null?"Güncellemeyi indir":"Güncellemeleri kontrol et");}
    }
    private void error(long ticket,String message) {
        if(!current(ticket))return;
        busy=false;status=message==null || message.isEmpty()?"İşlem tamamlanamadı. Tekrar deneyebilirsiniz.":message;paint();
    }
    private void act() {
        if(busy || closed)return;
        if(ready!=null){install();return;}
        if(available!=null){download();return;}
        final long ticket=++generation;busy=true;status="Güncellemeler kontrol ediliyor…";paint();
        updater.check(new TvUpdater.Callback<UpdateInfo>() {
            public void onResult(UpdateInfo info) {
                if(!current(ticket))return;
                busy=false;available=info;
                status=info==null?"Uygulamanız güncel.":"Yeni sürüm: "+info.versionName+(info.notes.isEmpty()?"":"\n"+info.notes);paint();
            }
            public void onError(String message){error(ticket,message);}
        });
    }
    private void download() {
        final long ticket=++generation;busy=true;status="Güncelleme indiriliyor…";paint();
        updater.download(available,new TvUpdater.DownloadCallback() {
            public void onProgress(int percent){if(current(ticket)){status="Güncelleme indiriliyor · %"+percent;paint();}}
            public void onReady(File file){if(current(ticket)){ready=file;busy=false;status="Güncelleme hazır. Kuruluma devam edebilirsiniz.";paint();}}
            public void onError(String message){error(ticket,message);}
        });
    }
    private void install() {
        final long ticket=++generation;busy=true;status="Güncelleme doğrulanıyor…";paint();
        updater.requestInstallAsync(activity,ready,new TvUpdater.Callback<Boolean>() {
            public void onResult(Boolean launched) {
                if(!current(ticket))return;
                busy=false;status=Boolean.TRUE.equals(launched)?"Android kurulum ekranından devam edin.":"Android izin ekranından bu uygulamaya izin verin. Geri döndüğünüzde Güncellemeyi kur seçeneğine basın.";paint();
            }
            public void onError(String message){error(ticket,message);}
        });
    }
    void cancel() {
        generation++;updater.cancel();
        if(busy){busy=false;status=ready!=null?"Güncelleme hazır. Kuruluma devam edebilirsiniz.":"İşlem durduruldu. Buradan tekrar deneyebilirsiniz.";paint();}
    }
    void resumed() {
        if(ready!=null && updater.canInstallPackages()){status="Güncelleme hazır. Kuruluma devam edebilirsiniz.";paint();}
    }
    @Override public void close() {if(closed)return;closed=true;generation++;updater.close();statusView=null;action=null;}
}
