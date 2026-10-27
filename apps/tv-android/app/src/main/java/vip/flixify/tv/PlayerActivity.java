package vip.flixify.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.SeekBar;
import android.text.TextUtils;
import androidx.core.widget.TextViewCompat;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.player.Media3PlayerEngine;
import vip.flixify.tv.player.PlayerEngine;
import vip.flixify.tv.player.PlayerPolicy;
import vip.flixify.tv.player.NextEpisodePolicy;
import vip.flixify.tv.player.PlaybackWatchdog;

/** A foreground-only TV player. Media addresses enter exclusively through the scoped repository. */
@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
public final class PlayerActivity extends Activity {
    public static final String EXTRA_ITEM="tv_item";
    private static PlayerEngine.Factory testFactory;
    private static final long REFRESH_MS=60000, HIDE_MS=2000;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private TvRepository repository;
    private PlayerEngine engine;
    private PlayerPolicy policy;
    private Item item;
    private Playback playback;
    private FrameLayout root,video;
    private LinearLayout controls,row,secondary,countdownRow;
    private SeekBar timeline;
    private TextView episodeLine,countdownText;
    private final PlaybackWatchdog watchdog=new PlaybackWatchdog();
    private NextEpisodePolicy continuation=new NextEpisodePolicy(false,false);
    private TextView title,position,status;
    private Button play,backward,forward,audio,subtitles,next;
    private AlertDialog trackDialog;
    private List<Item> liveItems=Collections.emptyList();
    private boolean active,resumed,loading,fatal,admitted,refreshing,watched,desiredPlay=true;
    private int generation,pendingZap;
    private long cutoffAtMs,lastRefresh,lastProgress,lastPosition,lastSave,resumeOverride=-1;

