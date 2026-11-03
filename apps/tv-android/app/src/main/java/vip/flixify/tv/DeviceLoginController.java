package vip.flixify.tv;

import vip.flixify.tv.TvModels.Failure;

/** Main-thread coordinator; monotonic time bounds even a wrong device wall clock. */
public final class DeviceLoginController {
    public interface Scheduler {long now();void schedule(Runnable task,long delayMs);void clear();}
    public interface Listener {void changed(DeviceLogin.ViewState state);void adopted();}
    private final DeviceLogin.Gateway gateway;private final Scheduler clock;private final Listener listener;
    private volatile long epoch;private volatile boolean active,adopted;
    private DeviceLogin.Attempt attempt;private DeviceLogin.Display display;
    private long started,nextPoll;private int interval=2,failures,ackTries;private boolean busy;private String status="idle";
    public DeviceLoginController(DeviceLogin.Gateway gateway,Scheduler clock,Listener listener){this.gateway=gateway;this.clock=clock;this.listener=listener;}
    public void start(){
        cancel();adopted=false;active=true;display=null;attempt=null;busy=false;failures=0;ackTries=0;status="starting";
        final long owner=++epoch;emit();
        gateway.start(new TvRepository.Callback<DeviceLogin.Attempt>(){
            public void onResult(DeviceLogin.Attempt value){
                if(!current(owner)){value.cancel();return;}attempt=value;display=value.display();started=clock.now();interval=Math.max(2,display.intervalSeconds);nextPoll=started+interval*1000L;status="pending";tick(owner);
            }
            public void onError(Failure failure){if(!current(owner))return;active=false;status="unavailable";emit();}
        });
    }
    public void pause(){if(adopted)return;cancel();status="paused";emit();}
    public void cancel(){
        if(adopted)return;active=false;epoch++;clock.clear();DeviceLogin.Attempt previous=attempt;attempt=null;busy=false;if(previous!=null)previous.cancel();
    }
    private boolean current(long owner){return active && owner==epoch && !adopted;}
    private long elapsed(){return Math.max(0,clock.now()-started);}
    private void emit(){int seconds=display==null?0:(int)Math.max(0,(display.expiresInSeconds*1000L-elapsed()+999)/1000);listener.changed(new DeviceLogin.ViewState(display,status,seconds));}
    private void tick(long owner){
        if(!current(owner))return;
        if(elapsed()>=(display.expiresInSeconds+60L)*1000L){terminal("expired");return;}
        emit();
        if(!busy && clock.now()>=nextPoll){
            busy=true;DeviceLogin.Attempt selected=attempt;
            selected.poll(new TvRepository.Callback<DeviceLogin.Poll>(){
                public void onResult(DeviceLogin.Poll result){
                    if(!current(owner) || selected!=attempt)return;
                    if(elapsed()>=(display.expiresInSeconds+60L)*1000L){terminal("expired");return;}
                    if("authorized".equals(result.status)){adopt(owner,selected);return;}
                    busy=false;
                    if("pending".equals(result.status) || "slow_down".equals(result.status)){
                        interval=Math.max(2,Math.max(result.intervalSeconds,"slow_down".equals(result.status)?interval+5:interval));failures=0;status=result.status;nextPoll=clock.now()+interval*1000L;emit();
                    }else terminal(result.status);
                }
                public void onError(Failure failure){if(current(owner) && selected==attempt){busy=false;if(failure.code==Failure.Code.NETWORK || failure.code==Failure.Code.LIMIT)retry();else terminal("cancelled");}}
            });
        }
        if(current(owner)){long delay=busy?1000:Math.min(1000,Math.max(1,nextPoll-clock.now()));clock.schedule(()->tick(owner),delay);}
    }
    private void retry(){failures++;status="network";nextPoll=clock.now()+Math.max(interval,Math.min(30,2L<<Math.min(failures,4)))*1000L;emit();}
    private void terminal(String value){DeviceLogin.Attempt previous=attempt;active=false;epoch++;clock.clear();busy=false;status=value;emit();if(previous!=null)previous.cancel();attempt=null;}
    private void adopt(long owner,DeviceLogin.Attempt selected){
        selected.adopt(()->current(owner) && selected==attempt,new TvRepository.Callback<Void>(){
            public void onResult(Void ignored){
                if(!current(owner) || selected!=attempt)return;
                // onStop caused by normal navigation must not cancel a saved login.
                adopted=true;active=false;busy=false;clock.clear();status="complete";emit();ack(selected);listener.adopted();
            }
            public void onError(Failure failure){if(current(owner) && selected==attempt){busy=false;if(failure.code==Failure.Code.NETWORK || failure.code==Failure.Code.LIMIT)retry();else terminal("cancelled");}}
        });
    }
    private void ack(DeviceLogin.Attempt selected){
        ackTries++;selected.ack(new TvRepository.Callback<Void>(){
            public void onResult(Void ignored){clock.clear();}
            public void onError(Failure failure){if(adopted && selected==attempt && ackTries<3)clock.schedule(()->ack(selected),4000);}
        });
    }
}
