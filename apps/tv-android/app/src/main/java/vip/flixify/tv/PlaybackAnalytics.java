package vip.flixify.tv;
import java.util.Map;
final class PlaybackAnalytics {
    interface Emit {void event(String name,Map<String,Object> values);}
    private final Map<String,Object> item;
    private final Emit emit;
    private final long requested;
    private long last,watch,bufferStarted=-1;
    private boolean started,ended,wasPlaying;
    private int milestones;
    PlaybackAnalytics(Map<String,Object> item,long now,Emit emit) {this.item=item;this.emit=emit;requested=last=now;emit.event("playback_request",item);}
    private Map<String,Object> values(String key,Object value) {Map<String,Object> v=new java.util.LinkedHashMap<>(item);v.put(key,value);return v;}
    void firstFrame(long now) {if(started||ended)return;started=true;last=now;emit.event("video_start",values("startup_ms",Math.max(0,Math.min(86400000,now-requested))));}
    void sample(long now,long position,long duration,boolean playing,boolean buffering) {
        if(ended)return;
        if(started && wasPlaying)watch+=Math.max(0,Math.min(2000,now-last));last=now;wasPlaying=playing&&!buffering;
        if(started && buffering && bufferStarted<0)bufferStarted=now;
        if(bufferStarted>=0 && !buffering){emit.event("playback_buffer",values("buffer_ms",Math.max(0,Math.min(86400000,now-bufferStarted))));bufferStarted=-1;}
        if(started && duration>0 && position>=0)for(int i=0;i<3;i++){int mark=(i+1)*25;if((milestones&(1<<i))==0&&position/(double)duration*100>=mark){milestones|=1<<i;emit.event("video_progress",values("progress_percent",mark));}}
    }
    void end(long now,String reason,boolean complete) {
        if(ended)return;sample(now,0,0,false,false);ended=true;
        if(complete && started)emit.event("video_complete",item);
        Map<String,Object> v=values("watch_ms",Math.min(86400000,watch));v.put("reason",reason);emit.event("playback_end",v);
    }
}
