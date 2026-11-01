package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.view.KeyEvent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
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
        instrumentation.runOnMainSync(()->{DiscoveryScreen screen=activity.getWindow().getDecorView().findViewWithTag("tv-discovery");assertNotNull(screen);assertTrue(screen.focusItem(repository.movie.key()));});awaitCardFocus(repository.movie.key());awaitArtworkShape(repository.movie.key(),true);
        instrumentation.runOnMainSync(()->{
            View movie=activity.getCurrentFocus();assertEquals(repository.movie.key(),movie.getTag());ImageView poster=artwork(movie);assertNotNull(poster);
            assertTrue("Movie poster keeps portrait proportions",poster.getHeight()>poster.getWidth());
            assertTrue("The visible movie belongs to a horizontal movie shelf",movie.getParent() instanceof RecyclerView && ((View)movie.getParent()).getParent() instanceof View && "tv-rail-favorites-movie".equals(((View)((View)movie.getParent()).getParent()).getTag()));
            assertTrue(((DiscoveryScreen)activity.getWindow().getDecorView().findViewWithTag("tv-discovery")).focusItem(repository.live.key()));
        });awaitCardFocus(repository.live.key());awaitArtworkShape(repository.live.key(),false);
        instrumentation.runOnMainSync(()->{
            View live=activity.getCurrentFocus();assertEquals(repository.live.key(),live.getTag());ImageView logo=artwork(live);assertNotNull(logo);
            assertTrue("Live favorites have their own shelf",live.getParent() instanceof RecyclerView && ((View)live.getParent()).getParent() instanceof View && "tv-rail-favorites-live".equals(((View)((View)live.getParent()).getParent()).getTag()));
            assertTrue("Favorites live logo stays landscape",logo.getWidth()>logo.getHeight()*1.4f);
            assertEquals(ImageView.ScaleType.FIT_CENTER,logo.getScaleType());
            assertTrue(logo.getPaddingLeft()>0 && logo.getPaddingTop()>0);assertNotNull("Live logo keeps its backplate",logo.getBackground());
        });
    }
    void awaitArtworkShape(String key,boolean portrait){
        long deadline=SystemClock.uptimeMillis()+3000;boolean[] ready={false};String[] measured={"No focused artwork"};
        do{
            idle();instrumentation.runOnMainSync(()->{
                View card=activity.getCurrentFocus();ImageView image=card!=null && key.equals(card.getTag())?artwork(card):null;android.graphics.Rect imageBounds=new android.graphics.Rect();
                ready[0]=image!=null && image.getWidth()>0 && image.getHeight()>0 && image.getGlobalVisibleRect(imageBounds) && (portrait?image.getHeight()>image.getWidth():image.getWidth()>image.getHeight()*1.4f);
                View shelf=card!=null && card.getParent() instanceof View?(View)card.getParent():null;View surface=activity.getWindow().getDecorView().findViewWithTag("tv-discovery");
                measured[0]="image="+geometry(image)+", card="+geometry(card)+", shelfRecycler="+geometry(shelf)+", discoveryRecycler="+geometry(surface)+", density="+activity.getResources().getDisplayMetrics().density;
            });if(!ready[0])SystemClock.sleep(25);
        }while(!ready[0] && SystemClock.uptimeMillis()<deadline);
        assertTrue((portrait?"Portrait movie":"Landscape live")+" artwork is measured and visible after nested layout; "+measured[0],ready[0]);
    }
    String geometry(View view){if(view==null)return "missing";android.graphics.Rect visible=new android.graphics.Rect();view.getGlobalVisibleRect(visible);return view.getWidth()+"x"+view.getHeight()+" visible="+visible;}
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

    @Test public void visibleFavoritesApplyLivePolicyAndRestoreSavedChannelWithoutChangingNonLiveItems(){
        repository.saved.add(repository.movie.key());repository.saved.add(repository.live.key());launch();openSection(4);
        instrumentation.runOnMainSync(()->assertEquals(2,grid(activity.getWindow().getDecorView()).getAdapter().getItemCount()));
        instrumentation.runOnMainSync(()->repository.publishCatalog(new vip.flixify.tv.TvModels.Catalog(vip.flixify.tv.TvModels.Kind.LIVE,java.util.Collections.emptyList(),java.util.Collections.emptyList())));idle();
        instrumentation.runOnMainSync(()->{
            RecyclerView list=grid(activity.getWindow().getDecorView());assertEquals("Excluded live favorite leaves the visible grid",1,list.getAdapter().getItemCount());
            assertEquals("Stored favorites are not deleted",2,repository.saved.size());
            assertTrue(repository.saved.contains(repository.movie.key()));assertTrue(repository.saved.contains(repository.live.key()));
        });
        instrumentation.runOnMainSync(()->repository.publishCatalog(new vip.flixify.tv.TvModels.Catalog(vip.flixify.tv.TvModels.Kind.LIVE,java.util.Collections.singletonList(repository.live),java.util.Collections.emptyList())));idle();
        instrumentation.runOnMainSync(()->assertEquals("Removing exclusion restores the saved channel",2,grid(activity.getWindow().getDecorView()).getAdapter().getItemCount()));
    }
}
