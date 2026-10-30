package vip.flixify.tv;

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
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

/** Lazy scoped artwork; recycling, logout and close retire both display and cache writes. */
final class ArtworkLoader implements AutoCloseable {
    interface ConnectionFactory {HttpURLConnection open(String address) throws Exception;}
    private static final class Ticket {final long generation;volatile boolean cancelled;Ticket(long generation){this.generation=generation;}}
    private static final class Cached {
        final Bitmap bitmap;final long expiresAt;
        Cached(Bitmap bitmap,long expiresAt){this.bitmap=bitmap;this.expiresAt=expiresAt;}
    }
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor pool=new ThreadPoolExecutor(2,2,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
    private final LruCache<String,Cached> cache=new LruCache<String,Cached>(8*1024*1024) {
        @Override protected int sizeOf(String key,Cached value) {return value.bitmap.getAllocationByteCount();}
    };
    private final ArtworkDiskCache disk;
    private final ConnectionFactory connections;
    private final Set<HttpURLConnection> active=Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Object lifecycle=new Object();
    private volatile long generation;
    private volatile boolean closed;

    ArtworkLoader(Context context) {this(context,new ArtworkDiskCache(new File(context.getApplicationContext().getCacheDir(),"artwork-v1")),address->(HttpURLConnection)new URI(address).toURL().openConnection());}
    ArtworkLoader(Context context,ArtworkDiskCache disk,ConnectionFactory connections) {this.disk=disk;this.connections=connections;}
    void load(ImageView view,String address,String scope) {
        retire(view);view.setImageDrawable(null);Ticket ticket=new Ticket(generation);view.setTag(ticket);
        if(closed || !safe(address))return;
        String key=ArtworkDiskCache.key(scope,address);if(key==null)return;
        Cached hit=cache.get(key);
        if(hit!=null && hit.expiresAt>System.currentTimeMillis()) {view.setImageBitmap(hit.bitmap);return;}
        if(hit!=null)cache.remove(key);
        try {pool.execute(()->load(view,address,scope,key,ticket));}
        catch(RejectedExecutionException ignored) {ticket.cancelled=true;}
    }
    private void load(ImageView view,String address,String scope,String key,Ticket ticket) {
        if(!valid(ticket))return;
        ArtworkDiskCache.Entry stored=disk.readEntry(scope,address);
        if(!valid(ticket))return;
        Bitmap image=stored==null?null:decode(stored.bytes);
        long expiresAt=stored==null?0:stored.expiresAt;
        if(stored!=null && image==null)disk.remove(scope,address);
        if(image==null) {
            ArtworkDiskCache.Allowed allowed=()->valid(ticket) && !BackgroundWorkGate.isPlaybackActive();
            if(!allowed.getAsBoolean())return;
            byte[] bytes=fetch(address,allowed);
            if(bytes==null || !allowed.getAsBoolean())return;
            image=decode(bytes);
            if(image==null || !allowed.getAsBoolean())return;
            disk.write(scope,address,bytes,allowed);
            expiresAt=System.currentTimeMillis()+ArtworkDiskCache.TTL_MS;
        }
        Bitmap result=image;
        synchronized(lifecycle) {if(!valid(ticket))return;cache.put(key,new Cached(result,expiresAt));}
        main.post(()->{if(valid(ticket) && view.getTag()==ticket)view.setImageBitmap(result);});
    }
    void unbind(ImageView view) {retire(view);view.setTag(null);view.setImageDrawable(null);}
    private void retire(ImageView view) {Object previous=view.getTag();if(previous instanceof Ticket)((Ticket)previous).cancelled=true;}
    private boolean valid(Ticket ticket) {return !closed && !ticket.cancelled && ticket.generation==generation && !Thread.currentThread().isInterrupted();}
    private static boolean safe(String address) {
        if(address==null || address.isEmpty())return false;
        try {URI uri=new URI(address);return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost()!=null && uri.getUserInfo()==null && uri.getFragment()==null;}
        catch(Exception ignored) {return false;}
    }
    private byte[] fetch(String address,ArtworkDiskCache.Allowed allowed) {
        HttpURLConnection connection=null;
        try {
            if(!allowed.getAsBoolean())return null;
            connection=connections.open(address);active.add(connection);
            if(!allowed.getAsBoolean())return null;
            connection.setConnectTimeout(6000);connection.setReadTimeout(6000);connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept","image/*");connection.setUseCaches(false);
            if(connection.getResponseCode()!=200 || !allowed.getAsBoolean() || connection.getContentLength()>ArtworkDiskCache.MAX_RESPONSE)return null;
            String mime=connection.getContentType();if(mime==null || !mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/"))return null;
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];
            try(InputStream input=connection.getInputStream()) {
                int n;while((n=input.read(buffer))!=-1) {if(!allowed.getAsBoolean() || bytes.size()+n>ArtworkDiskCache.MAX_RESPONSE)return null;bytes.write(buffer,0,n);}
            }
            return allowed.getAsBoolean()?bytes.toByteArray():null;
        } catch(Exception ignored) {return null;}
        finally {if(connection!=null){active.remove(connection);connection.disconnect();}}
    }
    private static Bitmap decode(byte[] data) {
        try {
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
            BitmapFactory.decodeByteArray(data,0,data.length,options);
            if(options.outWidth<=0 || options.outHeight<=0 || options.outWidth>16000 || options.outHeight>16000)return null;
            options.inSampleSize=1;while(options.outWidth/options.inSampleSize>512 || options.outHeight/options.inSampleSize>768)options.inSampleSize*=2;
            options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.RGB_565;
            return BitmapFactory.decodeByteArray(data,0,data.length,options);
        } catch(Exception ignored) {return null;}
    }
    void clear() {
        synchronized(lifecycle) {generation++;cache.evictAll();}
        for(HttpURLConnection connection:active)connection.disconnect();
        main.removeCallbacksAndMessages(null);disk.clear();
    }
    @Override public void close() {
        synchronized(lifecycle) {closed=true;generation++;cache.evictAll();}
        pool.shutdownNow();for(HttpURLConnection connection:active)connection.disconnect();main.removeCallbacksAndMessages(null);disk.finishWrites();
    }
}
