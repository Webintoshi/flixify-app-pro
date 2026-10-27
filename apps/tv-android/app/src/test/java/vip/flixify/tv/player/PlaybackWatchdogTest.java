package vip.flixify.tv.player;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackWatchdogTest {
    @Test public void initialPreparationGetsThirtySecondsWithoutPretendingReadyIsAFrame() {
        PlaybackWatchdog watchdog=new PlaybackWatchdog();watchdog.start(100,0);
        assertFalse(watchdog.stalled(12100,0,true,PlayerEngine.BUFFERING,false));
        assertFalse(watchdog.stalled(30099,0,true,PlayerEngine.READY,true));
        assertTrue(watchdog.stalled(30100,0,true,PlayerEngine.BUFFERING,false));
    }
    @Test public void actualFirstFrameUsesTwelveSecondEstablishedStallBudget() {
        PlaybackWatchdog watchdog=new PlaybackWatchdog();watchdog.start(100,0);watchdog.firstFrame(4000);
        assertFalse(watchdog.stalled(15999,0,true,PlayerEngine.BUFFERING,false));
        assertTrue(watchdog.stalled(16000,0,true,PlayerEngine.BUFFERING,false));
        assertFalse(watchdog.stalled(17000,500,true,PlayerEngine.READY,true));
        assertFalse(watchdog.stalled(30000,500,false,PlayerEngine.READY,false));
    }
}
