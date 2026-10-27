package vip.flixify.tv;

import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.widget.FrameLayout;
import android.widget.SeekBar;
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
            repository.beforePlayback=()->{for(FakeEngine value:engines)if(!value.released)repository.allReleasedAtSwitch=false;};
            TvApplication.setRepositoryForTests(repository);
            PlayerActivity.setEngineFactoryForTests((context, listener) -> {
                FakeEngine result = new FakeEngine(context, listener); result.state=repository.initialState; result.startPaused=!repository.initialPlay; engines.add(result); return result;
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
            key(KeyEvent.KEYCODE_DPAD_DOWN);
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
    private void ended(ActivityScenario<PlayerActivity> scenario) {
        scenario.onActivity(activity -> { latest().state=PlayerEngine.ENDED; latest().position=latest().duration; latest().listener.onStateChanged(PlayerEngine.ENDED); });
    }
    private void assertCountdown(ActivityScenario<PlayerActivity> scenario) {
        scenario.onActivity(activity -> {
            View cancel=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next");
            assertNotNull("Actual ENDED must expose cancellable auto-next",cancel);
            assertTrue("Countdown action is visible through its parent surface",cancel.isShown());
        });
    }
    @Test public void endedStartsFiveSecondCountdownAndDuplicateCallbacksSwitchOnlyOnce() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> latest().position=299000);
            Thread.sleep(700);
            assertEquals("Near-end progress must not skip credits",1,repository.playbackCalls);
            ended(scenario);assertCountdown(scenario);
            scenario.onActivity(activity -> latest().listener.onStateChanged(PlayerEngine.ENDED));
            Thread.sleep(4200);
            assertEquals("Full five-second choice window",1,repository.playbackCalls);
            Thread.sleep(1200);
            scenario.onActivity(activity -> {
                assertEquals(repository.next.id,repository.lastPlayback.id);
                assertEquals(2,repository.playbackCalls);
                assertTrue(engines.get(0).released);
                assertTrue("Old stream released before repository admission",repository.allReleasedAtSwitch);
            });
            Thread.sleep(1000);assertEquals(2,repository.playbackCalls);
        }
    }
    @Test public void cancelRemainsLatchedAcrossRecoveryAndRecreation() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            scenario.onActivity(activity -> activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").performClick());
            scenario.onActivity(activity -> latest().listener.onError());
            scenario.recreate();ended(scenario);
            Thread.sleep(5400);
            assertEquals(repository.episode.id,repository.lastPlayback.id);
            scenario.onActivity(activity -> {
                View cancel=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next");
                assertTrue("Cancelled episode must not re-arm",cancel==null || !cancel.isShown());
            });
        }
    }
    @Test public void recreationPersistsCurrentSelectedEpisodeInsteadOfLaunchIntent() {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            key(KeyEvent.KEYCODE_MEDIA_NEXT);
            assertEquals(repository.next.id,repository.lastPlayback.id);
            scenario.recreate();
            assertEquals("Recreation retains selected continuation",repository.next.id,repository.lastPlayback.id);
        }
    }
    @Test public void backgroundCancelsPendingCountdownWithoutOpeningAnotherStream() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            Thread.sleep(5400);
            assertEquals(1,repository.playbackCalls);assertTrue(latest().released);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            ended(scenario);Thread.sleep(5400);
            assertEquals(repository.episode.id,repository.lastPlayback.id);
        }
    }
    @Test public void pausedButVisibleActivityCancelsAndLatchesContinuation() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED);
            Thread.sleep(5400);
            assertEquals("Losing resumed state must prevent successor admission before onStop",1,repository.playbackCalls);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            ended(scenario);
            scenario.onActivity(activity -> assertFalse("Pause cancellation remains latched after resume",
                    activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").isShown()));
            Thread.sleep(5400);assertEquals(1,repository.playbackCalls);
        }
    }
    @Test public void remoteCanReturnFromTransportToCountdownAndCancel() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            scenario.onActivity(activity -> assertEquals("tv_player_watch_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_DOWN);
            scenario.onActivity(activity -> {
                Object tag=activity.getCurrentFocus().getTag();
                assertTrue("Down reaches a transport control",Arrays.asList("tv_player_play","tv_player_backward","tv_player_forward").contains(tag));
            });
            key(KeyEvent.KEYCODE_DPAD_UP);
            scenario.onActivity(activity -> assertEquals("Up returns to visible countdown choice","tv_player_watch_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_cancel_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> assertFalse(activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").isShown()));
            Thread.sleep(5400);assertEquals(1,repository.playbackCalls);
        }
    }
    @Test public void explicitRewindCancelsPendingContinuationForReplay() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);key(KeyEvent.KEYCODE_MEDIA_REWIND);
            scenario.onActivity(activity -> {
                assertTrue("Rewind still moves actual playback",latest().position<latest().duration);
                assertFalse("Viewer replay cancels auto-next",activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").isShown());
            });
            ended(scenario);Thread.sleep(5400);assertEquals(1,repository.playbackCalls);
        }
    }
    @Test public void remoteTimelineSeekCancelsPendingContinuationForReplay() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            scenario.onActivity(activity -> {SeekBar bar=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_timeline");bar.setProgress(1000);bar.requestFocus();});
            key(KeyEvent.KEYCODE_DPAD_LEFT);
            scenario.onActivity(activity -> {
                assertTrue("Timeline still moves actual playback",latest().position<latest().duration);
                assertFalse("Timeline replay cancels auto-next",activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").isShown());
            });
            ended(scenario);Thread.sleep(5400);assertEquals(1,repository.playbackCalls);
        }
    }
    @Test public void expiryDuringCountdownCannotAdmitSuccessor() throws Exception {
        repository.ttl=1600;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);Thread.sleep(5400);
            scenario.onActivity(activity -> {assertEquals(1,repository.playbackCalls);assertTrue(latest().released);});
        }
    }
    @Test public void finalMovieLiveUnknownDurationAndWrongSeriesNeverAutoAdvance() throws Exception {
        for(Item value:Arrays.asList(repository.next,repository.movie,repository.live1)) {
            try(ActivityScenario<PlayerActivity> scenario=launch(value)) {
                ended(scenario);
                scenario.onActivity(activity -> { View cancel=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next"); assertTrue(cancel==null || !cancel.isShown()); });
            }
        }
        repository.successor=new Item(Kind.EPISODE,"6","Wrong series","","","","mp4",repository.scope,"other-series",1,6,"");
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);key(KeyEvent.KEYCODE_MEDIA_NEXT);
            assertEquals("Cross-series continuation is not valid",repository.episode.id,repository.lastPlayback.id);
        }
        repository.successor=repository.next;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> latest().duration=-1);ended(scenario);
            scenario.onActivity(activity -> {
                View cancel=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next");
                assertTrue(cancel==null || !cancel.isShown());
            });
        }
    }
    @Test public void initialBufferingIsNotRecycledAtEstablishedStallDeadline() throws Exception {
        repository.initialState=PlayerEngine.BUFFERING;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            Thread.sleep(13300);
            scenario.onActivity(activity -> {assertEquals("Valid startup gets its own bounded preparation window",1,engines.size());assertFalse(latest().released);});
        }
    }
    @Test public void initialPausedPlayerFitsAllControlsWithoutResizeOrFocusSteering() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(activity -> {
                assertFalse("Fixture starts paused without a corrective input/layout",latest().playing());
                FrameLayout content=activity.findViewById(android.R.id.content);
                View actual=content.getChildAt(0);
                Rect bounds=new Rect();assertTrue(actual.getGlobalVisibleRect(bounds));
                for(String tag:Arrays.asList("play","backward","forward","audio","subtitles","next","exit")) {
                    View control=content.findViewWithTag("tv_player_"+tag);Rect visible=new Rect();
                    assertTrue("Initial "+tag+" is visible",control.isShown() && control.getGlobalVisibleRect(visible));
                    assertTrue("Initial "+tag+" fully fits first player layout; player="+bounds+", visible="+visible+", measured="+control.getWidth()+"x"+control.getHeight(),
                            bounds.contains(visible) && visible.width()>=control.getWidth()-2 && visible.height()>=control.getHeight()-2);
                }
            });
        }
    }
    @Test public void shortNarrowPlayerHasRealTimelineAndReachableControls() {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            key(KeyEvent.KEYCODE_MEDIA_PAUSE);
            scenario.onActivity(activity -> {
                FrameLayout content=activity.findViewById(android.R.id.content);
                View actual=content.getChildAt(0);
                float density=activity.getResources().getDisplayMetrics().density;
                actual.setLayoutParams(new FrameLayout.LayoutParams((int)(560*density),(int)(320*density)));
                actual.requestLayout();
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(activity -> {
                FrameLayout content=activity.findViewById(android.R.id.content);View actual=content.getChildAt(0);
                Rect bounds=new Rect();assertTrue(actual.getGlobalVisibleRect(bounds));
                View timeline=content.findViewWithTag("tv_player_timeline");
                assertTrue("VOD needs an actual remote seek control",timeline instanceof SeekBar);
                for(String tag:Arrays.asList("play","backward","forward","audio","subtitles","next","exit")) {
                    View control=content.findViewWithTag("tv_player_"+tag);Rect visible=new Rect();
                    assertTrue(tag+" fully fits measured player bounds",control.getGlobalVisibleRect(visible) && bounds.contains(visible) && visible.width()>=control.getWidth()-2 && visible.height()>=control.getHeight()-2);
                    assertTrue(tag+" remains focusable",control.requestFocus());
                }
            });
            scenario.onActivity(activity -> activity.findViewById(android.R.id.content).findViewWithTag("tv_player_timeline").requestFocus());
            long before=latest().position;key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertTrue("Remote timeline moves actual playback position",latest().position>before));
        }
    }
    static final class FakeEngine implements PlayerEngine {
        final View view; final Listener listener; boolean playing, released,startPaused; long position,duration=300000; int state=READY; int selectedAudio=-1,selectedSubtitle=-1;
        FakeEngine(Context context, Listener listener) { this.view=new View(context); this.listener=listener; }
        public View view() {return view;}
        public void prepare(Playback playback,long start,boolean play) {position=start;playing=play && !startPaused;listener.onStateChanged(state);if(state==READY)listener.onFirstFrame();}
        public void play() {playing=true;listener.onStateChanged(READY);}
        public void pause() {playing=false;listener.onStateChanged(READY);}
        public void seek(long positionMs) {position=positionMs;}
        public long position() {return position;}
        public long duration() {return duration;}
        public boolean playing() {return playing && state==READY;}
        public boolean wantsToPlay() {return playing;}
        public int state() {return state;}
        public List<Track> tracks(boolean subtitles) {return Arrays.asList(new Track("a", "Türkçe",false),new Track("b", "English",false));}
        public void selectTrack(boolean subtitles,String id) {if(subtitles)selectedSubtitle=1;else selectedAudio=1;}
        public void release() {released=true;playing=false;}
    }
    static final class FakeRepository implements TvRepository {
        String scope="fixture:source1"; long expiry=System.currentTimeMillis()+60000,savedPosition,ttl=-1; Item lastPlayback;
        Runnable beforePlayback; int watched,playbackCalls,initialState=PlayerEngine.READY; boolean allReleasedAtSwitch=true,initialPlay=true; Item successor; boolean deferAccess,deferPlayback; Failure.Code accessFailure; Callback<Account> pendingAccess; Callback<Playback> pendingPlayback;
        final Item movie=item(Kind.MOVIE,"1"),live1=item(Kind.LIVE,"2"),live2=item(Kind.LIVE,"3"),episode=item(Kind.EPISODE,"4"),next=item(Kind.EPISODE,"5");
        static Item item(Kind kind,String id) {return new Item(kind,id,"Fixture "+id,"","","","mp4","fixture:source1","series1",1,Integer.parseInt(id),"");}
        public boolean hasSession() {return true;} public String currentScope() {return scope;}
        public void playback(Item item,Callback<Playback> callback) {if(beforePlayback!=null)beforePlayback.run();playbackCalls++;lastPlayback=item;if(deferPlayback){pendingPlayback=callback;return;}if(ttl>=0)expiry=System.currentTimeMillis()+ttl;callback.onResult(new Playback(item,"asset:///fixture.mp4","video/mp4",expiry,item.kind==Kind.LIVE?0:12000,item.key().equals(episode.key())?(successor==null?next:successor):null));}
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
