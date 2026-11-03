package vip.flixify.tv;



/** Public pairing presentation and an opaque, memory-only proof owner. */
public final class DeviceLogin {
    private DeviceLogin() {}
    public interface AdoptionGuard {boolean allowed();}
    public interface Gateway {void start(TvRepository.Callback<Attempt> callback);}
    public interface Attempt {
        Display display();
        void poll(TvRepository.Callback<Poll> callback);
        void adopt(DeviceLogin.AdoptionGuard allowed,TvRepository.Callback<Void> callback);
        void ack(TvRepository.Callback<Void> callback);
        void cancel();
    }
    public static final class Display {
        public final String userCode,qrPngBase64;
        public final int expiresInSeconds,intervalSeconds;
        public Display(String code,String png,int expiry,int interval){userCode=code;qrPngBase64=png;expiresInSeconds=expiry;intervalSeconds=interval;}
    }
    public static final class Poll {
        public final String status;public final int intervalSeconds;
        public Poll(String status,int interval){this.status=status;intervalSeconds=interval;}
    }
    public static final class ViewState {
        public final Display display;public final String status;public final int remainingSeconds;
        public ViewState(Display display,String status,int remaining){this.display=display;this.status=status;remainingSeconds=remaining;}
    }
}
