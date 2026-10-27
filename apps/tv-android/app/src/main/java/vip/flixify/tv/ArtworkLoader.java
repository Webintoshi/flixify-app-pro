package vip.flixify.tv;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

/** Lazy, bounded artwork work; view recycling never attaches a previous poster to a new item. */
final class ArtworkLoader implements AutoCloseable {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor pool=new ThreadPoolExecutor(2,2,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
    private final LruCache<String,Bitmap> cache=new LruCache<String,Bitmap>(8*1024*1024) {
        @Override protected int sizeOf(String key,Bitmap value) { return value.getAllocationByteCount(); }
    };
    private volatile boolean closed;
    void load(ImageView view,String address) {
        view.setImageDrawable(null); Object ticket=new Object(); view.setTag(ticket);
        if(closed || address==null || address.isEmpty() || !safe(address))return;
        Bitmap hit=cache.get(address); if(hit!=null) { view.setImageBitmap(hit); return; }
        try { pool.execute(()->{
            Bitmap image=fetch(address); if(image==null || closed)return;
            cache.put(address,image);
            main.post(()->{if(!closed && view.getTag()==ticket)view.setImageBitmap(image);});
        }); } catch(RejectedExecutionException ignored) { /* Existing placeholders remain usable during fast scrolling. */ }
    }
    void unbind(ImageView view) { view.setTag(null); view.setImageDrawable(null); }
    private boolean safe(String address) {
        try { URI uri=new URI(address); return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost()!=null && uri.getUserInfo()==null && uri.getFragment()==null; }
        catch(Exception ignored) { return false; }
    }
    private Bitmap fetch(String address) {
        HttpURLConnection connection=null;
        try {
            connection=(HttpURLConnection)new URI(address).toURL().openConnection();
            connection.setConnectTimeout(6000); connection.setReadTimeout(6000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept","image/*"); connection.setUseCaches(false);
            if(connection.getResponseCode()!=200 || connection.getContentLength()>2*1024*1024)return null;
            String mime=connection.getContentType(); if(mime==null || !mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/"))return null;
            ByteArrayOutputStream bytes=new ByteArrayOutputStream(); byte[] buffer=new byte[8192];
            try(InputStream input=connection.getInputStream()) {
                int n; while((n=input.read(buffer))!=-1) { if(closed || Thread.currentThread().isInterrupted() || bytes.size()+n>2*1024*1024)return null; bytes.write(buffer,0,n); }
            }
            byte[] data=bytes.toByteArray(); BitmapFactory.Options options=new BitmapFactory.Options(); options.inJustDecodeBounds=true;
            BitmapFactory.decodeByteArray(data,0,data.length,options);
            if(options.outWidth<=0 || options.outHeight<=0 || options.outWidth>16000 || options.outHeight>16000)return null;
            options.inSampleSize=1; while(options.outWidth/options.inSampleSize>512 || options.outHeight/options.inSampleSize>768)options.inSampleSize*=2;
            options.inJustDecodeBounds=false; options.inPreferredConfig=Bitmap.Config.RGB_565;
            return BitmapFactory.decodeByteArray(data,0,data.length,options);
        } catch(Exception ignored) { return null; } finally { if(connection!=null)connection.disconnect(); }
    }
    @Override public void close() { closed=true; pool.shutdownNow(); main.removeCallbacksAndMessages(null); cache.evictAll(); }
}
