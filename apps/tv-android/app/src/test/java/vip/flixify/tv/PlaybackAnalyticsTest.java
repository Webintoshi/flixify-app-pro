package vip.flixify.tv;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;
public class PlaybackAnalyticsTest {
    @Test public void firstFrameAndConfirmedEndAreCountedOnceWithoutPollingFlood() {
        List<String> names=new ArrayList<>();List<Map<String,Object>> values=new ArrayList<>();
        PlaybackAnalytics p=new PlaybackAnalytics(Collections.emptyMap(),100,(n,v)->{names.add(n);values.add(v);});
        assertEquals(Arrays.asList("playback_request"),names);
        p.sample(200,5000,10000,true,false);assertFalse(names.contains("video_start"));
        p.firstFrame(400);p.firstFrame(500);assertEquals(1,Collections.frequency(names,"video_start"));
        for(int i=1;i<=80;i++)p.sample(400+i*100,5000,10000,true,false);
        assertEquals(2,Collections.frequency(names,"video_progress"));
        p.sample(9000,9500,10000,true,false);assertFalse(names.contains("video_complete"));
        p.end(9100,"completed",true);p.end(9200,"completed",true);
        assertEquals(1,Collections.frequency(names,"video_complete"));assertEquals(1,Collections.frequency(names,"playback_end"));
        assertEquals(300L,values.get(names.indexOf("video_start")).get("startup_ms"));
    }
    @Test public void failedStartupIsNeverCompleteAndPauseDoesNotAccrueWatchTime() {
        List<String> names=new ArrayList<>();
        PlaybackAnalytics p=new PlaybackAnalytics(Collections.emptyMap(),0,(n,v)->names.add(n));
        p.sample(100,0,1000,false,true);p.end(200,"decoder",false);
        assertFalse(names.contains("video_start"));assertFalse(names.contains("video_complete"));
    }
    @Test public void pausedTimeAndRepeatedBufferSamplesDoNotInflateTotals() {
        Map<String,Map<String,Object>> sent=new HashMap<>();
        PlaybackAnalytics p=new PlaybackAnalytics(Collections.emptyMap(),0,(n,v)->sent.put(n,v));
        p.firstFrame(0);p.sample(0,0,0,true,false);p.sample(1000,0,0,true,false);p.sample(2000,0,0,false,false);
        p.sample(9000,0,0,false,true);p.sample(9500,0,0,false,true);p.sample(10000,0,0,false,false);p.end(20000,"closed",false);
        assertEquals(2000L,sent.get("playback_end").get("watch_ms"));assertEquals(1000L,sent.get("playback_buffer").get("buffer_ms"));
    }
}
