package vip.flixify.tv;

import android.app.Instrumentation;
import android.app.Dialog;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.EditText;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Arrays;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DeviceCacheUiTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private final FakeTvRepository repository=new FakeTvRepository();
    private void launch() {
        instrumentation.runOnMainSync(()->{repository.session=true;TvApplication.setRepositoryForTests(repository);});
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        instrumentation.waitForIdleSync();
    }
    private View find(View root,String text) {
        if(root.getVisibility()!=View.VISIBLE)return null;
        if(root instanceof TextView && text.equals(((TextView)root).getText().toString()))return root;
        if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View found=find(((ViewGroup)root).getChildAt(i),text);if(found!=null)return found;}
        return null;
    }
    private void click(String text) {
        instrumentation.runOnMainSync(()->{View button=find(activity.getWindow().getDecorView(),text);assertNotNull(text,button);button.performClick();});
        instrumentation.waitForIdleSync();
    }
    private Dialog dialog(String field) {
        try{java.lang.reflect.Field f=MainActivity.class.getDeclaredField(field);f.setAccessible(true);return (Dialog)f.get(activity);}
        catch(Exception failure){throw new AssertionError(failure);}
    }
    private Item movie(String id,String title){return new Item(Kind.MOVIE,id,title,"1","Bilim Kurgu","","mp4",repository.scope,"",0,0,"");}
    private Catalog catalog(Item...items){return new Catalog(Kind.MOVIE,Arrays.asList(items),Collections.singletonList(new Category("1","Bilim Kurgu")));}
    private void awaitVisible(String text) {
        long end=SystemClock.uptimeMillis()+4000;boolean[] visible={false};
        while(SystemClock.uptimeMillis()<end){instrumentation.runOnMainSync(()->visible[0]=find(activity.getWindow().getDecorView(),text)!=null);if(visible[0])return;SystemClock.sleep(25);}
        fail("Visible after update: "+text);
    }
    @After public void cleanup() {
        instrumentation.runOnMainSync(()->{if(activity!=null)activity.finish();TvApplication.setRepositoryForTests(null);});
        instrumentation.waitForIdleSync();
    }
    @Test public void coldOpenAllowsPersistentCatalogReuseAndManualRefreshStillForces() {
        launch();
        assertFalse("Cold startup must allow a verified disk snapshot",repository.lastCatalogForced);
        click("Yenile");
        assertTrue("Explicit refresh must ask for fresh data",repository.lastCatalogForced);
    }
    @Test public void accountProvidesRemoteReachableUpdateCheck() {
        launch();click("Hesabım");
        instrumentation.runOnMainSync(()->{
            View button=find(activity.getWindow().getDecorView(),"Güncellemeleri kontrol et");
            assertNotNull("Account update action",button);
            assertTrue(button.isFocusable());assertTrue(button.isEnabled());
            assertNotNull(find(activity.getWindow().getDecorView(),"Oturumu kapat"));
        });
    }
    @Test public void refreshedCatalogPreservesFocusedControlAndRejectsAnotherSource() {
        launch();
        assertNotNull("Visible catalog subscribes to background updates",repository.catalogObserver);
        instrumentation.runOnMainSync(()->{
            find(activity.getWindow().getDecorView(),"Yenile").requestFocus();
            Item fresh=new Item(Kind.MOVIE,"103","Yeni Gelen Film","1","Bilim Kurgu","","mp4",repository.scope,"",0,0,"");
            repository.publishCatalog(new Catalog(Kind.MOVIE,Arrays.asList(repository.movie,fresh),Arrays.asList(new Category("1","Bilim Kurgu"))));
        });
        instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(()->{
            assertEquals("Yenile",((TextView)activity.getCurrentFocus()).getText().toString());
            assertNotNull(find(activity.getWindow().getDecorView(),"Yeni Gelen Film"));
            Item other=new Item(Kind.MOVIE,"104","Başka Hesap","1","Tür","","mp4","other:scope","",0,0,"");
            repository.publishCatalog(new Catalog(Kind.MOVIE,Collections.singletonList(other),Collections.emptyList()));
        });
        instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(()->{
            assertNull(find(activity.getWindow().getDecorView(),"Başka Hesap"));
            assertNotNull(find(activity.getWindow().getDecorView(),"Yeni Gelen Film"));
        });
    }
    @Test public void recreatedAccountKeepsItsSurfaceAndUpdateFocus() {
        launch();click("Hesabım");
        instrumentation.runOnMainSync(()->find(activity.getWindow().getDecorView(),"Güncellemeleri kontrol et").requestFocus());
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(MainActivity.class.getName(),null,false);
        instrumentation.runOnMainSync(()->activity.recreate());
        MainActivity replacement=(MainActivity)monitor.waitForActivityWithTimeout(5000);instrumentation.removeMonitor(monitor);
        assertNotNull("Recreated Activity",replacement);activity=replacement;instrumentation.waitForIdleSync();
        awaitVisible("Güncellemeleri kontrol et");
        instrumentation.runOnMainSync(()->{
            assertNotNull(find(activity.getWindow().getDecorView(),"Test Paketi"));
            assertNull(find(activity.getWindow().getDecorView(),"Uzay Yolculuğu"));
            assertEquals("Güncellemeleri kontrol et",((TextView)activity.getCurrentFocus()).getText().toString());
        });
    }
    @Test public void sourceReplacementCannotReuseThePreviousPage() {
        launch();
        instrumentation.runOnMainSync(()->{repository.scope="fixture-account:replacement";repository.catalogOverrides.put(Kind.MOVIE,catalog(movie("150","Yeni Kaynak")));});
        click("Hesabım");click("Ana Sayfa");awaitVisible("Yeni Kaynak");
        instrumentation.runOnMainSync(()->assertNull(find(activity.getWindow().getDecorView(),"Uzay Yolculuğu")));
    }
    @Test public void emptyDeferredSnapshotCannotCrossASourceReplacement() {
        launch();click("Ara");
        instrumentation.runOnMainSync(()->{
            repository.publishCatalog(catalog());repository.scope="fixture-account:replacement";
            repository.catalogOverrides.put(Kind.MOVIE,catalog(movie("150","Yeni Kaynak")));
            dialog("catalogDialog").cancel();
        });
        instrumentation.waitForIdleSync();awaitVisible("Yeni Kaynak");
    }
    @Test public void reorderingTheCatalogKeepsTheFocusedPosterEvenOffScreen() {
        launch();click("Filmler");
        instrumentation.runOnMainSync(()->((View)find(activity.getWindow().getDecorView(),repository.movie.title).getParent()).requestFocus());
        List<Item> moved=new ArrayList<>();for(int i=0;i<60;i++)moved.add(movie(Integer.toString(500+i),"Ek Film "+i));moved.add(repository.movie);
        instrumentation.runOnMainSync(()->repository.publishCatalog(new Catalog(Kind.MOVIE,moved,Collections.singletonList(new Category("1","Bilim Kurgu")))));
        long end=SystemClock.uptimeMillis()+4000;boolean[] restored={false};
        while(SystemClock.uptimeMillis()<end){instrumentation.runOnMainSync(()->{View f=activity.getCurrentFocus();restored[0]=f!=null && repository.movie.key().equals(f.getTag());});if(restored[0])break;SystemClock.sleep(25);}
        assertTrue("Focused poster follows its identity after insertions",restored[0]);
    }
    @Test public void cancellingExitConfirmationDrainsThePendingCatalog() {
        launch();instrumentation.runOnMainSync(()->{activity.onBackPressed();assertNotNull(dialog("dialog"));repository.publishCatalog(catalog(repository.movie,movie("180","Son Gelen")));dialog("dialog").cancel();});
        instrumentation.waitForIdleSync();awaitVisible("Son Gelen");
    }
    @Test public void backgroundRefreshKeepsAnOpenSearchDraftUsable() {
        launch();click("Ara");
        instrumentation.runOnMainSync(()->{
            Dialog search=dialog("catalogDialog");EditText input=findEditor(search.getWindow().getDecorView());assertNotNull(input);input.setText("Yeni");
            repository.publishCatalog(catalog(repository.movie,movie("181","Yeni Görev")));
            assertTrue(search.isShowing());assertEquals("Yeni",input.getText().toString());
            find(search.getWindow().getDecorView(),"Ara").performClick();
        });
        instrumentation.waitForIdleSync();awaitVisible("Yeni Görev");
    }
    private EditText findEditor(View root){if(root instanceof EditText)return (EditText)root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){EditText e=findEditor(((ViewGroup)root).getChildAt(i));if(e!=null)return e;}return null;}
}
