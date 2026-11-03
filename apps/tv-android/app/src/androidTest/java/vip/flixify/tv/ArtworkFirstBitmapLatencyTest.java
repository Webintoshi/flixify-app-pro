package vip.flixify.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.os.SystemClock;
import android.widget.ImageView;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ArtworkFirstBitmapLatencyTest {
    private static final String SCOPE="account:source";
    private static final String FETCHED="https://art.invalid/fetched.png",CACHED="https://art.invalid/cached.png";
    private static final long FIRST_BITMAP_BUDGET_MS=500;
    private Context context;
    private File directory;
    private ArtworkDiskCache disk;
    private ArtworkLoader loader;
    private ImageView image;
    private byte[] red,blue;
    private final SlowWrite slowWrite=new SlowWrite();
    private final AtomicReference<String> unexpectedRequest=new AtomicReference<>();
    private final AtomicInteger requests=new AtomicInteger();

    @Before public void setUp() {
        context=ApplicationProvider.getApplicationContext();
        directory=new File(context.getCacheDir(),"artwork-first-bitmap-"+System.nanoTime());
        disk=new ArtworkDiskCache(directory,64L*1024*1024,ArtworkDiskCache.TTL_MS,0,System::currentTimeMillis,slowWrite::freeSpace);
        red=png(Color.RED);blue=png(Color.BLUE);
        main(()->image=new ImageView(context));
    }
    @After public void tearDown() {
        slowWrite.release.countDown();
        main(()->{if(loader!=null)loader.close();});
        disk.finishWrites();disk.clear();directory.delete();
    }
    private void main(Runnable task) {InstrumentationRegistry.getInstrumentation().runOnMainSync(task);}
    private byte[] png(int color) {
        Bitmap bitmap=Bitmap.createBitmap(24,32,Bitmap.Config.ARGB_8888);bitmap.eraseColor(color);
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,output));bitmap.recycle();return output.toByteArray();
    }
    private void create(ArtworkLoader.Decoder decoder) {
        main(()->loader=new ArtworkLoader(context,disk,address->{
            if(!FETCHED.equals(address)) {unexpectedRequest.set(address);throw new IllegalArgumentException("Unexpected artwork request");}
            requests.incrementAndGet();return new FakeHttpsImage(red);
        },decoder));
    }
    private void create() {create((bytes,width,height)->BitmapFactory.decodeByteArray(bytes,0,bytes.length));}
    private Bitmap bitmap(ImageView target) {
        AtomicReference<Bitmap> result=new AtomicReference<>();
        main(()->{if(target.getDrawable() instanceof BitmapDrawable)result.set(((BitmapDrawable)target.getDrawable()).getBitmap());});return result.get();
    }
    private Bitmap awaitBitmap(ImageView target,long started) {
        Bitmap result;
        do {result=bitmap(target);if(result!=null){assertTrue("First bitmap exceeded 500 ms",SystemClock.uptimeMillis()-started<=FIRST_BITMAP_BUDGET_MS);return result;}SystemClock.sleep(5);}
        while(SystemClock.uptimeMillis()-started<FIRST_BITMAP_BUDGET_MS);
        fail("First bitmap exceeded 500 ms while an optional disk write was held for up to 5000 ms");return null;
    }

    @Test public void decodedBitmapIsVisibleWithin500msWhileItsDiskWriteIsHeld() throws Exception {
        create();slowWrite.armed.set(true);
        long started=SystemClock.uptimeMillis();main(()->loader.load(image,FETCHED,SCOPE));
        assertTrue("Fixture reached the real disk write",slowWrite.entered.await(3,TimeUnit.SECONDS));
        Bitmap result=awaitBitmap(image,started);
        assertEquals(Color.RED,result.getPixel(0,0));
        assertEquals("Disk must remain held when the image becomes visible",1,slowWrite.release.getCount());
        assertEquals(1,requests.get());assertNull(unexpectedRequest.get());
    }

    @Test public void differentCachedArtworkIsVisibleWithin500msDuringASlowWrite() throws Exception {
        assertTrue(disk.write(SCOPE,CACHED,blue,()->true));create();slowWrite.armed.set(true);
        main(()->loader.load(image,FETCHED,SCOPE));
        assertTrue("Fixture reached the real disk write",slowWrite.entered.await(3,TimeUnit.SECONDS));
        ImageView[] cached=new ImageView[1];long started=SystemClock.uptimeMillis();
        main(()->{cached[0]=new ImageView(context);loader.load(cached[0],CACHED,SCOPE);});
        assertEquals(Color.BLUE,awaitBitmap(cached[0],started).getPixel(0,0));
        assertEquals("Unrelated disk read must finish before the write is released",1,slowWrite.release.getCount());
        assertEquals(1,requests.get());assertNull(unexpectedRequest.get());
    }

    @Test public void unbindBeforeDecodedPublicationRejectsTheLateBitmap() throws Exception {rejectLateBitmap(0);}
    @Test public void retiredGenerationBeforeDecodedPublicationRejectsTheLateBitmap() throws Exception {rejectLateBitmap(1);}
    @Test public void logoutClearBeforeDecodedPublicationRejectsTheLateBitmap() throws Exception {rejectLateBitmap(2);}
    @Test public void unbindingLastPublishedSubscriberCancelsItsHeldDeferredWrite() throws Exception {unbindPublishedSubscriber(false);}
    @Test public void unbindingOnePublishedSubscriberKeepsTheOtherSubscribersDeferredWrite() throws Exception {unbindPublishedSubscriber(true);}
    private void unbindPublishedSubscriber(boolean keepSecondSubscriber) throws Exception {
        CountDownLatch decoding=new CountDownLatch(1),releaseDecode=new CountDownLatch(1);
        create((bytes,width,height)->{
            Bitmap result=BitmapFactory.decodeByteArray(bytes,0,bytes.length);decoding.countDown();
            try{releaseDecode.await(5,TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}
            return result;
        });
        ImageView[] second=new ImageView[1];AtomicReference<Object> ticket=new AtomicReference<>();
        try {
            main(()->{
                loader.load(image,FETCHED,SCOPE);ticket.set(image.getTag());
                if(keepSecondSubscriber){second[0]=new ImageView(context);loader.load(second[0],FETCHED,SCOPE);}
            });
            assertTrue(decoding.await(3,TimeUnit.SECONDS));
            Field jobField=ticket.get().getClass().getDeclaredField("job");jobField.setAccessible(true);
            Object job=jobField.get(ticket.get());assertNotNull(job);
            Field taskField=job.getClass().getDeclaredField("task");taskField.setAccessible(true);
            Future<?> task=(Future<?>)taskField.get(job);
            slowWrite.armed.set(true);long published=SystemClock.uptimeMillis();releaseDecode.countDown();
            assertEquals(Color.RED,awaitBitmap(image,published).getPixel(0,0));
            if(keepSecondSubscriber)assertEquals(Color.RED,awaitBitmap(second[0],published).getPixel(0,0));
            assertTrue("Actual deferred write reached the held disk operation",slowWrite.entered.await(3,TimeUnit.SECONDS));
            task.get(3,TimeUnit.SECONDS);
            main(()->loader.unbind(image));assertNull(bitmap(image));
            slowWrite.release.countDown();disk.finishWrites();
            if(keepSecondSubscriber) {
                assertArrayEquals(red,disk.read(SCOPE,FETCHED));assertEquals(Color.RED,bitmap(second[0]).getPixel(0,0));
            } else assertNull("The final published subscriber revoked its deferred persistence",disk.read(SCOPE,FETCHED));
            assertEquals(1,requests.get());assertNull(unexpectedRequest.get());
        } finally {releaseDecode.countDown();slowWrite.release.countDown();}
    }
    private void rejectLateBitmap(int action) throws Exception {
        CountDownLatch decoded=new CountDownLatch(1),release=new CountDownLatch(1),returned=new CountDownLatch(1);
        create((bytes,width,height)->{
            Bitmap result=BitmapFactory.decodeByteArray(bytes,0,bytes.length);decoded.countDown();
            long until=SystemClock.uptimeMillis()+5000;
            while(release.getCount()!=0 && SystemClock.uptimeMillis()<until)try{release.await(25,TimeUnit.MILLISECONDS);}catch(InterruptedException ignored){}
            returned.countDown();return result;
        });
        try {
            main(()->loader.load(image,FETCHED,SCOPE));assertTrue(decoded.await(3,TimeUnit.SECONDS));
            main(()->{if(action==0)loader.unbind(image);else if(action==1)loader.retireScreen();else loader.clear();});
            release.countDown();assertTrue(returned.await(3,TimeUnit.SECONDS));
            long until=SystemClock.uptimeMillis()+FIRST_BITMAP_BUDGET_MS;
            do {assertNull("Revoked subscriber must never receive a bitmap",bitmap(image));SystemClock.sleep(10);}while(SystemClock.uptimeMillis()<until);
            assertNull(disk.read(SCOPE,FETCHED));assertNull(unexpectedRequest.get());assertEquals(1,requests.get());
        } finally {release.countDown();}
    }

    private static final class SlowWrite {
        final AtomicBoolean armed=new AtomicBoolean();
        final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        long freeSpace() {
            if(armed.get()) {
                entered.countDown();long until=SystemClock.uptimeMillis()+5000;
                while(release.getCount()!=0 && SystemClock.uptimeMillis()<until)try{release.await(25,TimeUnit.MILLISECONDS);}catch(InterruptedException ignored){}
            }
            return 128L*1024*1024;
        }
    }
    private static final class FakeHttpsImage extends HttpURLConnection {
        final byte[] bytes;
        FakeHttpsImage(byte[] bytes) throws Exception {super(new URL(FETCHED));this.bytes=bytes;}
        @Override public int getResponseCode(){return 200;}
        @Override public int getContentLength(){return bytes.length;}
        @Override public String getContentType(){return "image/png";}
        @Override public InputStream getInputStream(){return new ByteArrayInputStream(bytes);}
        @Override public void disconnect(){}
        @Override public boolean usingProxy(){return false;}
        @Override public void connect(){}
    }
}
