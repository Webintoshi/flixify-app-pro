package vip.flixify.tv;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.player.PlayerEngine;
import static org.junit.Assert.*;

/** No provider, account, remote URL or decoder is touched. Input drives the real Activity UI. */
@RunWith(AndroidJUnit4.class)
public final class PlayerRemoteTest {
    private final FakeRepository repository = new FakeRepository();
    private final List<FakeEngine> engines = new ArrayList<>();
    @Before public void setup() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            TvApplication.setRepositoryForTests(repository);
            PlayerActivity.setEngineFactoryForTests((context, listener) -> {
                FakeEngine result = new FakeEngine(context, listener); engines.add(result); return result;
            });
        });
    }
    @After public void teardown() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            PlayerActivity.setEngineFactoryForTests(null);
            TvApplication.setRepositoryForTests(null);
        });
    }
    private ActivityScenario<PlayerActivity> launch(Item item) {
        Intent intent = new Intent(ApplicationProvider.getApplicationContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_ITEM, item);
        return ActivityScenario.launch(intent);
    }
    private void key(int keyCode) { InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(keyCode);InstrumentationRegistry.getInstrumentation().waitForIdleSync(); }
    private interface Condition { boolean matches(PlayerActivity activity); }
    private void await(ActivityScenario<PlayerActivity> scenario,String reason,Condition condition) {
        long end=SystemClock.elapsedRealtime()+3000;
        AtomicBoolean result=new AtomicBoolean();
        do {
            scenario.onActivity(activity -> result.set(condition.matches(activity)));
            if(result.get())return;
            SystemClock.sleep(20);
        } while(SystemClock.elapsedRealtime()<end);
        scenario.onActivity(activity -> fail(reason+"; window="+activity.hasWindowFocus()+", focus="+(activity.getCurrentFocus()==null?"none":activity.getCurrentFocus().getTag())));
    }
    private void awaitDialog(String uniqueText) {
        long end=SystemClock.elapsedRealtime()+3000;
        do {
            AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            if(root!=null && !root.findAccessibilityNodeInfosByText(uniqueText).isEmpty())return;
            SystemClock.sleep(20);
        } while(SystemClock.elapsedRealtime()<end);
        fail("Track dialog did not expose "+uniqueText);
    }
    private boolean focused(PlayerActivity activity,String tag) {return activity.hasWindowFocus() && activity.getCurrentFocus()!=null && tag.equals(activity.getCurrentFocus().getTag());}
    private FakeEngine latest() { return engines.get(engines.size()-1); }
    @Test public void mediaKeysSeekAndStopReleaseVod() {
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.movie)) {
            scenario.onActivity(activity -> assertTrue(activity.findViewById(android.R.id.content).findViewWithTag("tv_player_play").hasFocus()));
            key(KeyEvent.KEYCODE_MEDIA_PAUSE);
            scenario.onActivity(activity -> assertFalse(latest().playing));
            key(KeyEvent.KEYCODE_MEDIA_PLAY);
            key(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD);
            scenario.onActivity(activity -> { assertTrue(latest().playing); assertEquals(22000, latest().position); });
            key(KeyEvent.KEYCODE_MEDIA_REWIND);
            scenario.onActivity(activity -> assertEquals(12000, latest().position));
        }
        assertTrue(latest().released);
        assertTrue(repository.savedPosition >= 12000);
    }
    @Test public void liveZappingReleasesBeforeNextEngineAndNeverSeeks() {
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.live1)) {
            key(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD);
            scenario.onActivity(activity -> assertEquals(0, latest().position));
            key(KeyEvent.KEYCODE_CHANNEL_UP);
            scenario.onActivity(activity -> {
                assertEquals(repository.live2.id, repository.lastPlayback.id);
                assertEquals(2, engines.size()); assertTrue(engines.get(0).released);
                assertEquals(0, latest().position);
            });
        }
    }
    @Test public void nextEpisodeAndTrackDialogsAreRemoteReachable() {
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.episode)) {
            scenario.onActivity(activity -> assertEquals(View.VISIBLE,activity.findViewById(android.R.id.content).findViewWithTag("tv_player_next").getVisibility()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT); key(KeyEvent.KEYCODE_DPAD_RIGHT); key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_audio", activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            awaitDialog("Otomatik");
            key(KeyEvent.KEYCODE_DPAD_DOWN); key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(scenario,"Audio choice must apply",activity -> latest().selectedAudio>=0);
            await(scenario,"Audio dialog must restore remote focus",activity -> focused(activity,"tv_player_audio"));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            await(scenario,"Subtitles must be remote reachable",activity -> focused(activity,"tv_player_subtitles"));
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            awaitDialog("Kapalı");
            key(KeyEvent.KEYCODE_DPAD_DOWN); key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(scenario,"Subtitle choice must apply",activity -> latest().selectedSubtitle>=0);
            await(scenario,"Subtitle dialog must restore remote focus",activity -> focused(activity,"tv_player_subtitles"));
            key(KeyEvent.KEYCODE_MEDIA_NEXT);
            scenario.onActivity(activity -> { assertEquals(repository.next.id, repository.lastPlayback.id); assertTrue(engines.get(0).released); });
        }
    }
    @Test public void controlsHideAfterTwoSecondsAndDpadRestoresThem() throws Exception {
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.movie)) {
            Thread.sleep(2300);
            scenario.onActivity(activity -> assertEquals(View.GONE, activity.findViewById(android.R.id.content).findViewWithTag("tv_player_controls").getVisibility()));
            key(KeyEvent.KEYCODE_DPAD_UP);
            scenario.onActivity(activity -> { assertEquals(View.VISIBLE, activity.findViewById(android.R.id.content).findViewWithTag("tv_player_controls").getVisibility()); assertNotNull(activity.getCurrentFocus()); });
            key(KeyEvent.KEYCODE_MEDIA_PAUSE);
            Thread.sleep(2200);
            scenario.onActivity(activity -> assertEquals(View.VISIBLE, activity.findViewById(android.R.id.content).findViewWithTag("tv_player_controls").getVisibility()));
        }
    }
    @Test public void absoluteExpiryAndSourceChangeReleaseAndStop() throws Exception {
        repository.ttl = 900;
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.movie)) {
            Thread.sleep(1300);
            scenario.onActivity(activity -> assertTrue(latest().released));
        }
        repository.ttl = -1;
        repository.expiry = System.currentTimeMillis()+60000;
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.movie)) {
            repository.scope = "fixture:source2";
            Thread.sleep(1200);
            scenario.onActivity(activity -> assertTrue(latest().released));
        }
    }
    @Test public void resumeRejectsExpiredOldAccessBeforeReopeningEvenWithFutureFixtureExpiry() throws Exception {
        repository.ttl=900;
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.movie)) {
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            assertTrue(latest().released);
            Thread.sleep(1100);
            repository.ttl=-1;repository.expiry=System.currentTimeMillis()+60000;
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            scenario.onActivity(activity -> {assertTrue(latest().released);assertEquals(1,engines.size());});
        }
    }
    @Test public void transientRefreshKeepsPlaybackOnlyUntilConfirmedOldCutoff() throws Exception {
        repository.ttl=1700;repository.accessFailure=Failure.Code.NETWORK;
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            Thread.sleep(400);
            scenario.onActivity(activity -> {assertFalse(latest().released);assertEquals(1,engines.size());});
            Thread.sleep(1600);
            scenario.onActivity(activity -> assertTrue(latest().released));
        }
    }
    @Test public void accessRefreshChangesCutoffWithoutRecreatingEngine() throws Exception {
        repository.deferAccess=true;
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            scenario.onActivity(activity -> {
                repository.pendingAccess.onResult(new Account("fixture","0000","Fixture",System.currentTimeMillis()+800,true,false,""));
                assertEquals(1,engines.size());assertFalse(latest().released);
            });
            Thread.sleep(1100);
            scenario.onActivity(activity -> {assertEquals(1,engines.size());assertTrue(latest().released);});
        }
    }
    @Test public void authoritativeDenialReleasesImmediatelyAndRecoveryBudgetIsBounded() {
        repository.accessFailure=Failure.Code.INELIGIBLE;
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            scenario.onActivity(activity -> assertTrue(latest().released));
        }
        repository.accessFailure=null;
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            int before=engines.size();
            scenario.onActivity(activity -> {
                latest().listener.onError();latest().listener.onError();
                assertEquals(before+2,engines.size());
                latest().listener.onError();
                assertEquals(before+2,engines.size());assertTrue(latest().released);
            });
        }
    }
    @Test public void onlyNearEndEpisodePlaybackIsMarkedWatched() {
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            key(KeyEvent.KEYCODE_MEDIA_NEXT);
            scenario.onActivity(activity -> assertEquals(0,repository.watched));
        }
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> latest().position=295000);
            key(KeyEvent.KEYCODE_MEDIA_NEXT);
            scenario.onActivity(activity -> assertEquals(1,repository.watched));
        }
    }
    @Test public void stalePlaybackCallbackCannotOpenOldSource() {
        repository.deferPlayback=true;
        try (ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            scenario.onActivity(activity -> {
                repository.scope="fixture:source2";
                repository.pendingPlayback.onResult(new Playback(repository.movie,"asset:///fixture.mp4","video/mp4",repository.expiry,0,null));
                assertEquals(0,engines.size());
            });
        }
    }
    @Test public void stalledPlaybackRecoversSilentlyAndReleasesPreviousDecoder() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            Thread.sleep(13300);
            scenario.onActivity(activity -> {
                assertEquals(2,engines.size());assertTrue(engines.get(0).released);
                assertEquals(View.GONE,activity.findViewById(android.R.id.content).findViewWithTag("tv_player_status").getVisibility());
            });
        }
    }
    static final class FakeEngine implements PlayerEngine {
        final View view; final Listener listener; boolean playing, released; long position; int selectedAudio=-1,selectedSubtitle=-1;
        FakeEngine(Context context, Listener listener) { this.view=new View(context); this.listener=listener; }
        public View view() {return view;}
        public void prepare(Playback playback,long start,boolean play) {position=start;playing=play;listener.onStateChanged(READY);}
        public void play() {playing=true;listener.onStateChanged(READY);}
        public void pause() {playing=false;listener.onStateChanged(READY);}
        public void seek(long positionMs) {position=positionMs;}
        public long position() {return position;}
        public long duration() {return 300000;}
        public boolean playing() {return playing;}
        public boolean wantsToPlay() {return playing;}
        public int state() {return READY;}
        public List<Track> tracks(boolean subtitles) {return Arrays.asList(new Track("a", "Türkçe",false),new Track("b", "English",false));}
        public void selectTrack(boolean subtitles,String id) {if(subtitles)selectedSubtitle=1;else selectedAudio=1;}
        public void release() {released=true;playing=false;}
    }
    static final class FakeRepository implements TvRepository {
        String scope="fixture:source1"; long expiry=System.currentTimeMillis()+60000,savedPosition,ttl=-1; Item lastPlayback;
        int watched; boolean deferAccess,deferPlayback; Failure.Code accessFailure; Callback<Account> pendingAccess; Callback<Playback> pendingPlayback;
        final Item movie=item(Kind.MOVIE,"1"),live1=item(Kind.LIVE,"2"),live2=item(Kind.LIVE,"3"),episode=item(Kind.EPISODE,"4"),next=item(Kind.EPISODE,"5");
        static Item item(Kind kind,String id) {return new Item(kind,id,"Fixture "+id,"","","","mp4","fixture:source1","series1",1,Integer.parseInt(id),"");}
        public boolean hasSession() {return true;} public String currentScope() {return scope;}
        public void playback(Item item,Callback<Playback> callback) {lastPlayback=item;if(deferPlayback){pendingPlayback=callback;return;}if(ttl>=0)expiry=System.currentTimeMillis()+ttl;callback.onResult(new Playback(item,"asset:///fixture.mp4","video/mp4",expiry,item.kind==Kind.LIVE?0:12000,item.key().equals(episode.key())?next:null));}
        public void refreshAccess(Callback<Account> callback) {if(deferAccess){pendingAccess=callback;return;}if(accessFailure!=null)callback.onError(new Failure(accessFailure,"fixture"));else callback.onResult(new Account("fixture","0000","Fixture",expiry,true,false,""));}
        public void catalog(Kind kind,boolean force,Callback<Catalog> callback) {callback.onResult(new Catalog(kind,Arrays.asList(live1,live2),Collections.emptyList()));}
        public void savePosition(Item item,long position,long duration) {savedPosition=position;}
        public long resumePosition(Item item) {return savedPosition;} public void markWatched(Item item) {watched++;}
        public void login(String code,Callback<Account> callback) {throw new AssertionError("no login network");}
        public void account(boolean force,Callback<Account> callback) {refreshAccess(callback);}
        public void series(Item item,Callback<SeriesDetail> callback) {throw new AssertionError();}
        public void favorites(Callback<List<Item>> callback) {callback.onResult(Collections.emptyList());}
        public boolean isFavorite(Item item) {return false;} public void toggleFavorite(Item item,Callback<Boolean> callback) {callback.onResult(false);}
        public void epg(Item item,Callback<List<Programme>> callback) {callback.onResult(Collections.emptyList());}
        public void logout() {}
    }
}
