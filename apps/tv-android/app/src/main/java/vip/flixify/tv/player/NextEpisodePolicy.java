package vip.flixify.tv.player;

import vip.flixify.tv.TvModels.Item;
import vip.flixify.tv.TvModels.Kind;

/** One continuation choice per selected episode. It never owns a URL or opens a stream. */
public final class NextEpisodePolicy {
    public static final long COUNTDOWN_MS=5000;
    private boolean cancelled,handled;
    private long deadline=-1;
    public NextEpisodePolicy(boolean cancelled,boolean handled) {this.cancelled=cancelled;this.handled=handled;}
    public static boolean validSuccessor(Item item,Item next) {
        return item!=null && next!=null && item.kind==Kind.EPISODE && next.kind==Kind.EPISODE
                && !item.scope.isEmpty() && item.scope.equals(next.scope)
                && !item.seriesId.isEmpty() && item.seriesId.equals(next.seriesId)
                && !item.key().equals(next.key())
                && (next.season>item.season || (next.season==item.season && next.episode>item.episode));
    }
    public boolean begin(Item item,Item next,long duration,long now) {
        if(cancelled || handled || deadline>=0 || duration<=0 || !validSuccessor(item,next))return false;
        deadline=now+COUNTDOWN_MS;return true;
    }
    public boolean pending() {return deadline>=0 && !cancelled && !handled;}
    public long remaining(long now) {return pending()?Math.max(0,deadline-now):0;}
    public boolean claim(long now,boolean immediately) {
        if(!pending() || (!immediately && now<deadline))return false;
        handled=true;deadline=-1;return true;
    }
    public void cancel() {cancelled=true;deadline=-1;}
    public boolean cancelled() {return cancelled;}
    public boolean handled() {return handled;}
}
