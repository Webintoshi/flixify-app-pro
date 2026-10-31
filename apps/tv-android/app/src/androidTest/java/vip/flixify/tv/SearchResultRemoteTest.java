package vip.flixify.tv;

import android.app.Dialog;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.lang.reflect.Field;
import java.util.Arrays;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;

/** Search selection uses the real dialog, window-focus handoff and remote, without provider media. */
@RunWith(AndroidJUnit4.class)
public final class SearchResultRemoteTest {
    final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    final FakeTvRepository repository=new FakeTvRepository();
    MainActivity activity;
    PlayerActivity player;
    @Before public void setup(){repository.session=true;instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));}
    @After public void cleanup(){instrumentation.runOnMainSync(()->{if(player!=null)player.finish();if(activity!=null)activity.finish();TvApplication.setRepositoryForTests(null);});}
    void launch(){activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));instrumentation.waitForIdleSync();await("Catalogue window ready",()->activity.hasWindowFocus() && activity.findViewById(android.R.id.content).findViewWithTag("tv-startup-overlay")==null);}
    void key(int code){instrumentation.sendKeyDownUpSync(code);instrumentation.waitForIdleSync();}
    interface Check {boolean ready();}
    void await(String message,Check check){boolean[] ready={false};long end=SystemClock.uptimeMillis()+5000;do{instrumentation.runOnMainSync(()->ready[0]=check.ready());if(ready[0])return;SystemClock.sleep(25);}while(SystemClock.uptimeMillis()<end);fail(message);}
    Dialog panel(){try{Field f=MainActivity.class.getDeclaredField("catalogDialog");f.setAccessible(true);return (Dialog)f.get(activity);}catch(Exception e){throw new AssertionError(e);}}
    View tag(String value){Dialog d=panel();return d==null?null:d.findViewById(android.R.id.content).findViewWithTag(value);}
    View text(View v,String title){if(!v.isShown())return null;if(v instanceof TextView && title.contentEquals(((TextView)v).getText()))return v;if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++){View found=text(((ViewGroup)v).getChildAt(n),title);if(found!=null)return found;}return null;}
    View result(String title){View preview=tag("tv_search_preview");return preview==null?null:text(preview,title);}
    void awaitResult(String title){await("Current query preview contains the matching item",()->result(title)!=null && text(tag("tv_search_preview"),"1 sonuç")!=null);}
    void openSearch(String query){instrumentation.runOnMainSync(()->{View search=text(activity.findViewById(android.R.id.content),"Ara");assertNotNull(search);search.requestFocus();});key(KeyEvent.KEYCODE_DPAD_CENTER);await("Search editor focused",()->tag("tv_search_input")!=null && tag("tv_search_input").hasFocus());instrumentation.runOnMainSync(()->((EditText)tag("tv_search_input")).setText(query));}
    Item selectResultWithRemote(String title){
        awaitResult(title);
        instrumentation.runOnMainSync(()->assertTrue("A search result must accept remote focus",result(title).isFocusable()));
        key(KeyEvent.KEYCODE_DPAD_DOWN);
        instrumentation.runOnMainSync(()->assertTrue("Down from the editor focuses its first result",result(title).hasFocus()));
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,false);
        try{key(KeyEvent.KEYCODE_DPAD_CENTER);player=(PlayerActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull("OK on the search result opens playback without Ara or another poster click",player);await("Player is foreground before returning",()->ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(player)==Stage.RESUMED && ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(activity)==Stage.STOPPED);return (Item)player.getIntent().getSerializableExtra(PlayerActivity.EXTRA_ITEM);}finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void resultOkOpensTheSelectedMovieDirectly(){
        launch();openSearch("Deniz");Item chosen=selectResultWithRemote(repository.movie2.title);
        assertEquals(Kind.MOVIE,chosen.kind);assertEquals(repository.movie2.key(),chosen.key());
        instrumentation.runOnMainSync(()->player.finish());player=null;
        await("Back from playback keeps the search and selected poster focus",()->activity.hasWindowFocus() && activity.getCurrentFocus()!=null && repository.movie2.key().equals(activity.getCurrentFocus().getTag()) && text(activity.findViewById(android.R.id.content),"Arama: Deniz · 1 sonuç")!=null);
    }
    @Test public void duplicateTitlesResolveByIdentityInsideSelectedCategory(){
        Item first=new Item(Kind.MOVIE,"first","Avengers","1","Bilim Kurgu","","mp4",repository.scope,"",0,0,"");
        Item second=new Item(Kind.MOVIE,"second","Avengers","2","Drama","","mp4",repository.scope,"",0,0,"");
        repository.catalogOverrides.put(Kind.MOVIE,new Catalog(Kind.MOVIE,Arrays.asList(first,second),Arrays.asList(new Category("1","Bilim Kurgu"),new Category("2","Drama"))));
        launch();instrumentation.runOnMainSync(()->text(activity.findViewById(android.R.id.content),"Kategori: Tümü").requestFocus());key(KeyEvent.KEYCODE_DPAD_CENTER);await("Category panel focused",()->tag("tv_categories_list")!=null && tag("tv_categories_list").hasFocus());key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
        await("Drama category applied",()->text(activity.findViewById(android.R.id.content),"Kategori: Drama")!=null);
        openSearch("Avengers");Item chosen=selectResultWithRemote("Avengers");assertEquals("second",chosen.id);
    }
    @Test public void seriesResultUsesTheExistingDirectSeriesPlayer(){
        launch();key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
        await("Series catalogue",()->text(activity.findViewById(android.R.id.content),repository.show.title)!=null);
        openSearch("Yıldız");Item chosen=selectResultWithRemote(repository.show.title);assertEquals(Kind.SERIES,chosen.kind);assertEquals("201",chosen.id);
    }
    @Test public void oldPreviewCannotLaunchAfterTheQueryChangesBeforeDebounce(){
        launch();openSearch("Uzay");awaitResult(repository.movie.title);
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,true);
        try{
            instrumentation.runOnMainSync(()->{View old=result(repository.movie.title);assertTrue("Preview is an actual selectable result",old.isClickable());((EditText)tag("tv_search_input")).setText("Deniz");old.performClick();});
            awaitResult(repository.movie2.title);assertEquals("Stale preview cannot start an unrelated movie",0,monitor.getHits());
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void replacedSourceCannotLaunchTheOldPreview(){
        launch();openSearch("Deniz");awaitResult(repository.movie2.title);
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,true);
        try{
            instrumentation.runOnMainSync(()->{View old=result(repository.movie2.title);assertTrue("Preview is an actual selectable result",old.isClickable());repository.scope="replacement-source";old.performClick();});
            await("Old-source dialog closes",()->panel()==null);assertEquals("An obsolete account/source result must not open playback",0,monitor.getHits());
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void catalogueRefreshCannotLaunchAResultItRemovedWhileSearchWasOpen(){
        launch();openSearch("Deniz");awaitResult(repository.movie2.title);
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,true);
        try{
            instrumentation.runOnMainSync(()->{View old=result(repository.movie2.title);repository.publishCatalog(new Catalog(Kind.MOVIE,Arrays.asList(repository.movie),Arrays.asList(new Category("1","Bilim Kurgu"))));old.performClick();});
            await("Removed result leaves a refreshed catalogue",()->panel()==null && activity.hasWindowFocus() && text(activity.findViewById(android.R.id.content),repository.movie.title)!=null && text(activity.findViewById(android.R.id.content),repository.movie2.title)==null);
            assertEquals("A removed result cannot launch playback",0,monitor.getHits());
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void thirdSearchResultRestoresItsFocusInsteadOfThePreviouslyFocusedPoster(){
        Item first=new Item(Kind.MOVIE,"one","Deniz Bir","2","Drama","","mp4",repository.scope,"",0,0,"");
        Item second=new Item(Kind.MOVIE,"two","Deniz İki","2","Drama","","mp4",repository.scope,"",0,0,"");
        Item third=new Item(Kind.MOVIE,"three","Deniz Üç","2","Drama","","mp4",repository.scope,"",0,0,"");
        repository.catalogOverrides.put(Kind.MOVIE,new Catalog(Kind.MOVIE,Arrays.asList(first,second,third),Arrays.asList(new Category("2","Drama"))));
        launch();key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_DOWN);
        instrumentation.runOnMainSync(()->{assertEquals(first.key(),activity.getCurrentFocus().getTag());text(activity.findViewById(android.R.id.content),"Ara").performClick();});
        await("Search editor owns focus",()->tag("tv_search_input")!=null && tag("tv_search_input").hasFocus());
        instrumentation.runOnMainSync(()->((EditText)tag("tv_search_input")).setText("Deniz"));
        await("All three results belong to the current query",()->text(tag("tv_search_preview"),"3 sonuç")!=null);
        key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);
        instrumentation.runOnMainSync(()->assertTrue(result(third.title).hasFocus()));
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,false);
        try{
            key(KeyEvent.KEYCODE_DPAD_CENTER);player=(PlayerActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull(player);assertEquals(third.key(),((Item)player.getIntent().getSerializableExtra(PlayerActivity.EXTRA_ITEM)).key());
            await("Player foreground",()->ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(player)==Stage.RESUMED && ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(activity)==Stage.STOPPED);
            instrumentation.runOnMainSync(()->{
                Bundle saved=new Bundle();instrumentation.callActivityOnSaveInstanceState(activity,saved);
                try{java.lang.reflect.Method find=MainActivity.class.getDeclaredMethod("findFocus",View.class,String.class);find.setAccessible(true);View restored=(View)find.invoke(activity,activity.findViewById(android.R.id.content),saved.getString("controlFocus"));assertNotNull("Saved search focus must resolve through the actual focus-restoration consumer",restored);assertEquals(third.key(),restored.getTag());}catch(ReflectiveOperationException failure){throw new AssertionError(failure);}
            });
            instrumentation.runOnMainSync(()->player.finish());player=null;
            await("Returning keeps query and the third selected result focused",()->activity.hasWindowFocus() && activity.getCurrentFocus()!=null && third.key().equals(activity.getCurrentFocus().getTag()) && text(activity.findViewById(android.R.id.content),"Arama: Deniz · 3 sonuç")!=null);
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void catalogueRefreshAfterDialogDismissalStillStartsTheMatchingCurrentItem(){
        launch();openSearch("Deniz");awaitResult(repository.movie2.title);
        Item fresh=new Item(Kind.MOVIE,"102","Deniz Güncel","2","Drama","","mp4",repository.scope,"",0,0,"");
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,false);
        try{
            instrumentation.runOnMainSync(()->{result(repository.movie2.title).performClick();repository.publishCatalog(new Catalog(Kind.MOVIE,Arrays.asList(repository.movie,fresh),Arrays.asList(new Category("1","Bilim Kurgu"),new Category("2","Drama"))));});
            player=(PlayerActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull("A same-source refresh during the focus handoff must not swallow selection",player);
            Item chosen=(Item)player.getIntent().getSerializableExtra(PlayerActivity.EXTRA_ITEM);assertEquals("102",chosen.id);assertEquals("Deniz Güncel",chosen.title);
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void catalogueRefreshAfterDismissalCancelsAnItemItRemoved(){
        launch();openSearch("Deniz");awaitResult(repository.movie2.title);
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,true);
        try{
            instrumentation.runOnMainSync(()->{result(repository.movie2.title).performClick();repository.publishCatalog(new Catalog(Kind.MOVIE,Arrays.asList(repository.movie),Arrays.asList(new Category("1","Bilim Kurgu"))));});
            await("Removed item is absent after dismissal",()->panel()==null && activity.hasWindowFocus() && text(activity.findViewById(android.R.id.content),repository.movie.title)!=null && text(activity.findViewById(android.R.id.content),repository.movie2.title)==null);
            assertEquals("A removed item is not started during focus handoff",0,monitor.getHits());
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void sourceReplacementAfterDismissalInvalidatesTheOldSelectionImmediately(){
        launch();openSearch("Deniz");awaitResult(repository.movie2.title);
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,true);
        try{
            instrumentation.runOnMainSync(()->{result(repository.movie2.title).performClick();repository.scope="replacement-source";Item replacement=new Item(Kind.MOVIE,"replacement","Yeni Kaynak Filmi","1","Yeni","","mp4",repository.scope,"",0,0,"");Catalog updated=new Catalog(Kind.MOVIE,Arrays.asList(replacement),Arrays.asList(new Category("1","Yeni")));repository.catalogOverrides.put(Kind.MOVIE,updated);repository.publishCatalog(updated);});
            await("Replacement source appears without old results",()->panel()==null && activity.hasWindowFocus() && text(activity.findViewById(android.R.id.content),"Yeni Kaynak Filmi")!=null && text(activity.findViewById(android.R.id.content),repository.movie2.title)==null);
            assertEquals("A replaced source cannot start old playback",0,monitor.getHits());
        }finally{instrumentation.removeMonitor(monitor);}
    }
}
