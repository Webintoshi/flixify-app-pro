package vip.flixify.tv;

import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real native navigation and SoundPool decoding, with offline catalogue and no provider media. */
@RunWith(AndroidJUnit4.class)
public final class PosterSoundRemoteTest {
    final FakeTvRepository repository=new FakeTvRepository();
    final List<String> cues=new ArrayList<>();
    int stops,closes;
    View oldFocus;
    @Before public void setup(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
        repository.session=true;TvApplication.setRepositoryForTests(repository);
        PosterFocusSound.setOutputFactoryForTests(context->new PosterFocusSound.Output(){
            public int play(){cues.add(String.valueOf(((Activity)context).getCurrentFocus().getTag()));return cues.size();}
            public void stop(){stops++;}public void close(){closes++;}
        });
    });}
    @After public void tearDown(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
        PosterFocusSound.setOutputFactoryForTests(null);TvApplication.setRepositoryForTests(null);
    });}
    ActivityScenario<MainActivity> launch(){return ActivityScenario.launch(new Intent(ApplicationProvider.getApplicationContext(),MainActivity.class));}
    void key(int code){InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(code);InstrumentationRegistry.getInstrumentation().waitForIdleSync();}
    void enterGrid(){key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_DOWN);}
    void assertFocus(ActivityScenario<MainActivity> scenario,String key){scenario.onActivity(a->assertEquals(key,a.getCurrentFocus().getTag()));}
    @Test public void rapidPosterChangesEachPlayOnceAndUnchangedBoundaryIsSilent(){
        try(ActivityScenario<MainActivity> s=launch()){
            assertTrue(cues.isEmpty());key(KeyEvent.KEYCODE_DPAD_RIGHT);assertTrue(cues.isEmpty());key(KeyEvent.KEYCODE_DPAD_DOWN);
            assertFocus(s,repository.movie.key());
            for(int n=0;n<8;n++){key(KeyEvent.KEYCODE_DPAD_RIGHT);assertFocus(s,repository.movie2.key());key(KeyEvent.KEYCODE_DPAD_LEFT);assertFocus(s,repository.movie.key());}
            assertEquals(17,cues.size());
            for(int n=0;n<cues.size();n++)assertEquals(n%2==0?repository.movie.key():repository.movie2.key(),cues.get(n));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);int count=cues.size();key(KeyEvent.KEYCODE_DPAD_DOWN);assertFocus(s,repository.movie2.key());assertEquals(count,cues.size());
            s.onActivity(a->assertFalse("Custom sound must replace the card's stock click",a.getCurrentFocus().isSoundEffectsEnabled()));
        }
        assertEquals(1,closes);assertTrue(stops>0);
    }
    @Test public void detailBackResizeAndPauseRestoreDoNotDuplicateTheSamePoster(){
        try(ActivityScenario<MainActivity> s=launch()){
            enterGrid();key(KeyEvent.KEYCODE_DPAD_RIGHT);assertEquals(2,cues.size());
            key(KeyEvent.KEYCODE_DPAD_CENTER);key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_BACK);
            assertFocus(s,repository.movie2.key());assertEquals(2,cues.size());
            s.onActivity(a->{ViewGroup viewport=a.findViewById(android.R.id.content);oldFocus=a.getCurrentFocus();ViewGroup.LayoutParams p=viewport.getLayoutParams();p.width=TvUi.dp(a,760);p.height=TvUi.dp(a,400);viewport.setLayoutParams(p);});
            long end=SystemClock.uptimeMillis()+3000;AtomicBoolean restored=new AtomicBoolean();
            do{s.onActivity(a->restored.set(a.getCurrentFocus()!=null && a.getCurrentFocus()!=oldFocus && repository.movie2.key().equals(a.getCurrentFocus().getTag())));SystemClock.sleep(40);}while(!restored.get() && SystemClock.uptimeMillis()<end);
            assertTrue(restored.get());InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertEquals(2,cues.size());
            s.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);s.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertEquals(2,cues.size());
        }
    }
    @Test public void posterDirectionsAreConsumedWithoutChangingNormalToolbarDispatch(){
        try(ActivityScenario<MainActivity> s=launch()){
            enterGrid();
            s.onActivity(a->assertTrue("Poster navigation must avoid ViewRoot's second stock cue",a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_RIGHT))));
            assertFocus(s,repository.movie2.key());assertEquals(2,cues.size());
            key(KeyEvent.KEYCODE_DPAD_UP);int count=cues.size();key(KeyEvent.KEYCODE_DPAD_DOWN);assertEquals(count+1,cues.size());
        }
    }
    @Test public void offscreenPosterRowsKeepOneCuePerMoveThroughRecycling(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->TvApplication.setRepositoryForTests((TvRepository)java.lang.reflect.Proxy.newProxyInstance(
                TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
                    if(method.getName().equals("catalog")) {
                        List<TvModels.Item> items=new ArrayList<>();
                        for(int n=0;n<80;n++)items.add(new TvModels.Item(TvModels.Kind.MOVIE,""+(1000+n),"Poster "+n,"","","","mp4",repository.scope,"",0,0,""));
                        ((TvRepository.Callback<TvModels.Catalog>)args[2]).onResult(new TvModels.Catalog(TvModels.Kind.MOVIE,items,new ArrayList<>()));return null;
                    }
                    return method.invoke(repository,args);
                })));
        try(ActivityScenario<MainActivity> s=launch()){
            enterGrid();assertEquals(1,cues.size());
            for(int direction:new int[]{KeyEvent.KEYCODE_DPAD_DOWN,KeyEvent.KEYCODE_DPAD_UP})for(int n=0;n<8;n++) {
                String prior=cues.get(cues.size()-1);int count=cues.size();key(direction);
                s.onActivity(a->{assertTrue(a.getCurrentFocus().getTag() instanceof String);assertNotEquals(prior,a.getCurrentFocus().getTag());});
                assertEquals("Every offscreen change emits once",count+1,cues.size());
            }
            assertEquals("MOVIE:1000",cues.get(cues.size()-1));
        }
    }
    @Test public void bundledSampleActuallyDecodesAndNativePoolAcceptsRapidPlay(){
        final PosterFocusSound.NativeOutput[] out={null};
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->out[0]=new PosterFocusSound.NativeOutput(ApplicationProvider.getApplicationContext()));
        try{
            AtomicBoolean ready=new AtomicBoolean();long end=SystemClock.uptimeMillis()+4000;
            do{InstrumentationRegistry.getInstrumentation().runOnMainSync(()->ready.set(out[0].ready()));if(!ready.get())SystemClock.sleep(20);}while(!ready.get() && SystemClock.uptimeMillis()<end);
            assertTrue("Bundled user sound decodes before navigation",ready.get());
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{for(int n=0;n<12;n++)assertTrue("Each native cue is accepted",out[0].play()>0);out[0].stop();});
        } finally {InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{out[0].close();assertFalse(out[0].ready());assertEquals(0,out[0].play());});}
    }
}
