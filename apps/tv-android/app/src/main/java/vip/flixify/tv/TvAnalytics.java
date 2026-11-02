package vip.flixify.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.analytics.FirebaseAnalytics;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

final class TvAnalytics {
    private static TvAnalytics instance;
    private final SharedPreferences preferences;
    private final Context context;
    private final AnalyticsPolicy policy;
    private FirebaseAnalytics firebase;
    private String screen="";
    private TvAnalytics(Context context) {
        this.context=context.getApplicationContext();preferences=context.getSharedPreferences("analytics-consent",Context.MODE_PRIVATE);
        policy=new AnalyticsPolicy(configured(),(name,values)->{
            if(firebase==null)return;
            Bundle bundle=new Bundle();bundle.putString("client_platform","android_tv");bundle.putString("app_version",BuildConfig.VERSION_NAME);
            for(Map.Entry<String,Object> entry:values.entrySet())if(entry.getValue() instanceof Number)bundle.putLong(entry.getKey(),((Number)entry.getValue()).longValue());else bundle.putString(entry.getKey(),(String)entry.getValue());
            firebase.logEvent(name,bundle);
        });
        if(preferences.getInt("version",0)==AnalyticsPolicy.VERSION && preferences.getBoolean("accepted",false))apply(true,false);
    }
    static synchronized TvAnalytics get(Context context) {if(instance==null)instance=new TvAnalytics(context);return instance;}
    boolean configured() {return BuildConfig.FLIXIFY_ANALYTICS_CONFIGURED && !BuildConfig.DEBUG;}
    boolean unknown() {return preferences.getInt("version",0)!=AnalyticsPolicy.VERSION;}
    boolean enabled() {return policy.enabled();}
    long epoch() {return policy.epoch();}
    String status() {return !configured()?"Kullanım analizi henüz yapılandırılmadı.":enabled()?"İsteğe bağlı kullanım analizi açık.":"İsteğe bağlı kullanım analizi kapalı.";}
    void choose(boolean accepted) {preferences.edit().putInt("version",AnalyticsPolicy.VERSION).putBoolean("accepted",accepted).apply();apply(accepted,true);}
    private void apply(boolean accepted,boolean reset) {
        policy.choice(false,AnalyticsPolicy.VERSION);
        try {
            if(accepted && configured() && firebase==null){
                if(FirebaseApp.getApps(context).isEmpty())FirebaseApp.initializeApp(context,new FirebaseOptions.Builder().setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY).setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build());
                firebase=FirebaseAnalytics.getInstance(context);
            }
            if(firebase!=null){
                firebase.setAnalyticsCollectionEnabled(false);
                EnumMap<FirebaseAnalytics.ConsentType,FirebaseAnalytics.ConsentStatus> consent=new EnumMap<>(FirebaseAnalytics.ConsentType.class);
                for(FirebaseAnalytics.ConsentType type:FirebaseAnalytics.ConsentType.values())consent.put(type,FirebaseAnalytics.ConsentStatus.DENIED);
                if(accepted)consent.put(FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE,FirebaseAnalytics.ConsentStatus.GRANTED);
                firebase.setConsent(consent);
                if(!accepted && reset)firebase.resetAnalyticsData();
                firebase.setAnalyticsCollectionEnabled(accepted && configured());
            }
            policy.choice(accepted,AnalyticsPolicy.VERSION);screen="";
        }catch(RuntimeException ignored){policy.choice(false,AnalyticsPolicy.VERSION);}
    }
    void event(String name) {event(epoch(),name,Collections.emptyMap());}
    void event(String name,Map<String,Object> values) {event(epoch(),name,values);}
    void event(long epoch,String name,Map<String,Object> values) {policy.event(epoch,name,values);}
    void screen(String value) {if(value.equals(screen))return;screen=value;event("screen_view",values("screen_name",value));}
    static Map<String,Object> values(String key,Object value) {Map<String,Object> map=new LinkedHashMap<>();map.put(key,value);return map;}
    static Map<String,Object> item(TvModels.Item item) {String kind=item.kind.name().toLowerCase(Locale.ROOT);Map<String,Object> v=values("content_type",kind);v.put("content_id",opaque(kind+":"+item.id));String label=AnalyticsPolicy.catalogLabel(item.title,100);if(!label.isEmpty())v.put("content_name",label);return v;}
    static String opaque(String value) {try{byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder s=new StringBuilder();for(int i=0;i<12;i++)s.append(String.format(Locale.ROOT,"%02x",digest[i]));return s.toString();}catch(Exception ignored){return "";}}
    AlertDialog dialog(Activity activity,Runnable done) {
        AlertDialog d=new AlertDialog.Builder(activity).setTitle("Kullanım analizi").setMessage("Google Analytics ile ekran kullanımı ve oynatma performansını ölçmemize izin verir misin? Hesap kodun, yayın bağlantıların ve arama metnin gönderilmez. Seçimin içerik erişimini etkilemez; Hesabım’dan değiştirebilirsin.")
            .setNegativeButton("İzin verme",(dialog,which)->choose(false)).setPositiveButton("İzin ver",(dialog,which)->choose(true)).create();
        d.setOnDismissListener(dialog->{if(done!=null)done.run();});return d;
    }
}
