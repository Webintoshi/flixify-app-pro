package vip.flixify.tv;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;
import vip.flixify.tv.TvModels.Failure;
import static org.junit.Assert.*;

public class DeviceLoginControllerTest {
    private final Clock clock=new Clock();
    private final List<Attempt> attempts=new ArrayList<>();
    private DeviceLogin.ViewState state;
    private int signedIn;
    private final DeviceLoginController controller=new DeviceLoginController(callback->{Attempt a=new Attempt();attempts.add(a);callback.onResult(a);},clock,new DeviceLoginController.Listener(){
        public void changed(DeviceLogin.ViewState value){state=value;}
        public void adopted(){signedIn++;}
    });
    private static final class Clock implements DeviceLoginController.Scheduler {
        long time;Runnable task;long due;
        public long now(){return time;}
        public void schedule(Runnable value,long delay){task=value;due=time+delay;}
        public void clear(){task=null;}
        void advance(long ms){time+=ms;Runnable next=task;if(next!=null && time>=due){task=null;next.run();}}
    }
    private static final class Attempt implements DeviceLogin.Attempt {
        int polls,cancels,acks,adoptions;TvRepository.Callback<DeviceLogin.Poll> pending;boolean failAdoptionNetwork,failAck;Failure storageFailure;
        public DeviceLogin.Display display(){return new DeviceLogin.Display("BCDF-GHJK","fixture-png",180,2);}
        public void poll(TvRepository.Callback<DeviceLogin.Poll> callback){polls++;assertNull("one poll at a time",pending);pending=callback;}
        void reply(String status,int interval){TvRepository.Callback<DeviceLogin.Poll> cb=pending;pending=null;cb.onResult(new DeviceLogin.Poll(status,interval));}
        void network(){TvRepository.Callback<DeviceLogin.Poll> cb=pending;pending=null;cb.onError(new Failure(Failure.Code.NETWORK,"offline"));}
        public void adopt(DeviceLogin.AdoptionGuard allowed,TvRepository.Callback<Void> callback){if(!allowed.allowed()){callback.onError(new Failure(Failure.Code.STALE,"stale"));return;}if(storageFailure!=null){callback.onError(storageFailure);return;}if(failAdoptionNetwork){callback.onError(new Failure(Failure.Code.NETWORK,"offline"));return;}adoptions++;callback.onResult(null);}
        public void ack(TvRepository.Callback<Void> callback){acks++;if(failAck)callback.onError(new Failure(Failure.Code.NETWORK,"offline"));else callback.onResult(null);}
        public void cancel(){cancels++;}
    }
    @Test public void lateStartResponseAfterCancellationIsCancelledWithoutExposure(){
        final java.util.concurrent.atomic.AtomicReference<TvRepository.Callback<DeviceLogin.Attempt>> request=new java.util.concurrent.atomic.AtomicReference<>();
        DeviceLoginController delayed=new DeviceLoginController(request::set,clock,new DeviceLoginController.Listener(){public void changed(DeviceLogin.ViewState value){}public void adopted(){fail("late response must not sign in");}});
        delayed.start();delayed.cancel();Attempt late=new Attempt();request.get().onResult(late);assertEquals(1,late.cancels);assertEquals(0,late.polls);
    }
    @Test public void ackFailureRetriesAfterAdoptionWithoutAnotherRedemption(){controller.start();Attempt a=attempts.get(0);a.failAck=true;clock.advance(2000);a.reply("authorized",2);assertEquals(1,signedIn);controller.pause();a.failAck=false;clock.advance(4000);assertEquals(2,a.acks);assertEquals(1,a.polls);assertEquals(1,a.adoptions);assertEquals(0,a.cancels);}
    @Test public void waitsTwoSecondsAndNeverOverlapsPolls(){controller.start();Attempt a=attempts.get(0);clock.advance(1999);assertEquals(0,a.polls);clock.advance(1);assertEquals(1,a.polls);clock.advance(10000);assertEquals(1,a.polls);a.reply("pending",2);clock.advance(1999);assertEquals(1,a.polls);clock.advance(1);assertEquals(2,a.polls);}
    @Test public void countdownZeroStillAllowsApprovedDeliveryGrace(){controller.start();Attempt a=attempts.get(0);clock.advance(179000);assertEquals(1,a.polls);a.reply("pending",2);clock.advance(2000);assertEquals(0,state.remainingSeconds);assertEquals(2,a.polls);a.reply("authorized",2);assertEquals(1,signedIn);assertEquals(1,a.adoptions);assertEquals(1,a.acks);}
    @Test public void stopsAfterBoundedGraceWithoutAutomaticRenewal(){controller.start();Attempt a=attempts.get(0);clock.advance(240000);assertEquals(0,a.polls);assertEquals("expired",state.status);assertEquals(1,attempts.size());assertEquals(1,a.cancels);}
    @Test public void cancellationAndReplacementIgnoreLateAuthorizedResponse(){controller.start();Attempt old=attempts.get(0);clock.advance(2000);controller.start();assertEquals(1,old.cancels);old.reply("authorized",2);assertEquals(0,old.adoptions);assertEquals(0,signedIn);assertEquals(2,attempts.size());}
    @Test public void backgroundCancellationPreventsLateTokenAdoption(){controller.start();Attempt a=attempts.get(0);clock.advance(2000);controller.pause();a.reply("authorized",2);assertEquals(0,signedIn);assertEquals(0,a.adoptions);assertEquals(1,a.cancels);clock.advance(10000);assertEquals(1,a.polls);}
    @Test public void normalNavigationAfterAdoptionDoesNotCancelDelivery(){controller.start();Attempt a=attempts.get(0);clock.advance(2000);a.reply("authorized",2);controller.pause();controller.cancel();assertEquals(0,a.cancels);assertEquals(1,signedIn);}
    @Test public void transientNetworkAndSlowDownHonorBackoffOnSameChallenge(){controller.start();Attempt a=attempts.get(0);clock.advance(2000);a.network();clock.advance(3999);assertEquals(1,a.polls);clock.advance(1);assertEquals(2,a.polls);a.reply("slow_down",9);clock.advance(8999);assertEquals(2,a.polls);clock.advance(1);assertEquals(3,a.polls);assertEquals(1,attempts.size());}
    @Test public void deniedIsTerminalUntilExplicitRenewal(){controller.start();Attempt a=attempts.get(0);clock.advance(2000);a.reply("denied",2);clock.advance(10000);assertEquals(1,a.polls);assertEquals("denied",state.status);assertEquals(1,attempts.size());controller.start();assertEquals(2,attempts.size());}
    @Test public void transientAdoptionNetworkFailureRetriesSameAuthorizedChallenge(){controller.start();Attempt a=attempts.get(0);a.failAdoptionNetwork=true;clock.advance(2000);a.reply("authorized",2);assertEquals(0,signedIn);a.failAdoptionNetwork=false;clock.advance(4000);a.reply("authorized",2);assertEquals(1,signedIn);assertEquals(1,attempts.size());}
    @Test public void localStorageFailureStopsApprovedChallengeWithoutRepollingOrAcknowledgement()throws Exception{
        controller.start();Attempt a=attempts.get(0);a.storageFailure=storageFailure("G03");clock.advance(2000);a.reply("authorized",2);
        assertEquals("storage",state.status);assertEquals("G03",state.storageCode);assertEquals(0,signedIn);assertEquals(0,a.adoptions);assertEquals(0,a.acks);assertEquals(1,a.cancels);
        clock.advance(30000);assertEquals("Local storage failure must not consume more token polls",1,a.polls);assertEquals(1,attempts.size());
        controller.start();assertEquals(2,attempts.size());assertEquals("pending",state.status);assertEquals("",state.storageCode);
    }
    @Test public void storageDiagnosticExposesOnlyTheBoundedCode()throws Exception{
        controller.start();Attempt a=attempts.get(0);a.storageFailure=storageFailure("private-fixture-token");clock.advance(2000);a.reply("authorized",2);
        assertEquals("storage",state.status);assertEquals("",state.storageCode);assertEquals(0,signedIn);assertEquals(0,a.acks);assertEquals(1,a.cancels);
    }
    private static Failure storageFailure(String code)throws Exception{
        return new Failure(Failure.Code.STORAGE,"Private fixture details must not reach the pairing screen",code);
    }
}
