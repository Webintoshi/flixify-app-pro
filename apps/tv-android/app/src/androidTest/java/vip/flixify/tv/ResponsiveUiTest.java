package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Rect;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.recyclerview.widget.RecyclerView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Uses measured app-content constraints, not emulator pixels; all repository data is offline. */
@RunWith(AndroidJUnit4.class)
public class ResponsiveUiTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private final ResponsiveFixture repository=new ResponsiveFixture();
    private ViewGroup viewport;
    @Before public void setUp() { instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository)); }
    @After public void tearDown() {
        if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));
    }
    private void launch(boolean signedIn,int widthDp,int heightDp) {
        repository.base.session=signedIn;
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        instrumentation.runOnMainSync(()->{
            viewport=activity.findViewById(android.R.id.content);
            ViewGroup.LayoutParams p=viewport.getLayoutParams();
            p.width=TvUi.dp(activity,widthDp);p.height=TvUi.dp(activity,heightDp);
            viewport.setLayoutParams(p);viewport.requestLayout();
        });
        settle();
    }
    private void settle() { instrumentation.waitForIdleSync(); android.os.SystemClock.sleep(120);instrumentation.waitForIdleSync(); }
    private void key(int key) { instrumentation.sendKeyDownUpSync(key);settle(); }
    private void down(int count) { for(int n=0;n<count;n++)key(KeyEvent.KEYCODE_DPAD_DOWN); }
    private void click() { key(KeyEvent.KEYCODE_DPAD_CENTER); }
    private View find(View root,String label) {
        if(root.getVisibility()!=View.VISIBLE)return null;
        if(root instanceof TextView && label.contentEquals(((TextView)root).getText()))return root;
        if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++) { View v=find(((ViewGroup)root).getChildAt(n),label);if(v!=null)return v; }
        return null;
    }
    private void fullyVisible(View view,String label) {
        assertNotNull(label,view);assertTrue(label+" has a measured size",view.getWidth()>0 && view.getHeight()>0);
        Rect visible=new Rect();assertTrue(label+" visible",view.getGlobalVisibleRect(visible));
        int[] origin=new int[2];view.getLocationOnScreen(origin);
        assertEquals(label+" left",origin[0],visible.left);assertEquals(label+" top",origin[1],visible.top);
        assertEquals(label+" right",origin[0]+view.getWidth(),visible.right);
        assertEquals(label+" bottom",origin[1]+view.getHeight(),visible.bottom);
        Rect content=new Rect();viewport.getGlobalVisibleRect(content);assertTrue(label+" stays in app content",content.contains(visible));
    }
    private void focusVisible(String label) {
        instrumentation.runOnMainSync(()->{
            View focus=activity.getCurrentFocus();assertNotNull(label+" focused",focus);
            String actual=focus instanceof android.widget.EditText?String.valueOf(focus.getContentDescription()):focus instanceof TextView?((TextView)focus).getText().toString():String.valueOf(focus.getContentDescription());
            assertEquals(label,actual);fullyVisible(focus,label);
        });
    }
    private void controlVisible(String label) { instrumentation.runOnMainSync(()->fullyVisible(find(viewport,label),label)); }
    @Test public void shortMeasuredViewportKeepsRailAndAccountActionsReachable() {
        launch(true,760,300);focusVisible("Ana Sayfa");
        String[] labels={"Canlı TV","Filmler","Diziler","Favoriler","Hesabım"};
        for(String label:labels){down(1);focusVisible(label);}
        click();key(KeyEvent.KEYCODE_DPAD_RIGHT);focusVisible("Oturumu kapat");
        key(KeyEvent.KEYCODE_BACK);focusVisible("Hesabım");
    }
    @Test public void narrowMeasuredViewportKeepsLongCategoryToolbarReachable() {
        launch(true,620,390);down(2);click();key(KeyEvent.KEYCODE_DPAD_RIGHT);focusVisible("Ara");
        key(KeyEvent.KEYCODE_DPAD_RIGHT);click();down(1);click();
        key(KeyEvent.KEYCODE_DPAD_UP);focusVisible("Ara");key(KeyEvent.KEYCODE_DPAD_RIGHT);
        focusVisible("Kategori: "+ResponsiveFixture.LONG_CATEGORY);key(KeyEvent.KEYCODE_DPAD_RIGHT);focusVisible("Yenile");
    }
    @Test public void loginSubmitFitsAndScrollsIntoShortNarrowMeasuredViewport() {
        launch(false,420,280);focusVisible("16 karakterli giriş kodu");
        down(1);focusVisible("Giriş yap");click();controlVisible("16 karakterli giriş kodunuzu yazın.");
    }
    @Test public void pendingLoginSurvivesMeasuredWidthAndHeightResize() {
        repository.delayLogin=true;launch(false,620,390);
        instrumentation.runOnMainSync(()->((android.widget.EditText)activity.getCurrentFocus()).setText("1234567890123456"));
        down(1);click();controlVisible("Giriş yapılıyor…");
        instrumentation.runOnMainSync(()->{ViewGroup.LayoutParams p=viewport.getLayoutParams();p.width=TvUi.dp(activity,420);p.height=TvUi.dp(activity,280);viewport.setLayoutParams(p);});
        settle();instrumentation.runOnMainSync(repository::releaseLogin);settle();
        focusVisible("Ana Sayfa");
        instrumentation.runOnMainSync(()->assertNotNull("Accepted login result must render home",find(viewport,"Sizin için")));
    }
    @Test public void longPosterRemainsReachableInShortVirtualizedCatalog() {
        launch(true,620,330);down(2);click();key(KeyEvent.KEYCODE_DPAD_RIGHT);down(1);
        focusVisible(ResponsiveFixture.LONG_TITLE);resize(650,340);focusVisible(ResponsiveFixture.LONG_TITLE);
        instrumentation.runOnMainSync(()->{
            RecyclerView recycler=findGrid(viewport);assertNotNull("Catalog remains virtualized",recycler);
            assertTrue("Large catalog binds a bounded number of cards",recycler.getChildCount()<40);
        });
    }
    private void resize(int widthDp,int heightDp) {
        instrumentation.runOnMainSync(()->{ViewGroup.LayoutParams p=viewport.getLayoutParams();p.width=TvUi.dp(activity,widthDp);p.height=TvUi.dp(activity,heightDp);viewport.setLayoutParams(p);viewport.requestLayout();});settle();
    }
    private void openSeries() {
        down(3);click();key(KeyEvent.KEYCODE_DPAD_RIGHT);down(1);focusVisible("Yıldız Günlükleri");
    }
    @Test public void intermediateHeightSeriesKeepsPosterAndToolbarFullyReachable() {
        launch(true,960,420);openSeries();key(KeyEvent.KEYCODE_DPAD_UP);focusVisible("Ara");
        key(KeyEvent.KEYCODE_DPAD_RIGHT);focusVisible("Kategori: Tümü");key(KeyEvent.KEYCODE_DPAD_DOWN);focusVisible("Yıldız Günlükleri");
    }
    @Test public void measuredResizePreservesFocusedUnselectedRailTarget() {
        launch(true,960,540);down(3);focusVisible("Diziler");resize(900,500);focusVisible("Diziler");
        click();key(KeyEvent.KEYCODE_DPAD_RIGHT);focusVisible("Ara");
    }
    @Test public void measuredResizePreservesFocusedSeriesPoster() {
        launch(true,960,600);openSeries();resize(900,650);focusVisible("Yıldız Günlükleri");
        key(KeyEvent.KEYCODE_DPAD_UP);focusVisible("Ara");
    }
    @Test public void measuredResizePreservesFocusedMoviePoster() {
        launch(true,960,540);down(2);click();key(KeyEvent.KEYCODE_DPAD_RIGHT);down(1);focusVisible(ResponsiveFixture.LONG_TITLE);
        resize(900,600);focusVisible(ResponsiveFixture.LONG_TITLE);
    }
    private RecyclerView findGrid(View v) {
        if(v instanceof RecyclerView)return (RecyclerView)v;
        if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++){RecyclerView found=findGrid(((ViewGroup)v).getChildAt(n));if(found!=null)return found;}return null;
    }
    /** Separate fixture preserves the shared remote suite's existing data and behavior. */
    private static final class ResponsiveFixture implements TvRepository {
        static final String LONG_CATEGORY="Bilim Kurgu ve Fantastik Maceralar — Türkçe Dublaj Koleksiyonu";
        static final String LONG_TITLE="Yıldızların Ötesinde Çok Uzun Bir Yolculuk: Geri Dönüşün Beklenmedik Hikâyesi";
        final FakeTvRepository base=new FakeTvRepository();
        boolean delayLogin;String pendingCode;Callback<Account> pendingLogin;
        void releaseLogin(){delayLogin=false;Callback<Account> cb=pendingLogin;pendingLogin=null;base.login(pendingCode,cb);}
        final Item movie=new Item(Kind.MOVIE,"wide-1",LONG_TITLE,"long",LONG_CATEGORY,"","mp4",base.scope,"",0,0,
                "Uzak dünyalara uzanan bir yolculuğun ve eve dönmeye çalışan insanların hikâyesi. "+LONG_TITLE+" "+LONG_TITLE);
        public boolean hasSession(){return base.hasSession();}public String currentScope(){return base.currentScope();}
        public void login(String code,Callback<Account> cb){if(delayLogin){pendingCode=code;pendingLogin=cb;}else base.login(code,cb);}public void account(boolean force,Callback<Account> cb){base.account(force,cb);}
        public void refreshAccess(Callback<Account> cb){base.refreshAccess(cb);}
        public void catalog(Kind kind,boolean force,Callback<Catalog> cb){
            if(kind!=Kind.MOVIE){base.catalog(kind,force,cb);return;}
            List<Item> items=new ArrayList<>();items.add(movie);
            for(int n=1;n<600;n++)items.add(new Item(Kind.MOVIE,"large-"+n,"Film "+n,"long",LONG_CATEGORY,"","mp4",base.scope,"",0,0,"Çevrimdışı açıklama"));
            cb.onResult(new Catalog(kind,items,Arrays.asList(new Category("long",LONG_CATEGORY))));
        }
        public void series(Item item,Callback<SeriesDetail> cb){base.series(item,cb);}public void favorites(Callback<List<Item>> cb){base.favorites(cb);}
        public void startingEpisode(Item item,Callback<Item> cb){base.startingEpisode(item,cb);}
        public boolean isFavorite(Item item){return base.isFavorite(item);}public void toggleFavorite(Item item,Callback<Boolean> cb){base.toggleFavorite(item,cb);}
        public void playback(Item item,Callback<Playback> cb){base.playback(item,cb);}public void epg(Item item,Callback<List<Programme>> cb){base.epg(item,cb);}
        public void markWatched(Item item){base.markWatched(item);}public void savePosition(Item item,long p,long d){base.savePosition(item,p,d);}
        public long resumePosition(Item item){return base.resumePosition(item);}public void logout(){base.logout();}
    }
}
