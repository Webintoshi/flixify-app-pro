package vip.flixify.tv.player;

import android.content.Context;
import android.view.View;
import java.util.List;
import vip.flixify.tv.TvModels.Playback;

/** Small playback boundary: instrumentation supplies a local fake, never an Intent URL. */
public interface PlayerEngine {
    int IDLE=1, BUFFERING=2, READY=3, ENDED=4;
    interface Listener {
        void onStateChanged(int state);
        /** A decoded video frame reached the output surface; READY alone is insufficient. */
        default void onFirstFrame() {}
        void onTracksChanged();
        void onError();
    }
    interface Factory { PlayerEngine create(Context context, Listener listener); }
    final class Track {
        public final String id,label;
        public final boolean selected;
        public Track(String id,String label,boolean selected) {this.id=id;this.label=label;this.selected=selected;}
    }
    View view();
    void prepare(Playback playback,long startPositionMs,boolean play);
    void play();
    void pause();
    void seek(long positionMs);
    long position();
    long duration();
    boolean playing();
    boolean wantsToPlay();
    int state();
    List<Track> tracks(boolean subtitles);
    /** Empty id restores automatic audio selection or disables subtitles. */
    void selectTrack(boolean subtitles,String id);
    void release();
}
