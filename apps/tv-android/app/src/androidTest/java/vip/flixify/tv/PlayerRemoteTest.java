package vip.flixify.tv;

import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.widget.FrameLayout;
import android.widget.SeekBar;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.HashSet;
import java.util.Set;
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
                FakeEngine result = new FakeEngine(context, listener); result.state=repository.initialState; result.startPaused=!repository.initialPlay; result.duration=repository.initialDuration; engines.add(result); return result;
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
        AccessibilityNodeInfo last=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
        fail("Track dialog did not expose "+uniqueText+"; "+nodeText(last));
    }
    private String nodeText(AccessibilityNodeInfo node) {
        if(node==null)return "none";
        Rect bounds=new Rect();node.getBoundsInScreen(bounds);
        StringBuilder result=new StringBuilder("[").append(node.getText()).append(" / ").append(node.getContentDescription()).append(" ").append(bounds);
        if(node.getCollectionInfo()!=null)result.append(" rows=").append(node.getCollectionInfo().getRowCount());
        for(int i=0;i<node.getChildCount();i++)result.append(nodeText(node.getChild(i)));
        return result.append(']').toString();
    }
    private boolean focused(PlayerActivity activity,String tag) {return activity.hasWindowFocus() && activity.getCurrentFocus()!=null && tag.equals(activity.getCurrentFocus().getTag());}
    private FakeEngine latest() { return engines.get(engines.size()-1); }
    private void awaitDestroyed(ActivityScenario<PlayerActivity> scenario) {
        long end=SystemClock.elapsedRealtime()+3000;
        while(scenario.getState()!=androidx.lifecycle.Lifecycle.State.DESTROYED && SystemClock.elapsedRealtime()<end)SystemClock.sleep(20);
        assertEquals("Remote Back completes the actual Activity lifecycle",androidx.lifecycle.Lifecycle.State.DESTROYED,scenario.getState());
    }
    @Test public void vodHidesBottomTransportWithoutRemovingTimelineTimesOrTools() {
        repository.initialPlay=false;
        for(Item selected:Arrays.asList(repository.movie,repository.episode)) {
            try(ActivityScenario<PlayerActivity> scenario=launch(selected)) {
                scenario.onActivity(activity -> {
                    View content=activity.findViewById(android.R.id.content);
                    for(String tag:Arrays.asList("play","backward","forward","exit")) {
                        View icon=content.findViewWithTag("tv_player_"+tag);
                        assertFalse("VOD removes on-screen "+tag,icon.isShown());
                        assertFalse("Removed "+tag+" must not take remote focus",icon.requestFocus());
                    }
                    View play=content.findViewWithTag("tv_player_play");View bottom=(View)play.getParent().getParent();
                    assertEquals("No empty bottom transport/caption row",View.GONE,bottom.getVisibility());
                    ViewGroup chrome=content.findViewWithTag("tv_player_controls");
                    assertTrue("Removed row also releases its vertical space",chrome.getHeight()<=TvUi.dp(activity,144));
                    for(String tag:Arrays.asList("timeline","audio","subtitles","favorite"))assertTrue(tag+" remains visible",content.findViewWithTag("tv_player_"+tag).isShown());
                    ViewGroup times=(ViewGroup)chrome.getChildAt(2);assertEquals(2,times.getChildCount());
                    assertTrue("Elapsed and remaining time stay visible",times.getChildAt(0).isShown() && times.getChildAt(1).isShown());
                    if(selected.kind==Kind.EPISODE)for(String tag:Arrays.asList("next","episodes"))assertTrue(tag+" remains visible",content.findViewWithTag("tv_player_"+tag).isShown());
                });
            }
        }
    }
    @Test public void vodRemoteCenterSeekAndBackRemainAvailableWithoutTransportIcons() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            scenario.onActivity(activity -> assertEquals("tv_player_timeline",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);scenario.onActivity(activity -> assertTrue(latest().playing()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);scenario.onActivity(activity -> assertFalse(latest().playing()));
            key(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD);scenario.onActivity(activity -> assertEquals(22000,latest().position));
            key(KeyEvent.KEYCODE_MEDIA_REWIND);scenario.onActivity(activity -> assertEquals(12000,latest().position));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);scenario.onActivity(activity -> assertTrue("Visible timeline still seeks",latest().position>12000));
            key(KeyEvent.KEYCODE_BACK);
            awaitDestroyed(scenario);assertTrue(latest().released);
        }
    }
    @Test public void vodFatalStateKeepsVisibleFocusAndRemoteBackExit() {
        repository.accessFailure=Failure.Code.INELIGIBLE;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            scenario.onActivity(activity -> {
                assertTrue(latest().released);View focus=activity.getCurrentFocus();
                assertNotNull("Fatal VOD still owns remote input",focus);assertTrue(focus.isShown() && focus.isEnabled());
                assertFalse("Fatal focus cannot target removed transport",Arrays.asList("tv_player_play","tv_player_backward","tv_player_forward","tv_player_exit").contains(focus.getTag()));
            });
            key(KeyEvent.KEYCODE_BACK);awaitDestroyed(scenario);
        }
    }
    @Test public void unknownDurationVodKeepsRemoteToggleAndUtilityNavigation() {
        repository.initialPlay=false;
        for(long duration:new long[]{0,-1}) {
            repository.initialDuration=duration;
            try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
                scenario.onActivity(activity -> {
                    View root=((FrameLayout)activity.findViewById(android.R.id.content)).getChildAt(0);
                    assertSame("Unknown duration uses the player input surface",root,activity.getCurrentFocus());
                });
                key(KeyEvent.KEYCODE_DPAD_CENTER);scenario.onActivity(activity -> assertTrue(latest().playing()));
                key(KeyEvent.KEYCODE_DPAD_UP);scenario.onActivity(activity -> assertEquals("tv_player_subtitles",activity.getCurrentFocus().getTag()));
                key(KeyEvent.KEYCODE_DPAD_DOWN);
                scenario.onActivity(activity -> assertSame(((FrameLayout)activity.findViewById(android.R.id.content)).getChildAt(0),activity.getCurrentFocus()));
                key(KeyEvent.KEYCODE_DPAD_CENTER);scenario.onActivity(activity -> assertFalse(latest().playing()));
                key(KeyEvent.KEYCODE_BACK);awaitDestroyed(scenario);
            }
        }
    }
    @Test public void liveKeepsAllBottomTransportIconsAndTheirRemoteNavigation() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            scenario.onActivity(activity -> {
                View content=activity.findViewById(android.R.id.content);
                for(String tag:Arrays.asList("play","backward","forward","exit"))assertTrue("Live keeps "+tag,content.findViewWithTag("tv_player_"+tag).isShown());
                assertEquals("tv_player_play",activity.getCurrentFocus().getTag());
            });
            for(String tag:Arrays.asList("backward","forward","exit")) {
                key(KeyEvent.KEYCODE_DPAD_RIGHT);
                scenario.onActivity(activity -> assertEquals("tv_player_"+tag,activity.getCurrentFocus().getTag()));
            }
        }
    }
    @Test public void favoriteCanBeToggledFromLivePlayerWithoutReopeningStream() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            key(KeyEvent.KEYCODE_DPAD_UP);
            key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> {
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                assertNotNull("Favorite belongs inside the player",action);
                assertSame(action,activity.getCurrentFocus());
                assertEquals("Favorilere ekle",action.getContentDescription());
                assertFalse(action.isSelected());
            });
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> {
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                assertEquals("Favorilerden çıkar",action.getContentDescription());assertTrue(action.isSelected());
                assertTrue(repository.isFavorite(repository.live1));
                assertEquals(1,repository.playbackCalls);assertEquals(1,engines.size());
            });
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> assertFalse(repository.isFavorite(repository.live1)));
            key(KeyEvent.KEYCODE_CHANNEL_UP);
            scenario.onActivity(activity -> {
                assertEquals(repository.live2.id,repository.lastPlayback.id);
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                assertEquals("Favorilere ekle",action.getContentDescription());assertFalse(action.isSelected());
            });
        }
    }
    @Test public void episodeFavoritesItsSeriesAndMovieFavoritesItself() {
        repository.initialPlay=false;
        for(Item selected:Arrays.asList(repository.movie,repository.episode)) {
            try(ActivityScenario<PlayerActivity> scenario=launch(selected)) {
                scenario.onActivity(activity -> {
                    View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                    assertNotNull("Every playable kind exposes favorite",action);
                    assertTrue(action.requestFocus());action.performClick();
                    assertNotNull(repository.lastFavorite);
                    assertEquals(selected.kind==Kind.EPISODE?Kind.SERIES:Kind.MOVIE,repository.lastFavorite.kind);
                    assertEquals(selected.kind==Kind.EPISODE?selected.seriesId:selected.id,repository.lastFavorite.id);
                    assertEquals(selected.scope,repository.lastFavorite.scope);
                    if(selected.kind==Kind.EPISODE)assertEquals("",repository.lastFavorite.seriesId);
                    assertTrue(action.isSelected());
                });
            }
        }
    }
    @Test public void favoriteIgnoresLateResultAfterChangingChannelOrSource() {
        repository.initialPlay=false;repository.deferFavorite=true;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            scenario.onActivity(activity -> {
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                assertNotNull(action);action.performClick();action.performClick();
                assertEquals("Repeated OK must not enqueue duplicate mutation",1,repository.favoriteCalls);
            });
            key(KeyEvent.KEYCODE_CHANNEL_UP);
            scenario.onActivity(activity -> {
                repository.pendingFavorite.onResult(true);
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                assertEquals("Favorilere ekle",action.getContentDescription());assertFalse(action.isSelected());
                action.performClick();assertEquals(2,repository.favoriteCalls);
                repository.scope="fixture:source2";repository.pendingFavorite.onResult(true);
                assertFalse("Other source cannot paint favorite state",action.isSelected());
            });
        }
    }
    @Test public void favoriteFailureKeepsPreviousStateAndCanRetry() {
        repository.initialPlay=false;repository.deferFavorite=true;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            scenario.onActivity(activity -> {
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_favorite");
                assertNotNull(action);action.requestFocus();action.performClick();
                repository.pendingFavorite.onError(new Failure(Failure.Code.NETWORK,"fixture"));
                assertFalse(action.isSelected());assertEquals("Favorilere ekle",action.getContentDescription());
                action.performClick();assertEquals(2,repository.favoriteCalls);
                assertEquals(1,engines.size());assertFalse(latest().released);
            });
        }
    }
    @Test public void selectingSeriesEntersPlayerAndResolvesEpisodeBeforeCreatingEngine() {
        repository.initialPlay=false;repository.deferStart=true;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.series)) {
            scenario.onActivity(activity -> {
                assertNotNull("Series resolves inside player",repository.pendingStart);
                assertEquals(0,engines.size());assertEquals(0,repository.playbackCalls);
                repository.pendingStart.onResult(repository.episode);
                assertEquals(1,engines.size());assertEquals(repository.episode.id,repository.lastPlayback.id);
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_episodes");
                assertNotNull("Episode selection remains reachable in player",action);
                assertEquals(View.VISIBLE,action.getVisibility());assertTrue(action.isEnabled());
            });
        }
    }
    @Test public void seriesResolverRejectsWrongParentAndLateSourceResult() {
        repository.deferStart=true;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.series)) {
            scenario.onActivity(activity -> {
                assertNotNull(repository.pendingStart);
                repository.pendingStart.onResult(new Item(Kind.EPISODE,"9","Wrong parent","","","","mp4",repository.scope,"other",1,1,""));
                assertEquals(0,engines.size());assertEquals(0,repository.playbackCalls);
            });
        }
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.series)) {
            scenario.onActivity(activity -> {
                assertNotNull(repository.pendingStart);repository.scope="fixture:source2";
                repository.pendingStart.onResult(repository.episode);
                assertEquals(0,engines.size());assertEquals(0,repository.playbackCalls);
            });
        }
    }
    @Test public void episodePanelChangesEpisodeFromRemoteWithoutDetailScreen() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> {
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_episodes");
                assertNotNull(action);assertTrue(action.requestFocus());action.performClick();
            });
            awaitDialog("Fixture 5");
            key(KeyEvent.KEYCODE_DPAD_DOWN);
            awaitDialog("Fixture 4, şu anki bölüm");
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> {
                assertEquals(repository.next.id,repository.lastPlayback.id);
                assertTrue("Prior connection closes before selection",repository.allReleasedAtSwitch);
                assertEquals(2,engines.size());assertTrue(engines.get(0).released);
                View action=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_episodes");action.requestFocus();action.performClick();
            });
            awaitDialog("Fixture 4");key(KeyEvent.KEYCODE_BACK);
            await(scenario,"Episode Back restores icon",activity -> focused(activity,"tv_player_episodes"));
        }
    }
    @Test public void episodePanelFitsMeasuredPlayerAndRemainsReachableAfterResize() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> {
                View actual=((FrameLayout)activity.findViewById(android.R.id.content)).getChildAt(0);
                float density=activity.getResources().getDisplayMetrics().density;
                actual.setLayoutParams(new FrameLayout.LayoutParams((int)(560*density),(int)(320*density)));actual.requestLayout();
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Rect player=new Rect();
            scenario.onActivity(activity -> {
                View actual=((FrameLayout)activity.findViewById(android.R.id.content)).getChildAt(0);assertTrue(actual.getGlobalVisibleRect(player));
                View action=actual.findViewWithTag("tv_player_episodes");action.requestFocus();action.performClick();
            });
            awaitDialog("Bölümler");InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            AccessibilityNodeInfo panel=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();Rect bounds=new Rect();panel.getBoundsInScreen(bounds);
            assertTrue("Episode panel must fit actual player "+player+", panel="+bounds,player.contains(bounds));
            scenario.onActivity(activity -> {
                View actual=((FrameLayout)activity.findViewById(android.R.id.content)).getChildAt(0);
                float density=activity.getResources().getDisplayMetrics().density;
                actual.setLayoutParams(new FrameLayout.LayoutParams((int)(640*density),(int)(360*density)));actual.requestLayout();
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(activity -> ((FrameLayout)activity.findViewById(android.R.id.content)).getChildAt(0).getGlobalVisibleRect(player));
            panel=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();panel.getBoundsInScreen(bounds);
            assertTrue("Open episode panel follows resized player "+player+", panel="+bounds,player.contains(bounds));
            key(KeyEvent.KEYCODE_DPAD_LEFT);key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> assertEquals("6",repository.lastPlayback.id));
        }
    }
    @Test public void openingEpisodePickerCancelsPendingAutomaticContinuation() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);
            scenario.onActivity(activity -> {
                View content=activity.findViewById(android.R.id.content);
                assertEquals(View.VISIBLE,content.findViewWithTag("tv_player_countdown").getVisibility());
                content.findViewWithTag("tv_player_episodes").performClick();
                assertEquals("Manual selection dismisses automatic countdown",View.GONE,content.findViewWithTag("tv_player_countdown").getVisibility());
            });
            Thread.sleep(5300);
            scenario.onActivity(activity -> {
                assertEquals("Automatic next must not replace an open picker",1,engines.size());
                assertEquals(repository.episode.id,repository.lastPlayback.id);
            });
            awaitDialog("Bölümler");key(KeyEvent.KEYCODE_BACK);
            await(scenario,"Manual picker Back restores opener",activity -> focused(activity,"tv_player_episodes"));
        }
    }
    @Test public void actualEndWhileEpisodePickerOpenDoesNotReplaceManualChoice() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> activity.findViewById(android.R.id.content).findViewWithTag("tv_player_episodes").performClick());
            awaitDialog("Bölümler");ended(scenario);
            scenario.onActivity(activity -> assertEquals("Manual picker owns choice when playback ends",View.GONE,activity.findViewById(android.R.id.content).findViewWithTag("tv_player_countdown").getVisibility()));
            Thread.sleep(5300);
            scenario.onActivity(activity -> {assertEquals(1,engines.size());assertEquals(repository.episode.id,repository.lastPlayback.id);});
            awaitDialog("Bölümler");key(KeyEvent.KEYCODE_BACK);
        }
    }
    @Test public void browsingAndClosingEpisodePickerMidEpisodePreservesAutomaticContinuation() {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> activity.findViewById(android.R.id.content).findViewWithTag("tv_player_episodes").performClick());
            awaitDialog("Bölümler");key(KeyEvent.KEYCODE_BACK);ended(scenario);assertCountdown(scenario);
        }
    }
    @Test public void liveGuideLoadsOnlyOnDemandAndReturnsFocusWithoutReopeningStream() {
        repository.initialPlay=false;
        long now=System.currentTimeMillis();repository.programmes=Arrays.asList(new Programme("Fixture programme",now-1000,now+60000));
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            scenario.onActivity(activity -> {
                assertEquals("Guide must not delay first playback",0,repository.epgCalls);
                View guide=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_guide");
                assertNotNull("Existing guide belongs in player",guide);guide.requestFocus();guide.performClick();
            });
            awaitDialog("Fixture programme");
            scenario.onActivity(activity -> {assertEquals(1,repository.epgCalls);assertEquals(1,repository.playbackCalls);assertEquals(1,engines.size());assertFalse(latest().released);});
            key(KeyEvent.KEYCODE_BACK);await(scenario,"Guide Back restores opener",activity -> focused(activity,"tv_player_guide"));
        }
    }
    @Test public void liveGuideHasEmptyAndFailureStatesAndIgnoresLateSourceData() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            scenario.onActivity(activity -> {
                View guide=activity.findViewById(android.R.id.content).findViewWithTag("tv_player_guide");assertNotNull(guide);guide.performClick();
            });
            awaitDialog("Yayın bilgisi bulunamadı.");key(KeyEvent.KEYCODE_BACK);
            scenario.onActivity(activity -> {repository.epgFailure=Failure.Code.NETWORK;activity.findViewById(android.R.id.content).findViewWithTag("tv_player_guide").performClick();});
            awaitDialog("Yayın akışı yüklenemedi.");key(KeyEvent.KEYCODE_BACK);
            scenario.onActivity(activity -> {repository.epgFailure=null;repository.deferEpg=true;activity.findViewById(android.R.id.content).findViewWithTag("tv_player_guide").performClick();repository.scope="fixture:source2";repository.pendingEpg.onResult(Arrays.asList(new Programme("Late source programme",1,2)));});
            AccessibilityNodeInfo window=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
            assertFalse(nodeText(window).contains("Late source programme"));
            assertEquals(1,engines.size());
        }
    }
    @Test public void playerUsesCompactIconsWithStableFocusBounds() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> {
                View content=activity.findViewById(android.R.id.content);
                float density=activity.getResources().getDisplayMetrics().density;
                View chrome=content.findViewWithTag("tv_player_controls");
                assertTrue("Content-first chrome must stay shallow",chrome.getHeight()<=density*192);
                for(String tag:Arrays.asList("audio","subtitles","next","episodes","favorite")) {
                    View icon=content.findViewWithTag("tv_player_"+tag);
                    assertTrue("Use compact native icon target for "+tag,icon instanceof android.widget.ImageButton);
                    assertTrue("No weighted screen-wide tile for "+tag,icon.getWidth()<=density*52);
                    assertNotNull("Accessible action for "+tag,icon.getContentDescription());
                    Rect before=new Rect(icon.getLeft(),icon.getTop(),icon.getRight(),icon.getBottom());
                    assertTrue(icon.requestFocus());
                    assertEquals(before,new Rect(icon.getLeft(),icon.getTop(),icon.getRight(),icon.getBottom()));
                }
            });
        }
    }
    @Test public void iconGroupsAreFullyRemoteReachableAndLiveSkipsHiddenTimeline() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            scenario.onActivity(activity -> assertEquals("tv_player_timeline",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_UP);
            scenario.onActivity(activity -> assertEquals("tv_player_subtitles",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_audio",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_episodes",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_favorite",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);
            scenario.onActivity(activity -> assertEquals("tv_player_timeline",activity.getCurrentFocus().getTag()));
        }
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            key(KeyEvent.KEYCODE_DPAD_UP);
            scenario.onActivity(activity -> {
                assertEquals("tv_player_subtitles",activity.getCurrentFocus().getTag());
                assertEquals(View.GONE,activity.findViewById(android.R.id.content).findViewWithTag("tv_player_timeline").getVisibility());
            });
            key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_favorite",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_guide",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_DOWN);
            scenario.onActivity(activity -> assertEquals("tv_player_play",activity.getCurrentFocus().getTag()));
        }
    }
    @Test public void trackPanelRetainsSelectedIndicatorAndBackRestoresIconFocus() {
        repository.initialPlay=false;
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            key(KeyEvent.KEYCODE_DPAD_UP);key(KeyEvent.KEYCODE_DPAD_RIGHT);
            key(KeyEvent.KEYCODE_DPAD_CENTER);awaitDialog("Otomatik, seçili");
            scenario.onActivity(activity -> assertFalse("Utility OK opens its panel without toggling playback",latest().playing()));
            key(KeyEvent.KEYCODE_DPAD_DOWN);awaitDialog("Otomatik, seçili");
            key(KeyEvent.KEYCODE_BACK);
            await(scenario,"Panel Back must restore originating icon",activity -> focused(activity,"tv_player_audio"));
        }
    }
    @Test public void centerOnHiddenPlayerPausesImmediatelyAndRevealsControls() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.movie)) {
            Thread.sleep(2300);
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> {
                assertFalse("Remote center must pause in one press",latest().playing());
                assertEquals(View.VISIBLE,activity.findViewById(android.R.id.content).findViewWithTag("tv_player_controls").getVisibility());
            });
        }
    }
    @Test public void mediaKeysSeekAndStopReleaseVod() {
        try (ActivityScenario<PlayerActivity> scenario = launch(repository.movie)) {
            scenario.onActivity(activity -> assertTrue(activity.findViewById(android.R.id.content).findViewWithTag("tv_player_timeline").hasFocus()));
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
            key(KeyEvent.KEYCODE_DPAD_UP); // Utility icons above the focused timeline.
            key(KeyEvent.KEYCODE_DPAD_RIGHT); // Subtitles then audio.
            scenario.onActivity(activity -> assertEquals("tv_player_audio", activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            awaitDialog("Otomatik");
            key(KeyEvent.KEYCODE_DPAD_DOWN); key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(scenario,"Audio choice must apply",activity -> latest().selectedAudio>=0);
            await(scenario,"Audio dialog must restore remote focus",activity -> focused(activity,"tv_player_audio"));
            key(KeyEvent.KEYCODE_DPAD_LEFT);
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
    @Test public void remoteCanReturnFromTimelineToCountdownAndCancel() throws Exception {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            scenario.onActivity(activity -> assertEquals("tv_player_watch_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_DOWN);
            scenario.onActivity(activity -> {
                assertEquals("Down reaches the remaining timeline","tv_player_timeline",activity.getCurrentFocus().getTag());
            });
            key(KeyEvent.KEYCODE_DPAD_UP);
            scenario.onActivity(activity -> assertEquals("Up returns to visible countdown choice","tv_player_watch_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
            scenario.onActivity(activity -> assertEquals("tv_player_cancel_next",activity.getCurrentFocus().getTag()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> {
                assertFalse(activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").isShown());
                assertEquals("Cancellation restores visible VOD focus","tv_player_timeline",activity.getCurrentFocus().getTag());
            });
            Thread.sleep(5400);assertEquals(1,repository.playbackCalls);
        }
    }
    @Test public void endedLiveSourceNeverSeeksThroughReplayControl() {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.live1)) {
            scenario.onActivity(activity -> {latest().state=PlayerEngine.ENDED;latest().listener.onStateChanged(PlayerEngine.ENDED);});
            key(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
            scenario.onActivity(activity -> assertEquals("Live has channel navigation, never a VOD replay seek",0,latest().seekCalls));
        }
    }
    @Test public void playAtActualEndReplaysAndCancelsAutomaticSuccessor() {
        try(ActivityScenario<PlayerActivity> scenario=launch(repository.episode)) {
            ended(scenario);assertCountdown(scenario);
            key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
            scenario.onActivity(activity -> {
                assertEquals(0,latest().position());assertTrue(latest().playing());
                assertFalse(activity.findViewById(android.R.id.content).findViewWithTag("tv_player_cancel_next").isShown());
                assertEquals(1,repository.playbackCalls);
            });
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
                for(String tag:Arrays.asList("audio","subtitles","next","episodes","favorite")) {
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
                for(String tag:Arrays.asList("audio","subtitles","next","episodes","favorite")) {
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
        final View view; final Listener listener; boolean playing, released,startPaused; long position,duration=300000; int state=READY; int seekCalls; int selectedAudio=-1,selectedSubtitle=-1;
        FakeEngine(Context context, Listener listener) { this.view=new View(context); this.listener=listener; }
        public View view() {return view;}
        public void prepare(Playback playback,long start,boolean play) {position=start;playing=play && !startPaused;listener.onStateChanged(state);if(state==READY)listener.onFirstFrame();}
        public void play() {playing=true;state=READY;listener.onStateChanged(READY);}
        public void pause() {playing=false;listener.onStateChanged(READY);}
        public void seek(long positionMs) {seekCalls++;position=positionMs;}
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
        String scope="fixture:source1"; long expiry=System.currentTimeMillis()+60000,savedPosition,ttl=-1,initialDuration=300000; Item lastPlayback;
        Runnable beforePlayback; int watched,playbackCalls,initialState=PlayerEngine.READY; boolean allReleasedAtSwitch=true,initialPlay=true; Item successor; boolean deferAccess,deferPlayback; Failure.Code accessFailure; Callback<Account> pendingAccess; Callback<Playback> pendingPlayback;
        final Set<String> favoriteKeys=new HashSet<>(); Item lastFavorite;int favoriteCalls;boolean deferFavorite;Callback<Boolean> pendingFavorite;
        boolean deferStart;Callback<Item> pendingStart;
        int epgCalls;List<Programme> programmes=Collections.emptyList();Failure.Code epgFailure;boolean deferEpg;Callback<List<Programme>> pendingEpg;
        final Item movie=item(Kind.MOVIE,"1"),live1=item(Kind.LIVE,"2"),live2=item(Kind.LIVE,"3"),episode=item(Kind.EPISODE,"4"),next=item(Kind.EPISODE,"5");
        final Item series=new Item(Kind.SERIES,"series1","Fixture series","","","","","fixture:source1","",0,0,"");
        static Item item(Kind kind,String id) {return new Item(kind,id,"Fixture "+id,"","","","mp4","fixture:source1","series1",1,Integer.parseInt(id),"");}
        public boolean hasSession() {return true;} public String currentScope() {return scope;}
        public void playback(Item item,Callback<Playback> callback) {if(beforePlayback!=null)beforePlayback.run();playbackCalls++;lastPlayback=item;if(deferPlayback){pendingPlayback=callback;return;}if(ttl>=0)expiry=System.currentTimeMillis()+ttl;callback.onResult(new Playback(item,"asset:///fixture.mp4","video/mp4",expiry,item.kind==Kind.LIVE?0:12000,item.key().equals(episode.key())?(successor==null?next:successor):null));}
        public void refreshAccess(Callback<Account> callback) {if(deferAccess){pendingAccess=callback;return;}if(accessFailure!=null)callback.onError(new Failure(accessFailure,"fixture"));else callback.onResult(new Account("fixture","0000","Fixture",expiry,true,false,""));}
        public void catalog(Kind kind,boolean force,Callback<Catalog> callback) {callback.onResult(new Catalog(kind,Arrays.asList(live1,live2),Collections.emptyList()));}
        public void savePosition(Item item,long position,long duration) {savedPosition=position;}
        public long resumePosition(Item item) {return savedPosition;} public void markWatched(Item item) {watched++;}
        public void login(String code,Callback<Account> callback) {throw new AssertionError("no login network");}
        public void account(boolean force,Callback<Account> callback) {refreshAccess(callback);}
        public void series(Item item,Callback<SeriesDetail> callback) {callback.onResult(new SeriesDetail(series,Arrays.asList(new Season(1,Arrays.asList(episode,next)),new Season(2,Arrays.asList(new Item(Kind.EPISODE,"6","Fixture 6","","","","mp4",scope,"series1",2,1,""))))));}
        public void startingEpisode(Item series,Callback<Item> callback) {if(deferStart){pendingStart=callback;return;}callback.onResult(episode);}
        public void favorites(Callback<List<Item>> callback) {callback.onResult(Collections.emptyList());}
        public boolean isFavorite(Item item) {return item!=null && scope.equals(item.scope) && favoriteKeys.contains(item.key());}
        public void toggleFavorite(Item item,Callback<Boolean> callback) {lastFavorite=item;favoriteCalls++;if(deferFavorite){pendingFavorite=callback;return;}boolean saved=!isFavorite(item);if(saved)favoriteKeys.add(item.key());else favoriteKeys.remove(item.key());callback.onResult(saved);}
        public void epg(Item item,Callback<List<Programme>> callback) {epgCalls++;if(deferEpg){pendingEpg=callback;return;}if(epgFailure!=null)callback.onError(new Failure(epgFailure,"fixture"));else callback.onResult(programmes);}
        public void logout() {}
    }
}
