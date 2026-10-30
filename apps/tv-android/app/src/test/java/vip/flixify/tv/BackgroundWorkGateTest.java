package vip.flixify.tv;

import org.junit.Test;
import static org.junit.Assert.*;

public class BackgroundWorkGateTest {
    @Test public void duplicateLifecycleEntryCannotLeaveTheGateStuck() {
        Object owner=new Object();
        try {
            assertFalse(BackgroundWorkGate.isPlaybackActive());
            BackgroundWorkGate.beginPlayback(owner);
            BackgroundWorkGate.beginPlayback(owner);
            assertTrue(BackgroundWorkGate.isPlaybackActive());
            BackgroundWorkGate.endPlayback(owner);
            assertFalse(BackgroundWorkGate.isPlaybackActive());
        } finally {BackgroundWorkGate.endPlayback(owner);}
    }

    @Test public void StoppingOnePlayerDoesNotUnblockWorkUnderAnotherPlayer() {
        Object first=new Object(),second=new Object();
        try {
            BackgroundWorkGate.beginPlayback(first);BackgroundWorkGate.beginPlayback(second);
            BackgroundWorkGate.endPlayback(first);
            assertTrue(BackgroundWorkGate.isPlaybackActive());
            BackgroundWorkGate.endPlayback(new Object());
            assertTrue(BackgroundWorkGate.isPlaybackActive());
            BackgroundWorkGate.endPlayback(second);
            assertFalse(BackgroundWorkGate.isPlaybackActive());
        } finally {BackgroundWorkGate.endPlayback(first);BackgroundWorkGate.endPlayback(second);}
    }

    @Test public void ownersAreComparedByIdentityAndNullCannotHoldTheGate() {
        Object first=new String("same"),second=new String("same");
        try {
            BackgroundWorkGate.beginPlayback(null);
            assertFalse(BackgroundWorkGate.isPlaybackActive());
            BackgroundWorkGate.beginPlayback(first);BackgroundWorkGate.beginPlayback(second);
            BackgroundWorkGate.endPlayback(first);
            assertTrue(BackgroundWorkGate.isPlaybackActive());
            BackgroundWorkGate.endPlayback(second);BackgroundWorkGate.endPlayback(null);
            assertFalse(BackgroundWorkGate.isPlaybackActive());
        } finally {BackgroundWorkGate.endPlayback(first);BackgroundWorkGate.endPlayback(second);}
    }
}
