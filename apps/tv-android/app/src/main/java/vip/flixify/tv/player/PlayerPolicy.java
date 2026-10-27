package vip.flixify.tv.player;

import vip.flixify.tv.TvModels.Failure;

public final class PlayerPolicy {
    private final String expectedScope;
    private long expiresAtMs;
    private boolean stopped;
    private int recoveryCount;
    public PlayerPolicy(String scope) { expectedScope = scope == null ? "" : scope; }
    public boolean admit(String scope, long expiresAtMs, long now) {
        if (stopped || !sameScope(scope) || expiresAtMs <= now) { stop(); return false; }
        this.expiresAtMs = expiresAtMs;
        return true;
    }
    public boolean allows(long now, String scope) {
        if (stopped || !sameScope(scope) || now >= expiresAtMs) { stop(); return false; }
        return true;
    }
    public boolean refresh(boolean canPlay, String scope, long expiresAtMs, long now) {
        if (!canPlay) { stop(); return false; }
        return admit(scope, expiresAtMs, now);
    }
    public boolean refreshFailure(Failure.Code code, long now, String scope) {
        if (code != Failure.Code.NETWORK) { stop(); return false; }
        return allows(now, scope);
    }
    public boolean claimRecovery(long now, String scope) {
        if (!allows(now, scope) || recoveryCount >= 2) return false;
        recoveryCount++;
        return true;
    }
    public void stop() { stopped = true; }
    private boolean sameScope(String scope) { return !expectedScope.isEmpty() && expectedScope.equals(scope); }
    public static boolean nearEnd(long positionMs, long durationMs) {
        return durationMs > 0 && positionMs >= durationMs - Math.min(120000L, durationMs / 20L);
    }
}
