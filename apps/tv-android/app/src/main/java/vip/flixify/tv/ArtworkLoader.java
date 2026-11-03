package vip.flixify.tv;

import android.app.ActivityManager;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

/** Scoped artwork jobs belong to their visible subscribers, not to a discarded screen. */
final class ArtworkLoader implements AutoCloseable {
    interface ConnectionFactory {HttpURLConnection open(String address) throws Exception;}
    interface Decoder {Bitmap decode(byte[] data,int width,int height);}
    private static final class Ticket {
        final long generation;final WeakReference<ImageView> view;volatile boolean cancelled;Job job;
        Ticket(long generation,ImageView view){this.generation=generation;this.view=new WeakReference<>(view);}
    }
    private static final class Cached {
        final Bitmap bitmap;final long expiresAt;
        Cached(Bitmap bitmap,long expiresAt){this.bitmap=bitmap;this.expiresAt=expiresAt;}
    }
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor pool=new ThreadPoolExecutor(2,2,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
    private final ThreadPoolExecutor cleanup=new ThreadPoolExecutor(1,1,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(1));
    private final LruCache<String,Cached> cache;
    private final ArtworkDiskCache disk;
    private final ConnectionFactory connections;
    private final Decoder decoder;
    private final int memoryBudget,imageWidth,imageHeight;
    private final Object lifecycle=new Object(),cleanupLock=new Object();
    private final Map<String,Job> jobs=new HashMap<>();
    private final Set<HttpURLConnection> retiredConnections=new HashSet<>();
    private boolean cleanupRunning,clearDisk,finishDisk;
    private volatile boolean diskClearPending;
    private volatile long generation;
    private volatile boolean closed;

    ArtworkLoader(Context context) {this(context,new ArtworkDiskCache(new File(context.getApplicationContext().getCacheDir(),"artwork-v1")),address->(HttpURLConnection)new URI(address).toURL().openConnection());}
    ArtworkLoader(Context context,ArtworkDiskCache disk,ConnectionFactory connections) {this(context,disk,connections,ArtworkLoader::decodeBitmap);}
    ArtworkLoader(Context context,ArtworkDiskCache disk,ConnectionFactory connections,Decoder decoder) {
        this.disk=disk;this.connections=connections;this.decoder=decoder;
        ActivityManager manager=(ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE);
        int heap=manager==null?128:Math.max(32,manager.getMemoryClass());boolean low=manager!=null && manager.isLowRamDevice();
        memoryBudget=(int)Math.min(8L*1024*1024,Math.max(2L*1024*1024,heap*1024L*1024/(low?32:16)));
        imageWidth=low || heap<128?256:512;imageHeight=low || heap<128?384:768;
        cache=new LruCache<String,Cached>(memoryBudget) {@Override protected int sizeOf(String key,Cached value){return value.bitmap.getAllocationByteCount();}};
        pool.allowCoreThreadTimeOut(true);cleanup.allowCoreThreadTimeOut(true);
    }
    void load(ImageView view,String address,String scope) {
        retire(view);view.setImageDrawable(null);Ticket ticket=new Ticket(generation,view);view.setTag(ticket);
        if(closed || !safe(address))return;
        String key=ArtworkDiskCache.key(scope,address);if(key==null)return;
        Cached hit=cache.get(key);
        if(hit!=null && hit.expiresAt>System.currentTimeMillis()){view.setImageBitmap(hit.bitmap);return;}
        if(hit!=null)cache.remove(key);
        final Job job;
        synchronized(lifecycle) {
            if(!valid(ticket))return;
            Job pending=jobs.get(key);
            if(pending!=null && valid(pending)){ticket.job=pending;pending.tickets.add(ticket);return;}
            job=new Job(key,address,scope,ticket.generation);ticket.job=job;job.tickets.add(ticket);jobs.put(key,job);
        }
        try {pool.execute(job.task);}
        catch(RejectedExecutionException ignored){cancel(job);}
    }
    private final class Job implements Runnable {
        final String key,address,scope;final long generation;final List<Ticket> tickets=new ArrayList<>();
        final FutureTask<Void> task;volatile boolean cancelled;volatile HttpURLConnection connection;
        Job(String key,String address,String scope,long generation){this.key=key;this.address=address;this.scope=scope;this.generation=generation;task=new FutureTask<>(this,null);}
        public void run() {
            try {
                if(!valid(this))return;
                ArtworkDiskCache.Entry stored=disk.readEntry(scope,address);
                if(!valid(this))return;
                Bitmap image=stored==null?null:decode(stored.bytes);long expiresAt=stored==null?0:stored.expiresAt;byte[] persistence=null;
                if(stored!=null && image==null)disk.remove(scope,address);
                if(image==null) {
                    ArtworkDiskCache.Allowed allowed=()->valid(this) && !BackgroundWorkGate.isPlaybackActive();
                    if(!allowed.getAsBoolean())return;
                    byte[] bytes=fetch(this,allowed);if(bytes==null || !allowed.getAsBoolean())return;
                    image=decode(bytes);if(image==null || !allowed.getAsBoolean())return;
                    persistence=bytes;
                    expiresAt=System.currentTimeMillis()+ArtworkDiskCache.TTL_MS;
                }
                final Bitmap result=image;final List<Ticket> recipients;
                synchronized(lifecycle) {
                    if(!valid(this))return;cache.put(key,new Cached(result,expiresAt));
                    if(jobs.get(key)==this)jobs.remove(key);
                    recipients=new ArrayList<>(tickets);
                }
                main.post(()->{for(Ticket ticket:recipients){ImageView view=ticket.view.get();if(valid(ticket) && view!=null && view.getTag()==ticket)view.setImageBitmap(result);}});
                if(persistence!=null)disk.writeLater(scope,address,persistence,()->valid(this) && hasSubscribers(recipients) && !BackgroundWorkGate.isPlaybackActive() && !diskClearPending);
            } finally {
                synchronized(lifecycle){if(jobs.get(key)==this)jobs.remove(key);for(Ticket ticket:tickets)ticket.job=null;tickets.clear();}
            }
        }
    }
    void unbind(ImageView view){retire(view);view.setTag(null);view.setImageDrawable(null);}
    private void retire(ImageView view) {
        Object previous=view.getTag();if(!(previous instanceof Ticket))return;
        Ticket ticket=(Ticket)previous;Job orphan=null;
        synchronized(lifecycle){ticket.cancelled=true;Job job=ticket.job;if(job!=null){job.tickets.remove(ticket);ticket.job=null;if(job.tickets.isEmpty())orphan=job;}}
        if(orphan!=null)cancel(orphan);
    }
    private boolean valid(Ticket ticket){return !closed && !ticket.cancelled && ticket.generation==generation;}
    private boolean valid(Job job){return !closed && !job.cancelled && job.generation==generation && !Thread.currentThread().isInterrupted();}
    private boolean hasSubscribers(List<Ticket> tickets) {
        for(Ticket ticket:tickets)if(valid(ticket) && ticket.view.get()!=null)return true;
        return false;
    }
    private void cancel(Job job) {
        synchronized(lifecycle){job.cancelled=true;if(jobs.get(job.key)==job)jobs.remove(job.key);for(Ticket ticket:job.tickets){ticket.cancelled=true;ticket.job=null;}job.tickets.clear();}
        job.task.cancel(true);pool.remove(job.task);requestCleanup(job.connection,false,false);
    }
    void retireScreen() {
        final List<Job> retired;
        synchronized(lifecycle){generation++;retired=new ArrayList<>(jobs.values());jobs.clear();}
        for(Job job:retired)cancel(job);
        main.removeCallbacksAndMessages(null);
    }
    void trimMemory(int level) {
        if(level>=ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL){retireScreen();cache.evictAll();}
        else if(level>=ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)cache.trimToSize(memoryBudget/2);
    }
    private static boolean safe(String address) {
        if(address==null || address.isEmpty())return false;
        try{URI uri=new URI(address);return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost()!=null && uri.getUserInfo()==null && uri.getFragment()==null;}
        catch(Exception ignored){return false;}
    }
    private byte[] fetch(Job job,ArtworkDiskCache.Allowed allowed) {
        HttpURLConnection connection=null;
        try {
            if(!allowed.getAsBoolean())return null;
            connection=connections.open(job.address);job.connection=connection;
            if(!allowed.getAsBoolean())return null;
            connection.setConnectTimeout(6000);connection.setReadTimeout(6000);connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept","image/*");connection.setUseCaches(false);
            if(connection.getResponseCode()!=200 || !allowed.getAsBoolean() || connection.getContentLength()>ArtworkDiskCache.MAX_RESPONSE)return null;
            String mime=connection.getContentType();if(mime==null || !mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/"))return null;
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];
            try(InputStream input=connection.getInputStream()) {
                int n;while((n=input.read(buffer))!=-1){if(!allowed.getAsBoolean() || bytes.size()+n>ArtworkDiskCache.MAX_RESPONSE)return null;bytes.write(buffer,0,n);}
            }
            return allowed.getAsBoolean()?bytes.toByteArray():null;
        } catch(Exception ignored){return null;}
        finally{job.connection=null;if(connection!=null)try{connection.disconnect();}catch(Exception ignored){}}
    }
    private Bitmap decode(byte[] data) {
        try{return decoder.decode(data,imageWidth,imageHeight);}
        catch(OutOfMemoryError allocation){cache.evictAll();try{return decoder.decode(data,Math.max(64,imageWidth/2),Math.max(96,imageHeight/2));}catch(OutOfMemoryError | RuntimeException exhausted){return null;}}
        catch(RuntimeException invalid){return null;}
    }
    private static Bitmap decodeBitmap(byte[] data,int width,int height) {
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        BitmapFactory.decodeByteArray(data,0,data.length,options);
        if(options.outWidth<=0 || options.outHeight<=0 || options.outWidth>16000 || options.outHeight>16000)return null;
        options.inSampleSize=1;while((options.outWidth+options.inSampleSize-1)/options.inSampleSize>width || (options.outHeight+options.inSampleSize-1)/options.inSampleSize>height)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.RGB_565;
        return BitmapFactory.decodeByteArray(data,0,data.length,options);
    }
    private void requestCleanup(HttpURLConnection connection,boolean clear,boolean finish) {
        synchronized(cleanupLock) {
            if(connection!=null)retiredConnections.add(connection);
            clearDisk|=clear;finishDisk|=finish;if(clear)diskClearPending=true;
            if(cleanupRunning)return;cleanupRunning=true;
            cleanup.execute(this::drainCleanup);
        }
    }
    private void drainCleanup() {
        while(true) {
            final List<HttpURLConnection> connections;final boolean clear,finish;
            synchronized(cleanupLock) {
                if(retiredConnections.isEmpty() && !clearDisk && !finishDisk){cleanupRunning=false;return;}
                connections=new ArrayList<>(retiredConnections);retiredConnections.clear();clear=clearDisk;finish=finishDisk;clearDisk=finishDisk=false;
            }
            for(HttpURLConnection connection:connections)try{connection.disconnect();}catch(Exception ignored){}
            try{if(clear)disk.clear();if(finish)disk.finishWrites();}catch(RuntimeException ignored){}
            synchronized(cleanupLock){diskClearPending=clearDisk;}
        }
    }
    void clear(){retireScreen();cache.evictAll();requestCleanup(null,true,false);}
    @Override public void close(){closed=true;retireScreen();cache.evictAll();pool.shutdownNow();requestCleanup(null,false,true);}
}
