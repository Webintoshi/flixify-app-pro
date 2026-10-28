package vip.flixify.tv;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

/** One preloaded cue for each distinct scoped poster; never queues a delayed navigation sound. */
final class PosterFocusSound implements AutoCloseable {
    interface Output { int play(); void stop(); void close(); }
    interface OutputFactory { Output create(Context context); }
    private static OutputFactory testFactory;
    private final Output output;
    private String lastScope,lastKey;
    private boolean active,closed;

    static void setOutputFactoryForTests(OutputFactory factory) {
        if(!BuildConfig.DEBUG)throw new SecurityException("Test injection is disabled");
        testFactory=factory;
    }
    static PosterFocusSound create(Context context) {
        Output value;
        try { value=testFactory==null?new NativeOutput(context):testFactory.create(context); }
        catch(RuntimeException failure) { value=new Output(){public int play(){return 0;}public void stop(){}public void close(){}}; }
        return new PosterFocusSound(value);
    }
    PosterFocusSound(Output output) { this.output=output; }
    void resume() { if(!closed)active=true; }
    void pause() { if(closed)return;active=false;try {output.stop();}catch(RuntimeException ignored){} }
    void leftPosters() {lastScope=null;lastKey=null;}
    void focused(String scope,String key) {
        if(!active || closed || scope==null || scope.isEmpty() || key==null || key.isEmpty())return;
        if(scope.equals(lastScope) && key.equals(lastKey))return;
        lastScope=scope;lastKey=key;
        try {output.play();}catch(RuntimeException ignored){ /* Audio failure cannot break browsing. */ }
    }
    @Override public void close() {
        if(closed)return;closed=true;active=false;
        try {output.close();}catch(RuntimeException ignored){}
    }
    static final class NativeOutput implements Output {
        private final SoundPool pool;
        private int sample;
        private boolean ready,released;
        private int stream;
        NativeOutput(Context context) {
            pool=new SoundPool.Builder().setMaxStreams(1).setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
            try {
                pool.setOnLoadCompleteListener((owner,id,status)->{
                    if(!released && owner==pool && id==sample)ready=status==0;
                });
                sample=pool.load(context,R.raw.poster_move,1);
            } catch(RuntimeException failure) {
                released=true;
                try {pool.setOnLoadCompleteListener(null);}finally {pool.release();}
                throw failure;
            }
        }
        boolean ready() {return ready && !released;}
        @Override public int play() {
            if(!ready())return 0;
            if(stream!=0)pool.stop(stream);
            stream=pool.play(sample,0.85f,0.85f,1,0,1f);
            return stream;
        }
        @Override public void stop() {if(!released && stream!=0){pool.stop(stream);stream=0;}}
        @Override public void close() {
            if(released)return;
            try {stop();}finally {
                released=true;ready=false;
                try {pool.setOnLoadCompleteListener(null);}finally {pool.release();}
            }
        }
    }
}
