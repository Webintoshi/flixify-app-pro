package vip.flixify.tv;

import java.util.Locale;

public final class TrialCountdown {
    public final String status;
    public final long serverNowMs,endsAtMs,receivedAtMs;
    private TrialCountdown(String status,long serverNowMs,long endsAtMs,long receivedAtMs){this.status=status;this.serverNowMs=serverNowMs;this.endsAtMs=endsAtMs;this.receivedAtMs=receivedAtMs;}
    public static TrialCountdown none(){return new TrialCountdown("none",0,0,0);}
    public static TrialCountdown fromServer(String status,long serverNowMs,long endsAtMs,long receivedAtMs){
        if(!"active".equals(status)&&!"pending".equals(status)&&!"expired".equals(status)&&!"unavailable".equals(status))return none();
        if(serverNowMs<=0 || receivedAtMs<0 || ("active".equals(status)||"expired".equals(status))&&endsAtMs<=0)return new TrialCountdown("unavailable",0,0,0);
        return new TrialCountdown(status,serverNowMs,endsAtMs,receivedAtMs);
    }
    public long remainingMillis(long monotonicNowMs){
        if(!"active".equals(status))return 0;
        long initial=Math.max(0,endsAtMs-serverNowMs),elapsed=Math.max(0,monotonicNowMs-receivedAtMs);
        return Math.max(0,initial-elapsed);
    }
    public boolean visible(){return !"none".equals(status);}
    public String label(long monotonicNowMs){
        if("none".equals(status))return "";
        if("pending".equals(status))return "Deneme hazırlanıyor";
        if("unavailable".equals(status))return "Deneme süresi doğrulanıyor";
        long remaining=remainingMillis(monotonicNowMs);if(remaining==0)return "Deneme süren doldu";
        long seconds=remaining/1000+(remaining%1000==0?0:1);
        return String.format(Locale.US,"Deneme süren · %02d:%02d:%02d",seconds/3600,seconds/60%60,seconds%60);
    }
}
