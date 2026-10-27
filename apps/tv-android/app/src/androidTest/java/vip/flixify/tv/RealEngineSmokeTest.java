package vip.flixify.tv;

import android.content.Context;
import android.os.SystemClock;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.player.Media3PlayerEngine;
import vip.flixify.tv.player.PlayerEngine;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Real ExoPlayer + local official test MP4 only. No production API or stream. */
@RunWith(AndroidJUnit4.class)
@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
public class RealEngineSmokeTest {
 @Test public void realDecoderRendersLocalFixtureAndSupportsPauseSeekRelease() throws Exception {
  Context target=ApplicationProvider.getApplicationContext();
  File file=new File(target.getCacheDir(),"media3-fixture.mp4");
  try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("sample.mp4");FileOutputStream output=new FileOutputStream(file)){
   byte[] bytes=new byte[8192];int n;while((n=input.read(bytes))!=-1)output.write(bytes,0,n);
  }
  FakeTvRepository repository=new FakeTvRepository();repository.session=true;
  TvApplication.setRepositoryForTests(repository);
  CountDownLatch ready=new CountDownLatch(1);AtomicBoolean error=new AtomicBoolean();
  final Media3PlayerEngine[] engine={null};
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
   scenario.onActivity(activity->{
    engine[0]=new Media3PlayerEngine(activity,new PlayerEngine.Listener(){
     public void onStateChanged(int state){if(state==PlayerEngine.READY)ready.countDown();}
     public void onTracksChanged(){}
     public void onError(){error.set(true);ready.countDown();}
    });
    activity.addContentView(engine[0].view(),new ViewGroup.LayoutParams(-1,-1));
    engine[0].prepare(new Playback(repository.movie,file.toURI().toString(),"video/mp4",System.currentTimeMillis()+60000,0,null),0,false);
   });
   assertTrue("Local decoder ready",ready.await(12,TimeUnit.SECONDS));assertFalse("Local fixture playback error",error.get());
   scenario.onActivity(activity->{assertTrue(engine[0].duration()>0);engine[0].seek(200);engine[0].play();});
   long until=SystemClock.uptimeMillis()+4000;AtomicBoolean progressed=new AtomicBoolean();
   while(SystemClock.uptimeMillis()<until&&!progressed.get()) {scenario.onActivity(activity->progressed.set(engine[0].position()>250));SystemClock.sleep(25);}
   assertTrue("Actual local playback position advanced",progressed.get());
   scenario.onActivity(activity->{engine[0].pause();assertFalse(engine[0].wantsToPlay());engine[0].release();engine[0]=null;});
  } finally {
   InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{if(engine[0]!=null)engine[0].release();TvApplication.setRepositoryForTests(null);});
   file.delete();
  }
 }
}
