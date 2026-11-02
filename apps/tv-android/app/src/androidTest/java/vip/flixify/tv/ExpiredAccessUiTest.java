package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Offline access fixtures never open provider media or a real payment. */
@RunWith(AndroidJUnit4.class)
public class ExpiredAccessUiTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final FakeTvRepository repository=new FakeTvRepository();
    private MainActivity activity;
    @Before public void setup(){repository.session=true;instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));}
    @After public void close(){if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));}
    private Account expired(){return new Account("fixture-account","1234","1 Aylık",1600000000000L,false,false,"Paketinin süresi doldu.");}
    private void launch(){activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));settle();}
    private void settle(){instrumentation.waitForIdleSync();android.os.SystemClock.sleep(120);instrumentation.waitForIdleSync();}
    private View label(View root,String text){if(root instanceof TextView && text.contentEquals(((TextView)root).getText()))return root;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){View found=label(((ViewGroup)root).getChildAt(n),text);if(found!=null)return found;}return null;}
    private View label(String text){return label(activity.findViewById(android.R.id.content),text);}
    @Test public void expiredStartupShowsPackageTermsBeforeAnyCatalogRequest(){
        repository.accountOverride=expired();repository.failCatalog=true;repository.catalogFailureCode=Failure.Code.INELIGIBLE;launch();
        instrumentation.runOnMainSync(()->{assertNotNull("Expired access needs package choices",label("6 Aylık"));assertNotNull(label("12 Aylık"));});assertEquals("Inactive startup never requests provider catalog",0,repository.catalogRequests);
    }
    @Test public void allHomeIneligibleResponsesRetainExplicitPackageRecovery(){
        repository.failCatalog=true;repository.catalogFailureCode=Failure.Code.INELIGIBLE;launch();
        instrumentation.runOnMainSync(()->{assertNotNull("Access failure must not end at retry alone",label("Paketleri gör"));assertNotNull(label("İçerik hizmetine şu anda ulaşılamıyor. Erişimini tekrar kontrol et."));assertNull(label("Hesabınız aktif"));});
    }
    @Test public void delayedAccessRefreshSurvivesCatalogNavigationGeneration(){
        repository.delayAccess=true;launch();
        instrumentation.runOnMainSync(()->{View films=label("Filmler");assertNotNull(films);films.performClick();repository.accountOverride=expired();repository.releaseAccess();});settle();
        instrumentation.runOnMainSync(()->assertNotNull("A new catalog generation cannot hide authoritative expiry",label("6 Aylık")));
    }
    @Test public void blockedAndProvisioningAreNotExpired(){
        repository.accountOverride=new Account("fixture-account","1234","Aktif Paket",1893456000000L,false,false,"İçerik bağlantın hazırlanıyor.",Account.Access.PROVISIONING);launch();
        instrumentation.runOnMainSync(()->{assertNull(label("6 Aylık"));assertNotNull(label("Paketleri gör"));});assertEquals(0,repository.catalogRequests);
    }
    @Test public void networkFailureCannotGrantAccessOrPretendExpiry(){
        repository.failAccess=true;launch();instrumentation.runOnMainSync(()->{assertNull(label("6 Aylık"));assertNotNull(label("Tekrar dene"));assertNotNull(label("Paketleri gör"));});assertEquals(0,repository.catalogRequests);
    }
    @Test public void packageFailureCanRetryAndFreshActivationUnlocksCatalog(){
        repository.accountOverride=expired();repository.failPackages=true;launch();
        instrumentation.runOnMainSync(()->{assertNotNull(label("Paketleri yenile"));repository.failPackages=false;label("Paketleri yenile").performClick();assertNotNull(label("999 ₺"));label("Erişimi kontrol et").performClick();assertEquals(0,repository.catalogRequests);repository.accountOverride=null;label("Erişimi kontrol et").performClick();});settle();assertTrue(repository.catalogRequests>0);
    }
    @Test public void explicitRegularPlanIntentHasNoCredentialsAndDoesNotUnlock(){
        repository.accountOverride=expired();launch();
        final Intent[] opened={null};
        Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_VIEW.equals(intent.getAction())){opened[0]=intent;return new Instrumentation.ActivityResult(0,null);}return null;}};instrumentation.addMonitor(monitor);
        try{instrumentation.runOnMainSync(()->{label("2 Kullanıcı").performClick();View buy=label("Web sitesinde devam et");assertNotNull(buy);buy.performClick();});settle();assertNotNull(opened[0]);assertEquals("https://flixify.vip/paketler?users=2&plan=1-ay-2-kullanici&from=android_tv",opened[0].getDataString());assertNull(opened[0].getExtras());assertEquals(0,repository.catalogRequests);}
        finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void warmExpiryReplacesPreviouslyActiveCatalog(){
        launch();assertTrue(repository.catalogRequests>0);instrumentation.runOnMainSync(()->{repository.accountOverride=expired();instrumentation.callActivityOnPause(activity);instrumentation.callActivityOnResume(activity);});settle();instrumentation.runOnMainSync(()->assertNotNull(label("6 Aylık")));
    }
    @Test public void staleAccountAccessCannotReopenExpiredRecovery(){
        repository.delayAccess=true;launch();instrumentation.runOnMainSync(()->{repository.accountId="replacement-account";repository.accountOverride=expired();repository.releaseAccess();});settle();instrumentation.runOnMainSync(()->assertNull(label("6 Aylık")));assertEquals(0,repository.catalogRequests);
    }
    @Test public void remotePackageFocusEvidence()throws Exception{
        repository.accountOverride=expired();launch();
        instrumentation.runOnMainSync(()->label("1 Kullanıcı • Seçili").requestFocus());settle();saveScreen("renewal-users1.png");
        instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_DOWN);instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_CENTER);settle();
        instrumentation.runOnMainSync(()->assertNotNull(label("2 Kullanıcı • Seçili")));saveScreen("renewal-users2.png");
        key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedBuy("1 Aylık");key(android.view.KeyEvent.KEYCODE_DPAD_RIGHT);focusedBuy("6 Aylık");key(android.view.KeyEvent.KEYCODE_DPAD_RIGHT);focusedBuy("12 Aylık");
        key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedLabel("Paketleri yenile");key(android.view.KeyEvent.KEYCODE_DPAD_CENTER);focusedLabel("Paketleri yenile");
        key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedLabel("Erişimi kontrol et");key(android.view.KeyEvent.KEYCODE_DPAD_CENTER);focusedLabel("Erişimi kontrol et");
        key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedLabel("Hesabım");key(android.view.KeyEvent.KEYCODE_DPAD_CENTER);instrumentation.runOnMainSync(()->assertNotNull(label("Oturumu kapat")));
    }
    private void saveScreen(String name)throws Exception{android.graphics.Bitmap screen=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(screen);java.io.File file=new java.io.File(instrumentation.getTargetContext().getExternalFilesDir(null),name);try(java.io.FileOutputStream out=new java.io.FileOutputStream(file)){screen.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}screen.recycle();}

    @Test public void blockedTrialAndServiceFailuresOfferPackagesWithoutCallingThemExpiry(){
        for(Account.Access reason:new Account.Access[]{Account.Access.BLOCKED,Account.Access.TRIAL_PENDING,Account.Access.SERVICE_UNAVAILABLE}){
            repository.accountOverride=new Account("fixture-account","1234","Paket",1893456000000L,false,false,"Durum: "+reason,reason);launch();
            instrumentation.runOnMainSync(()->{assertNull(label("6 Aylık"));assertNotNull(label("Paketleri gör"));assertNotNull(label("Tekrar dene"));});
        }
        assertEquals(0,repository.catalogRequests);
    }
    @Test public void latePackagesCannotRepaintAccount(){
        repository.accountOverride=expired();repository.delayPackages=true;launch();instrumentation.runOnMainSync(()->{label("Hesabım").performClick();repository.releasePackages();});settle();instrumentation.runOnMainSync(()->{assertNotNull(label("Oturumu kapat"));assertNull(label("6 Aylık"));});
    }

    @Test public void authoritativeAuthRevocationReturnsToLogin(){
        repository.expireAuth=true;launch();instrumentation.runOnMainSync(()->{assertNull(label("6 Aylık"));assertNotNull(label("Giriş yap"));});assertEquals(0,repository.catalogRequests);
    }

    @Test public void noPlanStartupShowsTermsWithoutProviderCatalog(){
        repository.accountOverride=new Account("fixture-account","1234","",0,false,false,"Aktif paketin bulunmuyor.",Account.Access.EXPIRED);launch();instrumentation.runOnMainSync(()->{assertNotNull(label("1 Aylık"));assertNotNull(label("6 Aylık"));assertNotNull(label("12 Aylık"));});assertEquals(0,repository.catalogRequests);
    }

    @Test public void revokedLeaseStaleTriggersAuthorityAndTruthfulRecovery(){
        repository.revokeCatalog=true;launch();assertTrue(repository.accessRequests>=2);instrumentation.runOnMainSync(()->{assertNotNull(label("Paketleri gör"));assertNotNull(label("İçerik hizmetine şu anda ulaşılamıyor. Erişimini tekrar kontrol et."));assertNull(label("6 Aylık"));});
    }
    @Test public void accountRefreshActivationIsAdoptedBeforeHomeNavigation(){
        repository.accountOverride=expired();launch();instrumentation.runOnMainSync(()->{repository.accountOverride=null;label("Hesabım").performClick();label("Ana Sayfa").performClick();});settle();assertTrue(repository.catalogRequests>0);instrumentation.runOnMainSync(()->assertNull(label("6 Aylık")));
    }
    @Test public void accountRefreshExpiryBlocksHomeNavigation(){
        launch();int before=repository.catalogRequests;instrumentation.runOnMainSync(()->{repository.accountOverride=expired();repository.scope="";label("Hesabım").performClick();label("Ana Sayfa").performClick();});settle();instrumentation.runOnMainSync(()->assertNotNull(label("6 Aylık")));assertEquals(before,repository.catalogRequests);
    }

    private void key(int code){instrumentation.sendKeyDownUpSync(code);settle();}
    private void focusedLabel(String text){instrumentation.runOnMainSync(()->{assertTrue(activity.getCurrentFocus() instanceof TextView);assertEquals(text,((TextView)activity.getCurrentFocus()).getText().toString());});}
    private void focusedBuy(String term){instrumentation.runOnMainSync(()->{assertEquals("Web sitesinde devam et",((TextView)activity.getCurrentFocus()).getText().toString());assertNotNull(label((View)activity.getCurrentFocus().getParent(),term));});}
    @Test public void compactPackagesScrollAllControlsWithoutClipping(){
        repository.accountOverride=expired();launch();instrumentation.runOnMainSync(()->{View root=activity.findViewById(android.R.id.content);ViewGroup.LayoutParams size=root.getLayoutParams();size.width=TvUi.dp(activity,560);size.height=TvUi.dp(activity,300);root.setLayoutParams(size);});settle();
        instrumentation.runOnMainSync(()->label("1 Kullanıcı • Seçili").requestFocus());key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedBuy("1 Aylık");key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedBuy("6 Aylık");key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedBuy("12 Aylık");key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedLabel("Paketleri yenile");key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedLabel("Erişimi kontrol et");key(android.view.KeyEvent.KEYCODE_DPAD_DOWN);focusedLabel("Hesabım");
        instrumentation.runOnMainSync(()->{View focus=activity.getCurrentFocus();android.graphics.Rect visible=new android.graphics.Rect();assertTrue(focus.getGlobalVisibleRect(visible));assertEquals(focus.getHeight(),visible.height());});
    }

    @Test public void pendingOldAccountCannotBlockReplacementAuthority(){
        repository.delayAccess=true;launch();instrumentation.runOnMainSync(()->{TvRepository.Callback<Account> old=repository.delayedAccess;repository.accountId="replacement-account";repository.delayAccess=false;repository.accountOverride=new Account("replacement-account","4321","",0,false,false,"Yeni hesabın paketi bulunmuyor.",Account.Access.EXPIRED);instrumentation.callActivityOnPause(activity);instrumentation.callActivityOnResume(activity);old.onResult(new Account("fixture-account","1234","Eski Paket",1893456000000L,true,false,"Eski erişim"));});settle();instrumentation.runOnMainSync(()->{assertNotNull(label("6 Aylık"));assertNotNull(label("Yeni hesabın paketi bulunmuyor."));});assertEquals(0,repository.catalogRequests);
    }
    @Test public void lateRevokedHomeCallbackKeepsCurrentAccountSurfaceDuringResolution(){
        repository.delayCatalog=true;launch();instrumentation.runOnMainSync(()->{TvRepository.Callback<Catalog> old=repository.delayedCatalog;label("Hesabım").performClick();assertNotNull(label("Oturumu kapat"));repository.delayAccess=true;repository.scope="";old.onError(new Failure(Failure.Code.STALE,"Revoked source"));assertNotNull(label("Oturumu kapat"));});
    }

}
