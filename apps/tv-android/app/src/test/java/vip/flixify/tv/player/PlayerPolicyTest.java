package vip.flixify.tv.player;

import org.junit.Test;

public final class PlayerPolicyTest {
    @Test public void absoluteCutoffScopeAndBoundedRecovery() { PlayerPolicyChecks.runAll(); }
}
