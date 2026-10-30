package vip.flixify.tv;

import java.util.IdentityHashMap;
import java.util.Map;

/** Optional device-cache work yields until every foreground player has stopped. */
public final class BackgroundWorkGate {
    private static final Map<Object,Boolean> players=new IdentityHashMap<>();
    private static volatile boolean playbackActive;
    private BackgroundWorkGate() {}

    public static synchronized void beginPlayback(Object owner) {
        if(owner==null)return;
        players.put(owner,Boolean.TRUE);
        playbackActive=true;
    }

    public static synchronized void endPlayback(Object owner) {
        players.remove(owner);
        playbackActive=!players.isEmpty();
    }

    public static boolean isPlaybackActive() {return playbackActive;}
}
