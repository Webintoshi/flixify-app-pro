package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.Account;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TrialCountdownUiTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private final FakeTvRepository repository=new FakeTvRepository();
    private MainActivity activity;
    private final long serverNow=1794052800000L;
    @Before public void prepare(){repository.session=true;instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));}
    @After public void close(){if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));}
    private Account account(String status,boolean paid){
        TrialCountdown timer=TrialCountdown.fromServer(status,serverNow,serverNow+(status.equals("expired")?-1000:10800000),SystemClock.elapsedRealtime());
        boolean active=status.equals("active")||paid;
        return new Account("fixture-account","1234",paid?"1 Aylık":"3 Saat Deneme",1893456000000L,active,!paid,"Fixture erişim",active?Account.Access.ACTIVE:status.equals("pending")?Account.Access.TRIAL_PENDING:Account.Access.EXPIRED,timer);
    }
    private void launch(){activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));instrumentation.waitForIdleSync();}
    private View text(View view,String label){if(view instanceof TextView&&label.contentEquals(((TextView)view).getText()))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=text(((ViewGroup)view).getChildAt(i),label);if(found!=null)return found;}return null;}
    private void openAccount(){instrumentation.runOnMainSync(()->{View button=text(activity.findViewById(android.R.id.content),"Hesabım");assertNotNull(button);button.performClick();});instrumentation.waitForIdleSync();}
    private TextView clock(String tag){return activity.findViewById(android.R.id.content).findViewWithTag(tag);}
    @Test public void localTicksUpdateOnlyTheLabelsWithoutReloadingTheAccountOrCatalog(){
        repository.accountOverride=account("active",false);launch();openAccount();
        TextView[] previous={null};String[] before={null};int[] calls={0,0};
        instrumentation.runOnMainSync(()->{previous[0]=clock("tv-account-trial-countdown");assertNotNull(previous[0]);assertEquals(View.VISIBLE,previous[0].getVisibility());before[0]=previous[0].getText().toString();assertTrue(before[0].startsWith("Deneme süren · "));calls[0]=repository.accessRequests;calls[1]=repository.catalogRequests;});
        SystemClock.sleep(2100);instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(()->{assertSame(previous[0],clock("tv-account-trial-countdown"));assertNotEquals(before[0],previous[0].getText().toString());assertEquals(calls[0],repository.accessRequests);assertEquals(calls[1],repository.catalogRequests);assertEquals(previous[0].getText(),clock("tv-trial-countdown").getText());});
    }
    @Test public void paidAuthorityHidesBothTrialClocks(){
        repository.accountOverride=account("active",false);launch();openAccount();
        repository.accountOverride=account("none",true);openAccount();
        instrumentation.runOnMainSync(()->{assertEquals(View.GONE,clock("tv-trial-countdown").getVisibility());assertEquals(View.GONE,clock("tv-account-trial-countdown").getVisibility());});
    }
    @Test public void pendingProvisioningShowsPreparationWithoutARunningClock(){
        repository.accountOverride=account("pending",false);launch();
        instrumentation.runOnMainSync(()->assertEquals("Deneme hazırlanıyor",clock("tv-trial-countdown").getText().toString()));
    }
    @Test public void expiredTrialShowsItsEndAndKeepsTheExistingPackageScreen(){
        repository.accountOverride=account("expired",false);launch();
        instrumentation.runOnMainSync(()->{assertEquals("Deneme süren doldu",clock("tv-trial-countdown").getText().toString());assertNotNull(text(activity.findViewById(android.R.id.content),"Paketleri yenile"));});
    }
    @Test public void periodicClockRefreshUsesTheCachedAccountWithoutAnotherForcedProviderCheck()throws Exception{
        repository.accountOverride=account("active",false);launch();openAccount();
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("trialRefresh");field.setAccessible(true);Runnable refresh=(Runnable)field.get(activity);
        instrumentation.runOnMainSync(()->{TextView existing=clock("tv-account-trial-countdown");int access=repository.accessRequests,catalog=repository.catalogRequests;refresh.run();assertEquals(access,repository.accessRequests);assertEquals(catalog,repository.catalogRequests);assertSame(existing,clock("tv-account-trial-countdown"));});
    }
}
