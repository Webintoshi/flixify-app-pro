package vip.flixify.tv.player;

/** First preparation and an established playback stall have different patience budgets. */
public final class PlaybackWatchdog {
    public static final long STARTUP_MS=30000, STALL_MS=12000;
    private long started,lastProgress,lastPosition;
    private boolean firstFrame;
    public void start(long now,long position) {started=lastProgress=now;lastPosition=position;firstFrame=false;}
    public void firstFrame(long now) {firstFrame=true;lastProgress=now;}
    public void interaction(long now) {lastProgress=now;}
    public boolean stalled(long now,long position,boolean wantsPlay,int state,boolean playing) {
        if(!wantsPlay || state==PlayerEngine.ENDED) {lastProgress=now;if(!firstFrame)started=now;return false;}
        if(!firstFrame)return now-started>=STARTUP_MS;
        if((state==PlayerEngine.READY && !playing) || Math.abs(position-lastPosition)>=200)lastProgress=now;
        lastPosition=position;
        return now-lastProgress>=STALL_MS;
    }
}
