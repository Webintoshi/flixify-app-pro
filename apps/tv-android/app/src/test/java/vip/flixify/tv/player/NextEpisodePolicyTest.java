package vip.flixify.tv.player;

import org.junit.Test;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;

public class NextEpisodePolicyTest {
    private Item item(String id,String scope,String series,int season,int episode) {
        return new Item(Kind.EPISODE,id,id,"","","","mp4",scope,series,season,episode,"");
    }
    private final Item selected=item("a","scope","series",1,1),next=item("b","scope","series",1,2);
    @Test public void countdownWaitsFullFiveSecondsAndClaimsOnlyOnce() {
        NextEpisodePolicy policy=new NextEpisodePolicy(false,false);
        assertTrue(policy.begin(selected,next,300000,100));
        assertFalse(policy.begin(selected,next,300000,200));
        assertFalse(policy.claim(5099,false));assertEquals(1,policy.remaining(5099));
        assertTrue(policy.claim(5100,false));assertFalse(policy.claim(5100,true));
        assertFalse(policy.begin(selected,next,300000,6000));
    }
    @Test public void cancellationSurvivesRestoredPolicyAndImmediateChoiceClaimsOnce() {
        NextEpisodePolicy policy=new NextEpisodePolicy(false,false);
        policy.begin(selected,next,300000,100);policy.cancel();
        assertFalse(policy.claim(6000,true));
        assertFalse(new NextEpisodePolicy(policy.cancelled(),policy.handled()).begin(selected,next,300000,7000));
        policy=new NextEpisodePolicy(false,false);assertTrue(policy.begin(selected,next,300000,100));
        assertTrue(policy.claim(101,true));assertFalse(policy.claim(102,true));
    }
    @Test public void acceptsOnlyOrderedEpisodesWithinSameSeriesAndScope() {
        assertTrue(NextEpisodePolicy.validSuccessor(selected,next));
        assertTrue(NextEpisodePolicy.validSuccessor(selected,item("c","scope","series",2,1)));
        assertFalse(NextEpisodePolicy.validSuccessor(selected,item("b","other","series",1,2)));
        assertFalse(NextEpisodePolicy.validSuccessor(selected,item("b","scope","other",1,2)));
        assertFalse(NextEpisodePolicy.validSuccessor(selected,selected));
        assertFalse(NextEpisodePolicy.validSuccessor(next,selected));
        assertFalse(new NextEpisodePolicy(false,false).begin(selected,next,-1,100));
    }
}
