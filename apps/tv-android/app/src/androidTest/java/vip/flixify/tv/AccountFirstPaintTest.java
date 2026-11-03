package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.text.DateFormat;
import java.util.Date;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.Account;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AccountFirstPaintTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final FakeTvRepository repository=new FakeTvRepository();
    private MainActivity activity;
    private static final long EXPIRY=1893456000000L;

    @Before public void setup(){
        repository.session=true;
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));
    }
    @After public void close(){
        if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));
    }
    private void launch(){
        activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        instrumentation.waitForIdleSync();
        assertTrue("Startup must verify access before the account request is held",repository.accessRequests>0);
    }
    private View label(View root,String text){
        if(root instanceof TextView&&text.contentEquals(((TextView)root).getText()))return root;
        if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){
            View found=label(((ViewGroup)root).getChildAt(n),text);if(found!=null)return found;
        }
        return null;
    }
    private View label(String text){return label(activity.findViewById(android.R.id.content),text);}
    private String expiry(long time){return "Bitiş: "+DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(new Date(time));}
    private void openAccountWithHeldAuthority(){
        instrumentation.runOnMainSync(()->{repository.delayAccount=true;View account=label("Hesabım");assertNotNull(account);account.performClick();assertNotNull("Account navigation must still force an authority request",repository.delayedAccount);});
    }
    private void assertCachedPaintWithinBudget(){
        long started=SystemClock.elapsedRealtime();
        openAccountWithHeldAuthority();
        boolean[] painted={false};
        do{
            instrumentation.runOnMainSync(()->painted[0]=label("Test Paketi")!=null&&label(expiry(EXPIRY))!=null);
            if(painted[0])break;
            SystemClock.sleep(10);
        }while(SystemClock.elapsedRealtime()-started<500);
        assertTrue("Verified same-account package and expiry must paint within 500 ms while authority is held",painted[0]);
        assertTrue("Account first paint exceeded 500 ms",SystemClock.elapsedRealtime()-started<500);
        instrumentation.runOnMainSync(()->{assertNotNull(repository.delayedAccount);assertNull("A warm account must not wait on a loading screen",label("Hesap yükleniyor…"));assertNull(label("Kullanım analizi tercihi"));assertNull(label("İzin ver"));assertNull(label("İzin verme"));});
    }
    @Test public void cachedAccountPaintsBeforeForcedAuthorityAndExpiryReplacesIt(){
        launch();assertCachedPaintWithinBudget();
        instrumentation.runOnMainSync(()->{
            label("Oturumu kapat").requestFocus();
            repository.accountOverride=new Account("fixture-account","1234","Süresi dolan paket",1600000000000L,false,false,"Paketinin süresi doldu.",Account.Access.EXPIRED);
            repository.releaseDelayedAccount();
            assertNull(label("Test Paketi"));assertNotNull(label("Süresi dolan paket"));assertNotNull(label(expiry(1600000000000L)));assertNotNull(label("Paketinin süresi doldu."));
        });
        instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(()->assertEquals("Oturumu kapat",((TextView)activity.getCurrentFocus()).getText().toString()));
    }
    @Test public void deniedAuthorityReplacesWarmActiveSnapshot(){
        launch();assertCachedPaintWithinBudget();
        instrumentation.runOnMainSync(()->{
            repository.accountOverride=new Account("fixture-account","1234","Erişim kapalı",EXPIRY,false,false,"Hesabın engellendi.",Account.Access.BLOCKED);
            repository.releaseDelayedAccount();
            assertNull(label("Test Paketi"));assertNull(label("Hesabınız aktif"));assertNotNull(label("Hesabın engellendi."));assertNotNull(label("Oturumu kapat"));
        });
    }
    @Test public void anotherOwnerCannotReuseVerifiedSnapshotOrLateAuthority(){
        launch();
        openAccountWithHeldAuthority();
        instrumentation.runOnMainSync(()->{
            TvRepository.Callback<Account> previous=repository.delayedAccount;
            repository.accountId="replacement-account";
            repository.delayAccess=true;
            repository.accountOverride=new Account("replacement-account","9876","Yeni hesap paketi",1600000000000L,true,false,"Yeni hesap aktif");
            label("Ana Sayfa").performClick();label("Hesabım").performClick();
            assertNotNull("Replacement owner must resolve its own authority",repository.delayedAccess);
            assertNull("Previous owner's package must never paint",label("Test Paketi"));assertNull(label(expiry(EXPIRY)));
            previous.onResult(new Account("fixture-account","1234","Eski hesap paketi",EXPIRY,true,false,"Aktif"));
            assertNull("Late authority for another owner must be ignored",label("Eski hesap paketi"));assertNull(label("Test Paketi"));
            repository.releaseAccess();
            assertNotNull(label("Yeni hesap paketi"));assertNotNull(label(expiry(1600000000000L)));assertNull(label("Test Paketi"));
        });
    }
}
