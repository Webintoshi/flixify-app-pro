package vip.flixify.tv;

import org.junit.Test;
import static org.junit.Assert.*;

public class TrialCountdownTest {
    private static final long SERVER=1794052800000L,START=80000L,THREE_HOURS=10800000L;
    @Test public void threeHoursDecreaseFromTheServerDeadline(){
        TrialCountdown timer=TrialCountdown.fromServer("active",SERVER,SERVER+THREE_HOURS,START);
        assertEquals(THREE_HOURS,timer.remainingMillis(START));assertEquals("Deneme süren · 03:00:00",timer.label(START));
        assertEquals("Deneme süren · 02:59:59",timer.label(START+1000));assertTrue(timer.visible());
    }
    @Test public void aRefreshedSnapshotDoesNotStartAnotherThreeHours(){
        TrialCountdown timer=TrialCountdown.fromServer("active",SERVER+3600000,SERVER+THREE_HOURS,START);
        assertEquals("Deneme süren · 02:00:00",timer.label(START));
        assertEquals("Deneme süren · 01:50:00",timer.label(START+600000));
    }
    @Test public void expiredTrialStopsAtZero(){
        TrialCountdown timer=TrialCountdown.fromServer("active",SERVER,SERVER+1000,START);
        assertEquals(0,timer.remainingMillis(START+2000));assertEquals("Deneme süren doldu",timer.label(START+2000));
        assertEquals("Deneme süren doldu",TrialCountdown.fromServer("expired",SERVER,SERVER-1,START).label(START));
    }
    @Test public void pendingAndUnavailableDoNotInventTime(){
        assertEquals("Deneme hazırlanıyor",TrialCountdown.fromServer("pending",SERVER,0,START).label(START+5000));
        assertEquals("Deneme süresi doğrulanıyor",TrialCountdown.fromServer("active",0,SERVER,START).label(START));
        assertEquals(0,TrialCountdown.fromServer("pending",SERVER,0,START).remainingMillis(START));
    }
    @Test public void paidOrMissingSnapshotDoesNotShowATrialClock(){
        assertFalse(TrialCountdown.none().visible());assertEquals("",TrialCountdown.none().label(START));
        assertFalse(TrialCountdown.fromServer("none",SERVER,SERVER+THREE_HOURS,START).visible());
        assertFalse(TrialCountdown.fromServer("unexpected",SERVER,SERVER+THREE_HOURS,START).visible());
    }
    @Test public void legacyTrialKeepsItsActualLongerDeadline(){
        assertEquals("Deneme süren · 24:00:00",TrialCountdown.fromServer("active",SERVER,SERVER+86400000,START).label(START));
    }
}
