package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Collections;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class StartupScreenTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final FakeTvRepository repository=new FakeTvRepository();
    private MainActivity activity;
    private void launch(boolean delayed) {
        instrumentation.runOnMainSync(()->{repository.session=true;repository.delayCatalog=delayed;TvApplication.setRepositoryForTests(repository);});
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        instrumentation.waitForIdleSync();
    }
    private View text(View root,String value) {
        if(root instanceof TextView && value.equals(((TextView)root).getText().toString()))return root;
        if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View found=text(((ViewGroup)root).getChildAt(i),value);if(found!=null)return found;}
        return null;
    }
    private View overlay(){return activity.findViewById(android.R.id.content).findViewWithTag("tv-startup-overlay");}
    private void assertLoading() {
        instrumentation.runOnMainSync(()->{
            View loading=overlay();assertNotNull("Branded startup covers initial loading",loading);assertTrue(loading.isShown());
            ImageView logo=loading.findViewWithTag("tv-startup-logo");assertNotNull(logo);assertNotNull(logo.getDrawable());
            ProgressBar spinner=loading.findViewWithTag("tv-startup-spinner");assertNotNull(spinner);assertTrue(spinner.isShown() && spinner.isIndeterminate());
            assertNotNull(text(loading,"Yükleniyor…"));
            Rect actual=new Rect(),viewport=new Rect();assertTrue(loading.getGlobalVisibleRect(actual));assertTrue(activity.findViewById(android.R.id.content).getGlobalVisibleRect(viewport));assertEquals(viewport,actual);
        });
    }
    private void awaitReady(String label,long budget) {
        long end=SystemClock.uptimeMillis()+budget;boolean[] ready={false};
        while(SystemClock.uptimeMillis()<end){instrumentation.runOnMainSync(()->ready[0]=(overlay()==null || !overlay().isShown()) && text(activity.getWindow().getDecorView(),label)!=null);if(ready[0])return;SystemClock.sleep(20);}
        fail("Ready surface replaces startup: "+label);
    }
    private void capture(String name) {
        if(!"true".equals(InstrumentationRegistry.getArguments().getString("captureStartup")))return;
        android.graphics.Bitmap screenshot=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(screenshot);
        java.io.File file=new java.io.File(instrumentation.getTargetContext().getExternalFilesDir(null),name+".png");
        try(java.io.FileOutputStream stream=new java.io.FileOutputStream(file)){assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,stream));}
        catch(java.io.IOException error){throw new AssertionError(error);}finally{screenshot.recycle();}
    }
    @After public void cleanup(){instrumentation.runOnMainSync(()->{if(activity!=null)activity.finish();TvApplication.setRepositoryForTests(null);});instrumentation.waitForIdleSync();}

    @Test public void delayedCatalogShowsLogoSpinnerAndBlocksHiddenNavigation() {
        launch(true);assertLoading();TvRepository.Callback<Catalog> pending=repository.delayedCatalog;
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);instrumentation.waitForIdleSync();
        assertSame("Remote cannot select a hidden section",pending,repository.delayedCatalog);assertLoading();capture("startup-normal");
    }
    @Test public void alternateConfirmCannotActivateHiddenRail() {
        launch(true);assertLoading();TvRepository.Callback<Catalog> pending=repository.delayedCatalog;
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_SPACE);instrumentation.waitForIdleSync();
        assertSame("SPACE cannot confirm hidden navigation",pending,repository.delayedCatalog);assertLoading();
    }
    @Test public void completedStateIsTrustedOnlyInItsOriginalProcess() {
        launch(false);awaitReady(repository.movie.title,1500);android.os.Bundle saved=new android.os.Bundle();
        instrumentation.runOnMainSync(()->instrumentation.callActivityOnSaveInstanceState(activity,saved));
        assertTrue("Same-process recreation retains completion",StartupScreen.restoredComplete(saved));
        saved.putString("startupProcess","previous-process");assertFalse("Fresh process must show its initial loading cover",StartupScreen.restoredComplete(saved));
        saved.remove("startupProcess");assertFalse("Legacy/restored state without process identity cannot skip loading",StartupScreen.restoredComplete(saved));
    }
    @Test public void readyCatalogKeepsRailFocusAndLaterRefreshDoesNotShowStartup() {
        launch(true);assertLoading();instrumentation.runOnMainSync(repository::releaseDelayedCatalog);awaitReady(repository.movie.title,1500);
        instrumentation.runOnMainSync(()->{
            assertEquals("Ana Sayfa",((TextView)activity.getCurrentFocus()).getText().toString());
            repository.delayCatalog=true;text(activity.getWindow().getDecorView(),"Yenile").performClick();assertTrue(overlay()==null || !overlay().isShown());
        });
        instrumentation.runOnMainSync(repository::releaseDelayedCatalog);awaitReady(repository.movie.title,1500);
    }
    @Test public void networkFailureRevealsRetryInsteadOfHidingItBehindSpinner() {
        launch(true);assertLoading();instrumentation.runOnMainSync(()->repository.delayedCatalog.onError(new Failure(Failure.Code.NETWORK,"Bağlantı kurulamadı")));awaitReady("Tekrar dene",1500);
        instrumentation.runOnMainSync(()->{repository.delayCatalog=false;text(activity.getWindow().getDecorView(),"Tekrar dene").performClick();});awaitReady(repository.movie.title,1500);
    }
    @Test public void authorizationFailureRevealsLogin() {
        launch(true);assertLoading();instrumentation.runOnMainSync(()->repository.delayedCatalog.onError(new Failure(Failure.Code.AUTH,"Tekrar giriş yapın")));awaitReady("Giriş yap",1500);
    }
    @Test public void emptyCatalogIsAReadySurface() {
        repository.catalogOverrides.put(Kind.MOVIE,new Catalog(Kind.MOVIE,Collections.emptyList(),Collections.emptyList()));launch(false);awaitReady("İçerik bulunamadı.",1500);
    }
    @Test public void stoppedActivityCallbackCannotDismissReplacementStartup() {
        launch(true);assertLoading();TvRepository.Callback<Catalog> old=repository.delayedCatalog;
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(MainActivity.class.getName(),null,false);instrumentation.runOnMainSync(()->activity.recreate());
        MainActivity replacement=(MainActivity)monitor.waitForActivityWithTimeout(5000);instrumentation.removeMonitor(monitor);assertNotNull(replacement);activity=replacement;instrumentation.waitForIdleSync();
        TvRepository.Callback<Catalog> current=repository.delayedCatalog;assertNotSame(old,current);
        instrumentation.runOnMainSync(()->old.onResult(new Catalog(Kind.MOVIE,Collections.singletonList(repository.movie),Collections.emptyList())));instrumentation.waitForIdleSync();assertLoading();
        instrumentation.runOnMainSync(repository::releaseDelayedCatalog);awaitReady(repository.movie.title,1500);
    }
    @Test public void pendingStartupFillsResizedViewport() {
        launch(true);assertLoading();instrumentation.runOnMainSync(()->{View root=activity.findViewById(android.R.id.content);ViewGroup.LayoutParams p=root.getLayoutParams();p.width=TvUi.dp(activity,560);p.height=TvUi.dp(activity,320);root.setLayoutParams(p);});
        instrumentation.waitForIdleSync();assertLoading();capture("startup-compact");instrumentation.runOnMainSync(repository::releaseDelayedCatalog);awaitReady(repository.movie.title,1500);
    }
    @Test public void backExitsPendingStartupWithoutHiddenConfirmation() {
        launch(true);assertLoading();instrumentation.runOnMainSync(()->activity.onBackPressed());assertTrue(activity.isFinishing());
    }
    @Test public void launchBrandingIsScopedToMainAndCachedOpenHasNoFixedDelay() throws Exception {
        launch(false);awaitReady(repository.movie.title,1500);
        android.content.pm.PackageManager pm=activity.getPackageManager();
        int launchTheme=activity.getResources().getIdentifier("TvLaunchTheme","style",activity.getPackageName());assertTrue("Dedicated branded launch theme exists",launchTheme!=0);
        assertEquals(launchTheme,pm.getActivityInfo(new ComponentName(activity,MainActivity.class),0).getThemeResource());
        assertEquals(R.style.TvTheme,pm.getActivityInfo(new ComponentName(activity,PlayerActivity.class),0).getThemeResource());
    }
}
