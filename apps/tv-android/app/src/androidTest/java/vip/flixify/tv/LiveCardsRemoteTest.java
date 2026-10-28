package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.view.KeyEvent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Measured native cards and player-return behavior, using no external media. */
@RunWith(AndroidJUnit4.class)
public final class LiveCardsRemoteTest {
    final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    final FakeTvRepository repository=new FakeTvRepository();
    MainActivity activity;
    PlayerActivity player;
    @Before public void setup(){repository.session=true;instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));}
    @After public void cleanup(){instrumentation.runOnMainSync(()->{if(player!=null)player.finish();if(activity!=null)activity.finish();TvApplication.setRepositoryForTests(null);});}
    void launch(){activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));idle();}
    void idle(){instrumentation.waitForIdleSync();}
    void awaitStage(android.app.Activity target,Stage expected){
        final boolean[] reached={false};long end=SystemClock.uptimeMillis()+5000;
        do{instrumentation.runOnMainSync(()->reached[0]=ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(target)==expected);if(!reached[0])SystemClock.sleep(25);}while(!reached[0] && SystemClock.uptimeMillis()<end);
        assertTrue("Activity reaches "+expected,reached[0]);idle();
    }
    void awaitCardFocus(String key){
        final boolean[] ready={false};long end=SystemClock.uptimeMillis()+5000;
        do{instrumentation.runOnMainSync(()->{View focus=activity.getCurrentFocus();ready[0]=focus!=null && key.equals(focus.getTag());});if(!ready[0])SystemClock.sleep(25);}while(!ready[0] && SystemClock.uptimeMillis()<end);
        assertTrue("Catalog restores card focus",ready[0]);
    }
    void key(int code){instrumentation.sendKeyDownUpSync(code);idle();}
    void openSection(int n){for(int i=0;i<n;i++)key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);}
    RecyclerView grid(View view){if(view instanceof RecyclerView)return (RecyclerView)view;if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){RecyclerView found=grid(((ViewGroup)view).getChildAt(n));if(found!=null)return found;}return null;}
    ImageView artwork(View view){if(view instanceof ImageView)return (ImageView)view;if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){ImageView found=artwork(((ViewGroup)view).getChildAt(n));if(found!=null)return found;}return null;}
    @Test public void liveLogoAreaIsLandscapeAndContainsWholeLogo(){
        launch();openSection(1);
        instrumentation.runOnMainSync(()->{
            RecyclerView list=grid(activity.getWindow().getDecorView());assertNotNull(list);
            View card=list.findViewHolderForAdapterPosition(0).itemView;ImageView logo=artwork(card);assertNotNull(logo);
            assertTrue("Live logo must be wider than tall",logo.getWidth()>logo.getHeight()*1.4f);
            assertEquals("Whole logo must fit without cropping",ImageView.ScaleType.FIT_CENTER,logo.getScaleType());
            assertTrue("Live logos need breathing room",logo.getPaddingLeft()>0 && logo.getPaddingTop()>0);
        });
    }
    @Test public void mixedFavoritesKeepLiveWideAndMoviesPortrait(){
        repository.saved.add(repository.movie.key());repository.saved.add(repository.show.key());repository.saved.add(repository.live.key());launch();openSection(4);
        instrumentation.runOnMainSync(()->{
            RecyclerView list=grid(activity.getWindow().getDecorView());GridLayoutManager layout=(GridLayoutManager)list.getLayoutManager();
            View movie=list.findViewHolderForAdapterPosition(0).itemView;ImageView poster=artwork(movie);
            assertTrue("Movie poster keeps portrait proportions",poster.getHeight()>poster.getWidth());
            assertEquals("Live cards occupy a separate wide row",layout.getSpanCount(),layout.getSpanSizeLookup().getSpanSize(2));
            list.scrollToPosition(2);
        });idle();
        instrumentation.runOnMainSync(()->{
            RecyclerView list=grid(activity.getWindow().getDecorView());ImageView logo=artwork(list.findViewHolderForAdapterPosition(2).itemView);
            assertTrue("Favorites live logo stays landscape",logo.getWidth()>logo.getHeight()*1.4f);
            assertEquals(ImageView.ScaleType.FIT_CENTER,logo.getScaleType());
        });
    }
    @Test public void removingFavoriteInsidePlayerRefreshesListOnReturn(){
        repository.saved.add(repository.movie.key());repository.saved.add(repository.live.key());launch();openSection(4);key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_DOWN);
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,false);
        try{
            key(KeyEvent.KEYCODE_DPAD_CENTER);player=(PlayerActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull("Favorite opens player",player);
            awaitStage(player,Stage.RESUMED);awaitStage(activity,Stage.STOPPED);
            instrumentation.runOnMainSync(()->{repository.saved.remove(repository.movie.key());player.finish();});player=null;idle();
            awaitStage(activity,Stage.RESUMED);
            awaitCardFocus(repository.live.key());
            instrumentation.runOnMainSync(()->{
                RecyclerView list=grid(activity.getWindow().getDecorView());assertNotNull(list);assertEquals(1,list.getAdapter().getItemCount());
                assertEquals(repository.live.key(),activity.getCurrentFocus().getTag());
            });
        }finally{instrumentation.removeMonitor(monitor);}
    }
}