    /** Trusted instrumentation only; release builds cannot install an alternate playback engine. */
    public static void setEngineFactoryForTests(PlayerEngine.Factory factory) {
        if(!BuildConfig.DEBUG)throw new SecurityException("Test injection is disabled");
        testFactory=factory;
    }
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        repository=TvApplication.repository(this);
        buildUi();
        Serializable value=savedInstanceState==null?getIntent().getSerializableExtra(EXTRA_ITEM):savedInstanceState.getSerializable(EXTRA_ITEM);
        if(!(value instanceof Item) || !playable((Item)value)) {fail(false);return;}
        item=(Item)value;
        title.setText(item.title);
        updateEpisodeLine();
        if(savedInstanceState!=null) {
            desiredPlay=savedInstanceState.getBoolean("desired_play",true);
            resumeOverride=savedInstanceState.getLong("resume",-1);
            watched=savedInstanceState.getBoolean("watched",false);
            continuation=new NextEpisodePolicy(savedInstanceState.getBoolean("next_cancelled"),savedInstanceState.getBoolean("next_handled"));
            admitted=savedInstanceState.getBoolean("admitted",false);
            cutoffAtMs=savedInstanceState.getLong("cutoff",0);
            policy=new PlayerPolicy(item.scope);
            if(admitted)policy.admit(item.scope,cutoffAtMs,System.currentTimeMillis());
            policy.restoreRecoveryCount(savedInstanceState.getInt("recoveries",0));
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        savePosition();
        if(engine!=null)desiredPlay=engine.wantsToPlay();
        state.putSerializable(EXTRA_ITEM,item);
        state.putBoolean("desired_play",desiredPlay);state.putLong("resume",resumeOverride);
        state.putBoolean("watched",watched);state.putBoolean("admitted",admitted);state.putLong("cutoff",cutoffAtMs);
        state.putBoolean("next_cancelled",continuation.cancelled() || continuation.pending());
        state.putBoolean("next_handled",continuation.handled());
        state.putInt("recoveries",policy==null?0:policy.recoveryCount());
        super.onSaveInstanceState(state);
    }
    @Override protected void onResume() {
        super.onResume();
        active=true;resumed=true;
        immersive();
        if(fatal || item==null)return;
        // Wall-clock access is checked before any decoder is recreated after sleep/backgrounding.
        if(admitted && !policy.allows(System.currentTimeMillis(),repository.currentScope())) {fail(true);return;}
        if(policy==null)policy=new PlayerPolicy(item.scope);
        if(engine==null && !loading)requestPlayback(false);
        else refreshAccess();
        handler.removeCallbacks(tick);
        handler.post(tick);
    }
    @Override protected void onPause() {
        // The player may remain visible in STARTED while another activity owns input.
        // Keep admission/engine callbacks alive; only continuation requires resumed state.
        resumed=false;
        if(continuation.pending())cancelContinuation();
        super.onPause();
    }
    @Override protected void onStop() {
        if(continuation.pending())cancelContinuation();
        if(engine!=null)desiredPlay=engine.wantsToPlay();
        active=false;
        generation++;
        loading=false;
        refreshing=false;
        if(trackDialog!=null)trackDialog.dismiss();
        handler.removeCallbacksAndMessages(null);
        savePosition();
        releaseEngine();
        super.onStop();
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if(focused)immersive();
    }
    private boolean playable(Item candidate) {
        return candidate!=null && !candidate.id.isEmpty() && !candidate.scope.isEmpty()
                && candidate.scope.equals(repository.currentScope())
                && (candidate.kind==Kind.LIVE || candidate.kind==Kind.MOVIE || candidate.kind==Kind.EPISODE);
    }
    private void select(Item candidate) {
        if(!playable(candidate)) {fail(true);return;}
        savePosition();
        releaseEngine(); // The prior connection closes before requesting or creating another stream.
        handler.removeCallbacks(advance);
        continuation=new NextEpisodePolicy(false,false);
        countdownRow.setVisibility(View.GONE);
        updateCountdownFocus();
        item=candidate;
        updateEpisodeLine();
        playback=null;
        watched=false;
        admitted=false;
        desiredPlay=true;
        resumeOverride=-1;
        policy=new PlayerPolicy(item.scope);
        requestPlayback(false);
    }
    private void requestPlayback(boolean recovery) {
        if(!active || fatal || !playable(item)) {if(active)fail(true);return;}
        if(admitted && !policy.allows(System.currentTimeMillis(),repository.currentScope())) {fail(true);return;}
        savePosition();
        releaseEngine();
        final int request=++generation;
        refreshing=false;
        loading=true;
        title.setText(item.title);
        if(!recovery) {status.setText("Yükleniyor…");status.setVisibility(View.VISIBLE);showControls(true);}
        updateButtons();
        repository.playback(item,new TvRepository.Callback<Playback>() {
            @Override public void onResult(Playback value) {
                if(!current(request))return;
                loading=false;
                if(value==null || value.item==null || !value.item.key().equals(item.key())
                        || !item.scope.equals(value.scope) || !playable(value.item)
                        || value.url==null || value.url.isEmpty()
                        || !policy.admit(value.scope,value.expiresAtMs,System.currentTimeMillis())) {fail(true);return;}
                item=value.item;title.setText(item.title);updateEpisodeLine();
                playback=value;
                admitted=true;
                cutoffAtMs=value.expiresAtMs;
                scheduleCutoff();
                PlayerEngine.Listener listener=new PlayerEngine.Listener() {
                    @Override public void onStateChanged(int state) {
                        if(!current(request))return;
                        if(state==PlayerEngine.READY)status.setVisibility(View.GONE);
                        if(state==PlayerEngine.ENDED) {savePosition();showControls(false);beginContinuation();}
                        updateButtons();
                        scheduleHide();
                    }
                    @Override public void onFirstFrame() {if(current(request)) {watchdog.firstFrame(SystemClock.elapsedRealtime());status.setVisibility(View.GONE);}}
                    @Override public void onTracksChanged() {if(current(request))updateButtons();}
                    @Override public void onError() {if(current(request))recover();}
                };
                try {
                    PlayerEngine.Factory factory=testFactory==null?Media3PlayerEngine::new:testFactory;
                    engine=factory.create(PlayerActivity.this,listener);
                    video.addView(engine.view(),new FrameLayout.LayoutParams(-1,-1));
                    long start=item.kind==Kind.LIVE?0:(resumeOverride>=0?resumeOverride:value.resumePositionMs);
                    lastPosition=Math.max(0,start);
                    lastProgress=SystemClock.elapsedRealtime();
                    watchdog.start(lastProgress,lastPosition);
                    engine.prepare(value,lastPosition,desiredPlay);
                    updateButtons();
                    if(!recovery)showControls(true);
                    scheduleHide();
                    if(item.kind==Kind.LIVE && liveItems.isEmpty())loadLiveCatalog(request);
                    refreshAccess();
                } catch(RuntimeException ignored) {recover();}
            }
            @Override public void onError(Failure failure) {
                if(!current(request))return;
                loading=false;
                if(recovery && failure.code==Failure.Code.NETWORK && policy.allows(System.currentTimeMillis(),repository.currentScope())) {
                    handler.postDelayed(()->{if(current(request))recover();},1500);
                } else fail(failure.code!=Failure.Code.NETWORK && failure.code!=Failure.Code.INVALID);
            }
        });
    }
    private boolean current(int request) {return active && !fatal && request==generation;}
    private void refreshAccess() {
        if(!active || fatal || !admitted || refreshing)return;
        refreshing=true;
        lastRefresh=SystemClock.elapsedRealtime();
        final int request=generation;
        repository.refreshAccess(new TvRepository.Callback<Account>() {
            @Override public void onResult(Account account) {
                if(!current(request))return;
                refreshing=false;
                if(account==null || !policy.refresh(account.canPlay,repository.currentScope(),account.expiresAtMs,System.currentTimeMillis())) {fail(true);return;}
                cutoffAtMs=account.expiresAtMs;
                scheduleCutoff(); // Deliberately no prepare, seek, pause or decoder recreation.
            }
            @Override public void onError(Failure failure) {
                if(!current(request))return;
                refreshing=false;
                if(!policy.refreshFailure(failure.code,System.currentTimeMillis(),repository.currentScope()))fail(true);
            }
        });
    }
    private final Runnable cutoff=new Runnable() {
        @Override public void run() {
            if(!active || fatal || !admitted)return;
            if(!policy.allows(System.currentTimeMillis(),repository.currentScope()))fail(true);
            else scheduleCutoff();
        }
    };
    private void scheduleCutoff() {
        handler.removeCallbacks(cutoff);
        handler.postDelayed(cutoff,Math.max(1,Math.min(REFRESH_MS,cutoffAtMs-System.currentTimeMillis())));
    }
    private final Runnable tick=new Runnable() {
        @Override public void run() {
            if(!active || fatal)return;
            long now=SystemClock.elapsedRealtime();
            if(admitted && !policy.allows(System.currentTimeMillis(),repository.currentScope())) {fail(true);return;}
            if(admitted && now-lastRefresh>=REFRESH_MS)refreshAccess();
            if(engine!=null) {
                long value=engine.position();
                boolean stalled=watchdog.stalled(now,value,engine.wantsToPlay(),engine.state(),engine.playing());
                lastPosition=value;
                position.setText(item.kind==Kind.LIVE?"CANLI":time(value)+" / "+time(engine.duration()));
                if(now-lastSave>=10000) {savePosition();lastSave=now;}
                updateTimeline();
                if(stalled)recover();
            }
            handler.postDelayed(this,500);
        }
    };
    private void recover() {
        if(!active || fatal || loading)return;
        if(policy==null || !policy.claimRecovery(System.currentTimeMillis(),repository.currentScope())) {fail(false);return;}
        if(engine!=null) {
            desiredPlay=engine.wantsToPlay();
            if(item.kind!=Kind.LIVE)resumeOverride=engine.position();
        }
        lastProgress=SystemClock.elapsedRealtime();
        requestPlayback(true);
    }
    private void savePosition() {
        if(engine==null || item==null || item.kind==Kind.LIVE || !item.scope.equals(repository.currentScope()))return;
        long value=engine.position(),duration=engine.duration();
        resumeOverride=value;
        repository.savePosition(item,value,duration);
        if(!watched && item.kind==Kind.EPISODE && PlayerPolicy.nearEnd(value,duration)) {watched=true;repository.markWatched(item);}
    }
    private void releaseEngine() {
        PlayerEngine previous=engine;
        engine=null;
        if(previous!=null)previous.release();
        if(video!=null)video.removeAllViews();
    }
    private void fail(boolean access) {
        if(fatal)return;
        fatal=true;
        generation++;
        if(policy!=null)policy.stop();
        handler.removeCallbacksAndMessages(null);
        continuation.cancel();
        countdownRow.setVisibility(View.GONE);
        updateCountdownFocus();
        if(trackDialog!=null)trackDialog.dismiss();
        savePosition();
        releaseEngine();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        status.setText(access?"Oturum veya erişim süresi sona erdi. Geri dönüp hesabınızı kontrol edin.":"Yayın oynatılamadı. Geri dönüp yeniden deneyin.");
        status.setVisibility(View.VISIBLE);
        controls.setVisibility(View.VISIBLE);
        updateButtons();
        View exit=controls.findViewWithTag("tv_player_exit");
        if(exit!=null)exit.requestFocus();
    }
    private void loadLiveCatalog(int request) {
        repository.catalog(Kind.LIVE,false,new TvRepository.Callback<Catalog>() {
            @Override public void onResult(Catalog catalog) {
                if(!current(request) || catalog==null)return;
                List<Item> valid=new ArrayList<>();
                for(Item value:catalog.items)if(value.kind==Kind.LIVE && playable(value))valid.add(value);
                liveItems=valid;
                if(pendingZap!=0) {int delta=pendingZap;pendingZap=0;zap(delta);}
            }
            @Override public void onError(Failure failure) {
                if(current(request) && failure.code!=Failure.Code.NETWORK)fail(true);
            }
        });
    }
    private void zap(int delta) {
        if(item==null || item.kind!=Kind.LIVE || fatal)return;
        if(liveItems.isEmpty()) {pendingZap=delta;loadLiveCatalog(generation);return;}
        int index=-1;
        for(int i=0;i<liveItems.size();i++)if(liveItems.get(i).id.equals(item.id)) {index=i;break;}
        int target=index<0?0:(index+delta+liveItems.size())%liveItems.size();
        if(!liveItems.get(target).id.equals(item.id))select(liveItems.get(target));
    }
    private void next() {
        if(item!=null && item.kind==Kind.LIVE)zap(1);
        else if(validNext())select(playback.nextEpisode);
    }
    private void toggle() {
        if(engine==null || fatal)return;
        if(!policy.allows(System.currentTimeMillis(),repository.currentScope())) {fail(true);return;}
        if(engine.wantsToPlay())engine.pause();else engine.play();
        desiredPlay=engine.wantsToPlay();
        showControls(false);
        updateButtons();
    }
    private void seek(long delta) {
        if(engine==null || item.kind==Kind.LIVE || fatal)return;
        if(continuation.pending())cancelContinuation();
        long destination=Math.max(0,engine.position()+delta),duration=engine.duration();
        if(duration>0)destination=Math.min(destination,Math.max(0,duration-1000));
        engine.seek(destination);
        lastProgress=SystemClock.elapsedRealtime();
        watchdog.interaction(lastProgress);
        updateTimeline();
        showControls(false);
    }
    private void tracks(boolean text) {
        if(engine==null || fatal)return;
        final PlayerEngine selectedEngine=engine;
        List<PlayerEngine.Track> options=new ArrayList<>();
        options.add(new PlayerEngine.Track("",text?"Kapalı":"Otomatik",false));
        options.addAll(engine.tracks(text));
        String[] labels=new String[options.size()];
        int selected=0;
        for(int i=0;i<options.size();i++) {labels[i]=options.get(i).label;if(options.get(i).selected)selected=i;}
        handler.removeCallbacks(hide);
        trackDialog=new AlertDialog.Builder(this).setTitle(text?"Altyazı":"Ses dili")
                .setSingleChoiceItems(labels,selected,(dialog,which)-> {
                    if(active && !fatal && engine==selectedEngine)selectedEngine.selectTrack(text,options.get(which).id);
                    dialog.dismiss();
                }).setNegativeButton("Geri",(dialog,which)->dialog.dismiss()).create();
        trackDialog.setOnDismissListener(dialog->{trackDialog=null;showControls(false);(text?subtitles:audio).requestFocus();});
        trackDialog.show();
    }
    private final Runnable hide=()-> {
        if(active && !fatal && engine!=null && engine.playing() && trackDialog==null && !continuation.pending()) {
            controls.setVisibility(View.GONE);
            root.requestFocus();
        }
    };
    private void scheduleHide() {
        handler.removeCallbacks(hide);
        if(engine!=null && engine.playing() && trackDialog==null && !continuation.pending())handler.postDelayed(hide,HIDE_MS);
    }
    private void showControls(boolean focus) {
        boolean wasHidden=controls.getVisibility()!=View.VISIBLE;
        controls.setVisibility(View.VISIBLE);
        if((focus || wasHidden) && play.isEnabled())play.requestFocus();
        scheduleHide();
    }
    private void updateButtons() {
        boolean available=engine!=null && !fatal;
        boolean live=item!=null && item.kind==Kind.LIVE;
        play.setEnabled(available);
        play.setText(available && engine.wantsToPlay()?"Duraklat":"Oynat");
        backward.setText(live?"Önceki kanal":"−10 sn");
        forward.setText(live?"Sonraki kanal":"+10 sn");
        backward.setEnabled(available);forward.setEnabled(available);
        audio.setEnabled(available);subtitles.setEnabled(available);
        next.setVisibility(!live && validNext()?View.VISIBLE:View.GONE);
        timeline.setVisibility(live?View.GONE:View.VISIBLE);
        timeline.setEnabled(available && !live && engine.duration()>0);
        next.setEnabled(available);
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int code=event.getKeyCode();
        boolean media=code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code==KeyEvent.KEYCODE_MEDIA_PLAY || code==KeyEvent.KEYCODE_MEDIA_PAUSE
                || code==KeyEvent.KEYCODE_MEDIA_STOP || code==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || code==KeyEvent.KEYCODE_MEDIA_REWIND
                || code==KeyEvent.KEYCODE_MEDIA_NEXT || code==KeyEvent.KEYCODE_MEDIA_PREVIOUS
                || code==KeyEvent.KEYCODE_CHANNEL_UP || code==KeyEvent.KEYCODE_CHANNEL_DOWN;
        if(event.getAction()==KeyEvent.ACTION_UP && media)return true;
        if(event.getAction()!=KeyEvent.ACTION_DOWN)return super.dispatchKeyEvent(event);
        if(admitted && !fatal && !policy.allows(System.currentTimeMillis(),repository.currentScope()))fail(true);
        if(media) {
            if(event.getRepeatCount()>0)return true;
            switch(code) {
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:toggle();break;
                case KeyEvent.KEYCODE_MEDIA_PLAY:if(engine!=null && !engine.wantsToPlay())toggle();break;
                case KeyEvent.KEYCODE_MEDIA_PAUSE:if(engine!=null && engine.wantsToPlay())toggle();break;
                case KeyEvent.KEYCODE_MEDIA_STOP:finish();break;
                case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:seek(10000);break;
                case KeyEvent.KEYCODE_MEDIA_REWIND:seek(-10000);break;
                case KeyEvent.KEYCODE_MEDIA_NEXT:next();break;
                case KeyEvent.KEYCODE_CHANNEL_UP:zap(1);break;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:case KeyEvent.KEYCODE_CHANNEL_DOWN:zap(-1);break;
                default:break;
            }
            return true;
        }
        boolean dpad=code==KeyEvent.KEYCODE_DPAD_LEFT || code==KeyEvent.KEYCODE_DPAD_RIGHT || code==KeyEvent.KEYCODE_DPAD_UP
                || code==KeyEvent.KEYCODE_DPAD_DOWN || code==KeyEvent.KEYCODE_DPAD_CENTER || code==KeyEvent.KEYCODE_ENTER;
        if(dpad) {
            if(controls.getVisibility()!=View.VISIBLE) {
                if(code==KeyEvent.KEYCODE_DPAD_LEFT) {if(item.kind==Kind.LIVE)zap(-1);else seek(-10000);}
                if(code==KeyEvent.KEYCODE_DPAD_RIGHT) {if(item.kind==Kind.LIVE)zap(1);else seek(10000);}
                showControls(true);
                return true;
            }
            scheduleHide();
        }
        return super.dispatchKeyEvent(event);
    }
    @Override public void onBackPressed() {
        if(continuation.pending()) {cancelContinuation();return;}
        if(!fatal && controls.getVisibility()==View.VISIBLE && engine!=null && engine.playing()) {
            handler.removeCallbacks(hide);controls.setVisibility(View.GONE);root.requestFocus();
        } else super.onBackPressed();
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
    private boolean validNext() {
        return playback!=null && NextEpisodePolicy.validSuccessor(item,playback.nextEpisode)
                && playable(playback.nextEpisode);
    }
    private void beginContinuation() {
        if(!resumed || engine==null || !validNext() || !policy.allows(System.currentTimeMillis(),repository.currentScope()))return;
        if(!continuation.begin(item,playback.nextEpisode,engine.duration(),SystemClock.elapsedRealtime()))return;
        countdownRow.setVisibility(View.VISIBLE);
        updateCountdownFocus();
        handler.removeCallbacks(hide);
        showControls(false);
        controls.findViewWithTag("tv_player_watch_next").requestFocus();
        handler.post(advance);
    }
    private final Runnable advance=new Runnable() {
        @Override public void run() {
            if(!active || !resumed || fatal || !continuation.pending())return;
            if(!policy.allows(System.currentTimeMillis(),repository.currentScope())) {fail(true);return;}
            if(!validNext()) {cancelContinuation();return;}
            long remaining=continuation.remaining(SystemClock.elapsedRealtime());
            countdownText.setText("Sonraki bölüm · "+Math.max(1,(remaining+999)/1000)+" sn");
            if(continuation.claim(SystemClock.elapsedRealtime(),false)) {select(playback.nextEpisode);return;}
            handler.postDelayed(this,Math.min(250,Math.max(1,remaining)));
        }
    };
    private void watchNextNow() {
        if(!active || !resumed || fatal || !validNext() || !policy.allows(System.currentTimeMillis(),repository.currentScope()))return;
        if(continuation.claim(SystemClock.elapsedRealtime(),true))select(playback.nextEpisode);
    }
    private void cancelContinuation() {cancelContinuation(true);}
    private void cancelContinuation(boolean focusPlay) {
        continuation.cancel();handler.removeCallbacks(advance);countdownRow.setVisibility(View.GONE);updateCountdownFocus();showControls(false);
        if(focusPlay)play.requestFocus();
    }
    private void updateCountdownFocus() {
        View watchNow=countdownRow.findViewWithTag("tv_player_watch_next"),cancel=countdownRow.findViewWithTag("tv_player_cancel_next");
        boolean shown=countdownRow.getVisibility()==View.VISIBLE;
        int above=shown?watchNow.getId():timeline.getId();
        play.setNextFocusUpId(above);backward.setNextFocusUpId(above);forward.setNextFocusUpId(above);
        timeline.setNextFocusDownId(shown?watchNow.getId():play.getId());
        watchNow.setNextFocusUpId(timeline.getId());cancel.setNextFocusUpId(timeline.getId());
        watchNow.setNextFocusDownId(play.getId());cancel.setNextFocusDownId(forward.getId());
    }
    private void updateEpisodeLine() {
        episodeLine.setText(item.kind==Kind.EPISODE?"Sezon "+item.season+" · Bölüm "+item.episode:item.kind==Kind.LIVE?"CANLI YAYIN":"FİLM");
    }
    private void updateTimeline() {
        if(engine==null || item.kind==Kind.LIVE)return;
        long duration=engine.duration();
        timeline.setEnabled(!fatal && duration>0);
        if(duration>0) {
            timeline.setKeyProgressIncrement(Math.max(1,(int)Math.min(1000,10000000L/duration)));
            timeline.setProgress((int)Math.min(1000,Math.max(0,engine.position()*1000/duration)));
        } else timeline.setProgress(0);
    }
    private void buildUi() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        root=new FrameLayout(this) {
            @Override protected void onMeasure(int widthSpec,int heightSpec) {
                // Insets belong to measurement: changing them after child measurement leaves
                // the first layout using stale weighted widths and a stale overlay height.
                if(controls!=null) {
                    int w=View.MeasureSpec.getSize(widthSpec),h=View.MeasureSpec.getSize(heightSpec);
                    int inset=Math.max(dp(12),Math.min(dp(36),w/25));
                    int top=dp(h<dp(400)?8:20),bottom=dp(h<dp(400)?12:24);
                    if(controls.getPaddingLeft()!=inset || controls.getPaddingRight()!=inset
                            || controls.getPaddingTop()!=top || controls.getPaddingBottom()!=bottom)
                        controls.setPadding(inset,top,inset,bottom);
                }
                super.onMeasure(widthSpec,heightSpec);
            }
        };
        root.setBackgroundColor(0xff07090c);root.setFocusable(true);root.setFocusableInTouchMode(true);
        video=new FrameLayout(this);video.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        root.addView(video,new FrameLayout.LayoutParams(-1,-1));
        status=new TextView(this);status.setTag("tv_player_status");status.setTextColor(0xfff5f6f8);status.setTextSize(22);status.setGravity(Gravity.CENTER);status.setPadding(dp(24),dp(16),dp(24),dp(16));
        root.addView(status,new FrameLayout.LayoutParams(-1,-1));
        controls=new LinearLayout(this);controls.setTag("tv_player_controls");controls.setOrientation(LinearLayout.VERTICAL);
        controls.setBackgroundResource(R.drawable.tv_player_scrim);
        title=label(24,0xfff5f6f8);title.setTag("tv_player_title");controls.addView(title,new LinearLayout.LayoutParams(-1,dp(32)));
        episodeLine=label(14,0xffa7b0be);controls.addView(episodeLine,new LinearLayout.LayoutParams(-1,dp(22)));
        position=label(14,0xffa7b0be);controls.addView(position,new LinearLayout.LayoutParams(-1,dp(22)));
        timeline=new SeekBar(this);timeline.setTag("tv_player_timeline");timeline.setId(View.generateViewId());timeline.setMax(1000);timeline.setProgressTintList(android.content.res.ColorStateList.valueOf(0xffff3545));
        timeline.setThumbTintList(android.content.res.ColorStateList.valueOf(0xfff5f6f8));timeline.setFocusable(true);
        timeline.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onStartTrackingTouch(SeekBar bar) {handler.removeCallbacks(hide);}
            public void onStopTrackingTouch(SeekBar bar) {scheduleHide();}
            public void onProgressChanged(SeekBar bar,int progress,boolean user) {
                if(user && engine!=null && !fatal && item.kind!=Kind.LIVE && engine.duration()>0) {
                    if(!policy.allows(System.currentTimeMillis(),repository.currentScope())) {fail(true);return;}
                    if(continuation.pending())cancelContinuation(false);
                    engine.seek(engine.duration()*progress/1000);watchdog.interaction(SystemClock.elapsedRealtime());showControls(false);
                }
            }
        });
        controls.addView(timeline,new LinearLayout.LayoutParams(-1,dp(28)));
        row=controlRow();secondary=controlRow();countdownRow=controlRow();countdownRow.setVisibility(View.GONE);
        countdownText=label(15,0xfff5f6f8);countdownRow.addView(countdownText,new LinearLayout.LayoutParams(0,dp(42),1.4f));
        button(countdownRow,"Şimdi izle","watch_next",this::watchNextNow);
        button(countdownRow,"İptal","cancel_next",this::cancelContinuation);
        play=button(row,"Oynat","play",this::toggle);
        backward=button(row,"−10 sn","backward",()->{if(item!=null && item.kind==Kind.LIVE)zap(-1);else seek(-10000);});
        forward=button(row,"+10 sn","forward",()->{if(item!=null && item.kind==Kind.LIVE)zap(1);else seek(10000);});
        audio=button(secondary,"Ses","audio",()->tracks(false));
        subtitles=button(secondary,"Altyazı","subtitles",()->tracks(true));
        next=button(secondary,"Sonraki bölüm","next",this::next);
        Button exit=button(secondary,"Çıkış","exit",this::finish);
        play.setNextFocusDownId(audio.getId());backward.setNextFocusDownId(subtitles.getId());forward.setNextFocusDownId(next.getId());
        audio.setNextFocusUpId(play.getId());subtitles.setNextFocusUpId(backward.getId());next.setNextFocusUpId(forward.getId());exit.setNextFocusUpId(forward.getId());
        controls.addView(countdownRow,new LinearLayout.LayoutParams(-1,-2));
        controls.addView(row,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout.LayoutParams secondaryLayout=new LinearLayout.LayoutParams(-1,-2);secondaryLayout.topMargin=dp(5);controls.addView(secondary,secondaryLayout);
        root.addView(controls,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));
        updateCountdownFocus();
        setContentView(root);play.requestFocus();
    }
    private TextView label(int size,int color) {
        TextView view=new TextView(this);view.setTextColor(color);view.setTextSize(size);view.setMaxLines(1);view.setEllipsize(TextUtils.TruncateAt.END);view.setGravity(Gravity.CENTER_VERTICAL);
        TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(view,12,size,1,android.util.TypedValue.COMPLEX_UNIT_SP);return view;
    }
    private LinearLayout controlRow() {LinearLayout value=new LinearLayout(this);value.setOrientation(LinearLayout.HORIZONTAL);value.setGravity(Gravity.CENTER_VERTICAL);return value;}
    private Button button(LinearLayout parent,String text,String tag,Runnable action) {
        Button button=new Button(this);button.setId(View.generateViewId());button.setTag("tv_player_"+tag);button.setText(text);button.setTextColor(0xfff5f6f8);button.setTextSize(16);button.setAllCaps(false);button.setSingleLine(true);button.setEllipsize(TextUtils.TruncateAt.END);
        TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(button,12,16,1,android.util.TypedValue.COMPLEX_UNIT_SP);
        button.setMinWidth(0);button.setMinimumWidth(0);button.setMinHeight(0);button.setMinimumHeight(0);button.setPadding(dp(6),dp(4),dp(6),dp(4));
        button.setBackgroundResource(R.drawable.tv_player_focus);button.setFocusable(true);button.setFocusableInTouchMode(true);
        button.setOnClickListener(view->{action.run();scheduleHide();});
        button.setOnFocusChangeListener((view,focused)->{if(focused)scheduleHide();});
        LinearLayout.LayoutParams layout=new LinearLayout.LayoutParams(0,dp(42),1);layout.setMargins(dp(2),0,dp(2),0);parent.addView(button,layout);return button;
    }
    private int dp(int value) {return Math.round(value*getResources().getDisplayMetrics().density);}
    private static String time(long ms) {
        if(ms<0)return "--:--";
        long seconds=ms/1000;
        return seconds>=3600?String.format(Locale.ROOT,"%d:%02d:%02d",seconds/3600,(seconds/60)%60,seconds%60):String.format(Locale.ROOT,"%d:%02d",seconds/60,seconds%60);
    }
}
