package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicReference;
import java.io.File;
import java.io.FileOutputStream;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Mandatory-gate lifecycle tests use only an offline repository and intercepted browser intents. */
@RunWith(AndroidJUnit4.class)
public class WelcomeOfferUiTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final FakeTvRepository repository=new FakeTvRepository();
    private MainActivity activity;
    @Before public void setup(){repository.session=true;repository.welcome=pending();instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));}
    @After public void close(){if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));}
    private WelcomeOffer pending(){return new WelcomeOffer("pending",true,11955,12677,1675);}
    private void launch(){activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));settle();}
    private void settle(){instrumentation.waitForIdleSync();android.os.SystemClock.sleep(100);instrumentation.waitForIdleSync();}
    private void capture(String filename){try{File directory=instrumentation.getTargetContext().getExternalFilesDir(null);Bitmap image=instrumentation.getUiAutomation().takeScreenshot();if(directory!=null && image!=null)try(FileOutputStream output=new FileOutputStream(new File(directory,filename))){image.compress(Bitmap.CompressFormat.PNG,100,output);}}catch(Exception ignored){}}
    private View tagged(String tag){return activity.findViewById(android.R.id.content).findViewWithTag(tag);}
    private View label(View root,String text){if(root instanceof TextView && text.contentEquals(((TextView)root).getText()))return root;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){View found=label(((ViewGroup)root).getChildAt(n),text);if(found!=null)return found;}return null;}
    private void click(String tag){instrumentation.runOnMainSync(()->{View view=tagged(tag);assertNotNull(tag,view);assertTrue(tag,view.isEnabled());view.requestFocus();view.performClick();});settle();}
    private void gated(){instrumentation.runOnMainSync(()->{assertNotNull(tagged("tv-welcome"));assertNull(tagged("tv-catalog-shell"));assertEquals(0,repository.catalogRequests);});}
    @Test public void pendingFetchCannotExposeCatalogThroughResizeStopOrResume(){
        repository.delayWelcome=true;launch();gated();
        final TvRepository.Callback<WelcomeOffer> old=repository.delayedWelcome;
        instrumentation.runOnMainSync(()->{ViewGroup viewport=activity.findViewById(android.R.id.content);ViewGroup.LayoutParams p=viewport.getLayoutParams();p.width=TvUi.dp(activity,620);p.height=TvUi.dp(activity,340);viewport.setLayoutParams(p);});settle();gated();
        instrumentation.runOnMainSync(()->{instrumentation.callActivityOnPause(activity);instrumentation.callActivityOnStop(activity);instrumentation.callActivityOnStart(activity);instrumentation.callActivityOnResume(activity);});settle();
        instrumentation.runOnMainSync(()->old.onResult(WelcomeOffer.notEligible()));settle();gated();
        instrumentation.runOnMainSync(repository::releaseWelcome);settle();gated();assertEquals(2,repository.welcomeRequests);
    }
    @Test public void dpadCapacityKeepsExactDecimalAndFreeChoiceWaitsForAcknowledgement(){
        repository.delayWelcomeChoice=true;launch();gated();
        capture("native-welcome-single.png");
        instrumentation.runOnMainSync(()->tagged("welcome-users-1").requestFocus());instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);settle();
        instrumentation.runOnMainSync(()->assertEquals("welcome-users-2",activity.getCurrentFocus().getTag()));
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);settle();
        instrumentation.runOnMainSync(()->assertEquals("199,50 ₺",((TextView)tagged("welcome-price")).getText().toString()));
        capture("native-welcome-dual.png");
        click("welcome-trial");gated();assertEquals("trial",repository.lastWelcomeChoice);assertEquals(1,repository.welcomeChoices);
        instrumentation.runOnMainSync(repository::releaseWelcomeChoice);settle();
        instrumentation.runOnMainSync(()->assertNotNull(tagged("tv-catalog-shell")));assertTrue(repository.catalogRequests>0);
    }
    @Test public void networkAndChoiceErrorsOfferRetryAndLogoutWithoutHiddenContent(){
        repository.failWelcome=true;launch();gated();assertNotNull(tagged("welcome-error"));
        repository.failWelcome=false;click("welcome-retry");gated();repository.failWelcomeChoice=true;click("welcome-trial");gated();assertNotNull(tagged("welcome-error"));
        click("welcome-logout");instrumentation.runOnMainSync(()->assertNotNull(tagged("tv-login")));assertFalse(repository.session);
    }
    @Test public void successfulLoginAlsoGatesBeforeCatalog(){
        repository.session=false;launch();instrumentation.runOnMainSync(()->((EditText)activity.getCurrentFocus()).setText("1234567890123456"));
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);settle();instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);settle();gated();
    }
    @Test public void latePreviousAccountResponseCannotReleaseNewAccountGate(){
        repository.delayWelcome=true;launch();TvRepository.Callback<WelcomeOffer> previous=repository.delayedWelcome;
        instrumentation.runOnMainSync(()->{repository.accountId="new-fixture-account";repository.delayWelcome=false;repository.welcome=pending();previous.onResult(WelcomeOffer.notEligible());});settle();gated();assertEquals(2,repository.welcomeRequests);
    }
    @Test public void monthlyChoiceOpensOnlyFixedSameAccountWebsiteAfterServerAcknowledgement(){
        repository.delayWelcomeChoice=true;AtomicReference<Intent> sent=new AtomicReference<>();
        Instrumentation.ActivityMonitor browser=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_VIEW.equals(intent.getAction())){sent.set(intent);return new Instrumentation.ActivityResult(0,null);}return null;}};
        instrumentation.addMonitor(browser);
        try{launch();click("welcome-users-2");click("welcome-paid");gated();assertNull(sent.get());
            instrumentation.runOnMainSync(repository::releaseWelcomeChoice);settle();assertNotNull(sent.get());assertEquals("https://flixify.vip/paketler?welcome=1&users=2",sent.get().getDataString());assertEquals("monthly",repository.lastWelcomeChoice);assertTrue(repository.catalogRequests>0);
        }finally{instrumentation.removeMonitor(browser);}
    }
    @Test public void backLeavesPendingChoiceUnacknowledged(){launch();instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);settle();assertTrue(activity.isFinishing());assertEquals(0,repository.welcomeChoices);assertEquals(0,repository.catalogRequests);}
    @Test public void historicalAccountCanOpenPackagesWithoutAcknowledgingAnyWelcomeOffer(){
        repository.welcome=WelcomeOffer.notEligible();AtomicReference<Intent> sent=new AtomicReference<>();
        Instrumentation.ActivityMonitor browser=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_VIEW.equals(intent.getAction())){sent.set(intent);return new Instrumentation.ActivityResult(0,null);}return null;}};
        instrumentation.addMonitor(browser);
        try{launch();instrumentation.runOnMainSync(()->{View account=label(activity.findViewById(android.R.id.content),"Hesabım");assertNotNull(account);account.performClick();});settle();
            instrumentation.runOnMainSync(()->{View logout=label(activity.findViewById(android.R.id.content),"Oturumu kapat");assertNotNull(logout);logout.requestFocus();});instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);settle();
            instrumentation.runOnMainSync(()->assertEquals("Paketleri gör",((TextView)activity.getCurrentFocus()).getText().toString()));instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);settle();
            assertNotNull(sent.get());assertEquals("https://flixify.vip/paketler?welcome=1&users=1",sent.get().getDataString());assertNull(sent.get().getExtras());assertEquals(0,repository.welcomeChoices);
        }finally{instrumentation.removeMonitor(browser);}
    }
}
