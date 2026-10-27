package vip.flixify.tv.player;

import vip.flixify.tv.TvModels.Failure;

/** Plain Java executable as well as a JUnit delegate: never opens media or a network connection. */
public final class PlayerPolicyChecks {
    private static void check(boolean value, String reason) {
        if (!value) throw new AssertionError(reason);
    }
    public static void main(String[] args) { runAll(); System.out.println("PlayerPolicyChecks: 19 assertions passed"); }
    public static void runAll() {
        PlayerPolicy p = new PlayerPolicy("account:source1");
        check(p.admit("account:source1", 1000, 100), "fresh access must start");
        check(p.allows(999, "account:source1"), "access valid before absolute cutoff");
        check(!p.allows(1000, "account:source1"), "cutoff must be absolute and inclusive");
        p = new PlayerPolicy("account:source1"); p.admit("account:source1", 1000, 100);
        check(p.refresh(true, "account:source1", 5000, 200), "confirmed extension applies without restarting policy");
        check(p.allows(1001, "account:source1"), "confirmed extension replaces old cutoff");
        check(p.refresh(true, "account:source1", 1200, 300), "shortened expiry applies immediately");
        check(!p.allows(1200, "account:source1"), "shortened expiry cannot retain old access");
        p = new PlayerPolicy("account:source1"); p.admit("account:source1", 1000, 100);
        check(p.refreshFailure(Failure.Code.NETWORK, 999, "account:source1"), "network outage preserves existing cutoff");
        check(!p.refreshFailure(Failure.Code.NETWORK, 1000, "account:source1"), "outage never extends cutoff");
        for (Failure.Code code : new Failure.Code[] {Failure.Code.AUTH, Failure.Code.INELIGIBLE, Failure.Code.STALE}) {
            p = new PlayerPolicy("account:source1"); p.admit("account:source1", 1000, 100);
            check(!p.refreshFailure(code, 200, "account:source1") && !p.allows(201, "account:source1"), "authoritative denial must latch: " + code);
        }
        p = new PlayerPolicy("account:source1"); p.admit("account:source1", 1000, 100);
        check(!p.allows(200, "account:source2"), "source switch must stop old playback");
        p = new PlayerPolicy("account:source1"); p.admit("account:source1", 1000, 100);
        check(p.claimRecovery(200, "account:source1") && p.claimRecovery(300, "account:source1"), "two silent retries allowed");
        check(!p.claimRecovery(400, "account:source1"), "recovery budget is bounded per selection");
        p.stop(); check(!p.admit("account:source1", 9000, 500), "late result cannot revive stopped playback");
        check(!PlayerPolicy.nearEnd(10000, 100000), "opening minutes cannot mark episode watched");
        check(PlayerPolicy.nearEnd(95000, 100000), "95 percent near end qualifies");
        check(!PlayerPolicy.nearEnd(1, -1), "unknown duration never marks watched");
    }
}
