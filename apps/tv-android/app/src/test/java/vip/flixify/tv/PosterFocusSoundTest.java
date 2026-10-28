package vip.flixify.tv;
import org.junit.Test;
import static org.junit.Assert.*;

public final class PosterFocusSoundTest {
    static final class Output implements PosterFocusSound.Output {
        int plays,stops,closes;boolean ready=true,broken;
        public int play(){if(broken)throw new IllegalStateException("no audio device");if(!ready)return 0;return ++plays;}
        public void stop(){stops++;}public void close(){closes++;}
    }
    @Test public void everyRapidDistinctPosterPlaysWithoutTimeDebounce() {
        Output out=new Output();PosterFocusSound sound=new PosterFocusSound(out);sound.resume();
        for(String id:new String[]{"A","B","C","B"})sound.focused("scope",id);
        assertEquals(4,out.plays);
    }
    @Test public void samePosterRebindResizeAndReturnAreSilentButScopeChangeIsNew() {
        Output out=new Output();PosterFocusSound sound=new PosterFocusSound(out);sound.resume();
        sound.focused("scope","A");sound.focused("scope","A");sound.pause();sound.resume();sound.focused("scope","A");
        assertEquals(1,out.plays);sound.focused("other","A");assertEquals(2,out.plays);
    }
    @Test public void inactiveClosedAndRepeatedCloseCannotPlayOrLeak() {
        Output out=new Output();PosterFocusSound sound=new PosterFocusSound(out);sound.focused("s","A");assertEquals(0,out.plays);
        sound.resume();sound.focused("s","A");sound.pause();sound.focused("s","B");assertEquals(1,out.plays);assertEquals(1,out.stops);
        sound.close();sound.close();sound.resume();sound.focused("s","C");assertEquals(1,out.plays);assertEquals(1,out.closes);
    }
    @Test public void unavailableSampleNeverQueuesAStaleMovement() {
        Output out=new Output();out.ready=false;PosterFocusSound sound=new PosterFocusSound(out);sound.resume();sound.focused("s","A");
        out.ready=true;assertEquals(0,out.plays);sound.focused("s","A");assertEquals(0,out.plays);sound.focused("s","B");assertEquals(1,out.plays);
    }
    @Test public void userLeavingPostersAndReenteringGetsANewCue() {
        Output out=new Output();PosterFocusSound sound=new PosterFocusSound(out);sound.resume();sound.focused("s","A");sound.leftPosters();sound.focused("s","A");assertEquals(2,out.plays);
    }
    @Test public void audioFailureDoesNotBreakBrowsing() {
        Output out=new Output();out.broken=true;PosterFocusSound sound=new PosterFocusSound(out);sound.resume();sound.focused("s","A");sound.pause();sound.close();
    }
}
