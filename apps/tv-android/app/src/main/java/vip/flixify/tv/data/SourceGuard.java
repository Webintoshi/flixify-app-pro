package vip.flixify.tv.data;

/** The verified deadline can change without changing identity; source changes invalidate all leases. */
final class SourceGuard {
    private long generation;
    private ProviderParser.Bootstrap current;
    synchronized long install(ProviderParser.Bootstrap incoming) {
        if (!incoming.sameIdentity(current)) generation++;
        current=incoming; return generation;
    }
    synchronized long generation() { return generation; }
    synchronized boolean active(long lease,String scope,long now) {
        return current!=null && lease==generation && current.scope().equals(scope) && now<current.expiresAtMs;
    }
    synchronized ProviderParser.Bootstrap current() { return current; }
    synchronized void clear() { current=null; generation++; }
}
