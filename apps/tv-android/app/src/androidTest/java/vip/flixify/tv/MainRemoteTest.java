package vip.flixify.tv;

import android.app.Instrumentation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.content.Intent;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import org.junit.rules.TestName;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import android.graphics.Bitmap;
import static org.junit.Assert.*;

/** Exercises real native focus navigation; all data and account work stays in the offline fixture. */
@RunWith(AndroidJUnit4.class)
public class MainRemoteTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;
    private FakeTvRepository repository;
    @Rule public TestName testName=new TestName();
    @Before public void setUp() {
        repository=new FakeTvRepository();
        AccessibilityServiceInfo service=instrumentation.getUiAutomation().getServiceInfo();
        service.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        instrumentation.getUiAutomation().setServiceInfo(service);
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));
    }
    @After public void tearDown() {
        captureFixture();
        if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));
    }
    private void launch(boolean signedIn) {
        repository.session=signedIn;
        Intent intent=new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity=(MainActivity)instrumentation.startActivitySync(intent); idle();
    }
    private void idle() { instrumentation.waitForIdleSync(); }
    private void key(int key) { instrumentation.sendKeyDownUpSync(key); idle(); }
    private void down(int count) { for(int n=0;n<count;n++)key(KeyEvent.KEYCODE_DPAD_DOWN); }
    private void click() { key(KeyEvent.KEYCODE_DPAD_CENTER); }
    private View find(View root,String text) {
        if(root.getVisibility()!=View.VISIBLE)return null;
        if(root instanceof TextView && ((TextView)root).getText().toString().equals(text))return root;
        if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++) { View found=find(((ViewGroup)root).getChildAt(n),text); if(found!=null)return found; }
        return null;
    }
    private void visible(String text) { final View[] v={null}; instrumentation.runOnMainSync(()->v[0]=find(activity.getWindow().getDecorView(),text)); assertNotNull("Visible: "+text,v[0]); }
    private void absent(String text) { final View[] v={null}; instrumentation.runOnMainSync(()->v[0]=find(activity.getWindow().getDecorView(),text)); assertNull("Absent: "+text,v[0]); }
    private void focused(String text) { final String[] value={""}; instrumentation.runOnMainSync(()->{View v=activity.getCurrentFocus(); if(v instanceof TextView)value[0]=((TextView)v).getText().toString(); else if(v!=null && v.getContentDescription()!=null)value[0]=v.getContentDescription().toString();}); assertEquals(text,value[0]); }
    private void enter(String text) { instrumentation.runOnMainSync(()->{View v=activity.getCurrentFocus(); assertTrue("Native text entry must have focus",v instanceof EditText); ((EditText)v).setText(text);}); idle(); }
    private void captureFixture() {
        try {
            File directory=instrumentation.getTargetContext().getExternalFilesDir(null);if(directory==null)return;
            String stem="ui-"+testName.getMethodName();Bitmap screenshot=instrumentation.getUiAutomation().takeScreenshot();
            if(screenshot!=null)try(FileOutputStream out=new FileOutputStream(new File(directory,stem+".png"))){screenshot.compress(Bitmap.CompressFormat.PNG,100,out);}
            StringBuilder tree=new StringBuilder("fixture only; IME visible="+imeVisible()+"\n");
            for(AccessibilityWindowInfo window:instrumentation.getUiAutomation().getWindows()) { tree.append("WINDOW type=").append(window.getType()).append(" focused=").append(window.isFocused()).append("\n");dumpNode(window.getRoot(),tree,0); }
            try(FileOutputStream out=new FileOutputStream(new File(directory,stem+".txt"))){out.write(tree.toString().getBytes(StandardCharsets.UTF_8));}
        } catch(Exception ignored) { /* Diagnostics cannot conceal the original assertion. */ }
    }
    private void dumpNode(AccessibilityNodeInfo node,StringBuilder out,int depth) {
        if(node==null || depth>14 || out.length()>100000)return;
        for(int n=0;n<depth;n++)out.append("  ");
        out.append(node.getClassName()).append(" text=").append(node.getText()).append(" desc=").append(node.getContentDescription()).append(" focused=").append(node.isFocused()).append("\n");
        for(int n=0;n<node.getChildCount();n++)dumpNode(node.getChild(n),out,depth+1);
    }
    private boolean imeVisible() {
        for(AccessibilityWindowInfo window:instrumentation.getUiAutomation().getWindows())if(window.getType()==AccessibilityWindowInfo.TYPE_INPUT_METHOD)return true;
        return false;
    }
    private void waitForIme(boolean visible) {
        long deadline=SystemClock.uptimeMillis()+5000;
        while(imeVisible()!=visible && SystemClock.uptimeMillis()<deadline)SystemClock.sleep(30);
        assertEquals("TV keyboard visibility",visible,imeVisible());idle();
    }
    private AccessibilityNodeInfo editable(AccessibilityNodeInfo node) {
        if(node==null)return null;if(node.isEditable() && node.isVisibleToUser())return node;
        for(int n=0;n<node.getChildCount();n++){AccessibilityNodeInfo found=editable(node.getChild(n));if(found!=null)return found;}return null;
    }
    private AccessibilityNodeInfo dialogEditor() {
        String appPackage=instrumentation.getTargetContext().getPackageName();
        for(AccessibilityWindowInfo window:instrumentation.getUiAutomation().getWindows()) {
            AccessibilityNodeInfo root=window.getRoot();
            if(root!=null && appPackage.contentEquals(root.getPackageName())) { AccessibilityNodeInfo field=editable(root);if(field!=null)return field; }
        }
        return null;
    }
    private void enterNativeDialog(String value) {
        // The OS owns TV keyboard character selection; inject text at its documented editable boundary.
        AccessibilityNodeInfo field=dialogEditor();assertNotNull("Native dialog editor",field);
        Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value);
        assertTrue("Native text entry",field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args));idle();
        field=dialogEditor();assertNotNull(field);assertEquals("Typed search query",value,String.valueOf(field.getText()));
    }
    @Test public void loginValidatesCodeAndRemoteReachesRememberedHome() {
        launch(false); enter("123"); down(1); focused("Giriş yap"); click(); visible("16 karakterli giriş kodunuzu yazın.");
        key(KeyEvent.KEYCODE_DPAD_UP); key(KeyEvent.KEYCODE_DPAD_CENTER); waitForIme(true); enter("1234567890123456");
        key(KeyEvent.KEYCODE_BACK); waitForIme(false); down(1); focused("Giriş yap"); click();
        visible("Uzay Yolculuğu"); focused("Ana Sayfa");
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(MainActivity.class.getName(),null,false);
        instrumentation.runOnMainSync(()->activity.recreate());
        activity=(MainActivity)monitor.waitForActivityWithTimeout(5000); instrumentation.removeMonitor(monitor);
        assertNotNull("Recreated activity",activity); idle(); visible("Uzay Yolculuğu");
    }
    @Test public void remoteOpensSeriesSeasonEpisodeAndBackRestoresPosterFocus() {
        launch(true); down(3); focused("Diziler"); click(); key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("Ara");
        down(1); focused("Yıldız Günlükleri"); click(); focused("1. Sezon");
        key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("2. Sezon"); click(); down(1); focused("1. Bölüm · Dönüş");
        key(KeyEvent.KEYCODE_BACK); focused("Yıldız Günlükleri");
    }
    @Test public void movieDetailFavoriteReturnsToSamePosterAndFavoritesList() {
        launch(true); down(2); click(); key(KeyEvent.KEYCODE_DPAD_RIGHT); down(1); focused("Uzay Yolculuğu"); click();
        focused("İzle"); key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("Favorilere ekle"); click(); visible("Favorilerden çıkar");
        key(KeyEvent.KEYCODE_BACK); focused("Uzay Yolculuğu"); key(KeyEvent.KEYCODE_BACK); focused("Filmler");
        down(2); focused("Favoriler"); click(); visible("Uzay Yolculuğu");
    }
    @Test public void remoteSearchFiltersCatalogAndBackClearsFilter() {
        launch(true); down(2); click(); key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("Ara"); click();
        // AlertDialog's native search input is accessible to the TV IME.
        key(KeyEvent.KEYCODE_DPAD_CENTER); waitForIme(true); enterNativeDialog("Deniz");
        key(KeyEvent.KEYCODE_BACK); waitForIme(false); down(1); click();
        visible("Sessiz Deniz"); absent("Uzay Yolculuğu");
        key(KeyEvent.KEYCODE_BACK); visible("Uzay Yolculuğu");
    }
    @Test public void remoteCategoryNarrowsGridAndBackRestoresAllItems() {
        launch(true); down(2); click(); key(KeyEvent.KEYCODE_DPAD_RIGHT); key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("Kategori: Tümü"); click();
        down(2); click(); visible("Sessiz Deniz"); absent("Uzay Yolculuğu");
        key(KeyEvent.KEYCODE_BACK); visible("Uzay Yolculuğu");
    }
    @Test public void failedLoadHasRemoteRetryAndLateResultsCannotReplaceAccount() {
        repository.failCatalog=true; launch(true); visible("Bağlantı kurulamadı");
        key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("Tekrar dene"); repository.failCatalog=false; click(); visible("Uzay Yolculuğu");
        repository.delayCatalog=true; key(KeyEvent.KEYCODE_DPAD_LEFT); down(2); click(); visible("Yükleniyor…");
        down(3); focused("Hesabım"); click(); visible("Test Paketi");
        instrumentation.runOnMainSync(()->repository.releaseDelayedCatalog()); idle(); visible("Test Paketi"); absent("Uzay Yolculuğu");
    }
    @Test public void liveDetailsExposeRemoteWatchAndFixtureProgramme() {
        launch(true); down(1);focused("Canlı TV");click();key(KeyEvent.KEYCODE_DPAD_RIGHT);down(1);focused("Örnek TV");click();
        focused("Canlı izle");visible("Canlı izle");
        final boolean[] found={false};instrumentation.runOnMainSync(()->found[0]=contains(activity.getWindow().getDecorView(),"Örnek Yayın"));assertTrue("EPG is visible",found[0]);
        key(KeyEvent.KEYCODE_BACK);focused("Örnek TV");
    }
    private boolean contains(View root,String part) {
        if(root.getVisibility()!=View.VISIBLE)return false;
        if(root instanceof TextView && ((TextView)root).getText().toString().contains(part))return true;
        if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++)if(contains(((ViewGroup)root).getChildAt(n),part))return true;
        return false;
    }
    @Test public void rememberedColdStartAcceptsFirstVerifiedSourceCatalog() {
        repository.bootstrapped=false;repository.bootstrapOnCatalog=true;
        launch(true);visible("Uzay Yolculuğu");focused("Ana Sayfa");
    }
    @Test public void accountAndLogoutAreReachableWithRemote() {
        launch(true); down(5); focused("Hesabım"); click(); visible("Test Paketi");
        key(KeyEvent.KEYCODE_DPAD_RIGHT); focused("Oturumu kapat"); click();
        // Confirmation starts on the safe cancel option; RIGHT reaches the explicit logout action.
        key(KeyEvent.KEYCODE_DPAD_RIGHT); click(); visible("Giriş yap"); assertFalse(repository.hasSession());
    }
}
