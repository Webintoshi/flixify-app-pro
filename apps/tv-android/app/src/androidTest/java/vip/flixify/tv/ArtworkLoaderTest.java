package vip.flixify.tv;

import android.content.Context;
import android.graphics.Bitmap;
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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ArtworkLoaderTest {
    private static final String ADDRESS="https://art.invalid/a.png", SCOPE="account:source";
    private Context context;
    private File directory;
    private ArtworkDiskCache disk;
    private ArtworkLoader loader;
    private ImageView image;
    private final Object playbackOwner=new Object();
    private byte[] red,blue;
    private final AtomicInteger opens=new AtomicInteger();
    private void main(Runnable task) {InstrumentationRegistry.getInstrumentation().runOnMainSync(task);}
    @Before public void setUp() throws Exception {
        context=ApplicationProvider.getApplicationContext();directory=new File(context.getCacheDir(),"artwork-test-"+System.nanoTime());disk=new ArtworkDiskCache(directory);
        red=png(Color.RED,800,1200);blue=png(Color.BLUE,32,24);main(()->image=new ImageView(context));
    }
    @After public void tearDown() {BackgroundWorkGate.endPlayback(playbackOwner);main(()->{if(loader!=null)loader.close();});disk.clear();directory.delete();}
    private byte[] png(int color,int width,int height) {
        Bitmap bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);bitmap.eraseColor(color);
        ByteArrayOutputStream output=new ByteArrayOutputStream();assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,output));bitmap.recycle();return output.toByteArray();
    }
    private void create(ArtworkLoader.ConnectionFactory factory) {main(()->loader=new ArtworkLoader(context,disk,address->{opens.incrementAndGet();return factory.open(address);}));}
    private void load(String address,String scope) {main(()->loader.load(image,address,scope));}
    private Bitmap bitmap() {AtomicReference<Bitmap> result=new AtomicReference<>();main(()->{if(image.getDrawable() instanceof BitmapDrawable)result.set(((BitmapDrawable)image.getDrawable()).getBitmap());});return result.get();}
    private Bitmap awaitBitmap() {
        long until=SystemClock.uptimeMillis()+4000;Bitmap value;
        do {value=bitmap();if(value!=null)return value;SystemClock.sleep(20);}while(SystemClock.uptimeMillis()<until);
        fail("Visible artwork was not decoded and attached");return null;
    }
    private void completed(FakeConnection connection) throws Exception {assertTrue("Artwork worker completed",connection.done.await(4,TimeUnit.SECONDS));if(connection.inputOpened)assertTrue("Artwork read closed",connection.streamClosed.await(4,TimeUnit.SECONDS));InstrumentationRegistry.getInstrumentation().waitForIdleSync();}

    @Test public void decodedArtworkSurvivesColdLoaderReopenWithoutAnotherRequest() throws Exception {
        FakeConnection first=new FakeConnection(red);create(address->first);load(ADDRESS,SCOPE);
        Bitmap decoded=awaitBitmap();assertTrue(decoded.getWidth()<=512);assertTrue(decoded.getHeight()<=768);assertEquals(Color.RED,decoded.getPixel(0,0));
        completed(first);assertNotNull(disk.read(SCOPE,ADDRESS));main(()->loader.close());
        create(address->new FakeConnection(null));load(ADDRESS,SCOPE);assertEquals(Color.RED,awaitBitmap().getPixel(0,0));assertEquals(1,opens.get());
    }
    @Test public void sameAddressFromAnotherScopeCannotReuseRamOrDiskArtwork() throws Exception {
        create(address->new FakeConnection(opens.get()==1?red:blue));load(ADDRESS,SCOPE);assertEquals(Color.RED,awaitBitmap().getPixel(0,0));
        load(ADDRESS,"other-account:source");assertEquals(Color.BLUE,awaitBitmap().getPixel(0,0));assertEquals(2,opens.get());
    }
    @Test public void playbackGateAllowsDiskHitButNeverStartsMissingNetworkArtwork() throws Exception {
        assertTrue(disk.write(SCOPE,ADDRESS,red,()->true));BackgroundWorkGate.beginPlayback(playbackOwner);
        create(address->new FakeConnection(blue));load(ADDRESS,SCOPE);assertEquals(Color.RED,awaitBitmap().getPixel(0,0));
        load("https://art.invalid/missing.png",SCOPE);SystemClock.sleep(150);assertNull(bitmap());assertEquals(0,opens.get());
    }
    @Test public void enteringPlaybackDuringReadStopsOptionalImageAndDoesNotCacheIt() throws Exception {
        FakeConnection connection=new FakeConnection(red);connection.block=true;create(address->connection);load(ADDRESS,SCOPE);
        assertTrue(connection.readStarted.await(3,TimeUnit.SECONDS));BackgroundWorkGate.beginPlayback(playbackOwner);connection.release.countDown();completed(connection);
        assertNull(bitmap());assertNull(disk.read(SCOPE,ADDRESS));
    }
    @Test public void corruptCachedImageUsesPlaceholderWhilePlaybackPreventsRefetch() throws Exception {
        assertTrue(disk.write(SCOPE,ADDRESS,new byte[]{1,2,3,4},()->true));BackgroundWorkGate.beginPlayback(playbackOwner);
        create(address->new FakeConnection(red));load(ADDRESS,SCOPE);SystemClock.sleep(250);
        assertNull(bitmap());assertNull(disk.read(SCOPE,ADDRESS));assertEquals(0,opens.get());
    }
    @Test public void recycledViewCannotBeOverwrittenOrPersistedByTheRetiredRequest() throws Exception {
        FakeConnection slow=new FakeConnection(red);slow.block=true;create(address->address.equals(ADDRESS)?slow:new FakeConnection(blue));load(ADDRESS,SCOPE);
        assertTrue(slow.readStarted.await(3,TimeUnit.SECONDS));load("https://art.invalid/b.png",SCOPE);assertEquals(Color.BLUE,awaitBitmap().getPixel(0,0));
        slow.release.countDown();completed(slow);assertEquals(Color.BLUE,bitmap().getPixel(0,0));assertNull(disk.read(SCOPE,ADDRESS));
    }
    @Test public void logoutClearRejectsAnOldRequestEvenAfterItFinishesReading() throws Exception {
        FakeConnection slow=new FakeConnection(red);slow.block=true;create(address->slow);load(ADDRESS,SCOPE);
        assertTrue(slow.readStarted.await(3,TimeUnit.SECONDS));main(()->loader.clear());slow.release.countDown();completed(slow);
        assertNull(bitmap());assertNull(disk.read(SCOPE,ADDRESS));assertEquals(0,directory.listFiles().length);
    }
    @Test public void closeAndUnbindBothRejectLateImageCallbacks() throws Exception {
        FakeConnection unbound=new FakeConnection(red);unbound.block=true;create(address->unbound);load(ADDRESS,SCOPE);
        assertTrue(unbound.readStarted.await(3,TimeUnit.SECONDS));main(()->loader.unbind(image));unbound.release.countDown();completed(unbound);assertNull(bitmap());assertNull(disk.read(SCOPE,ADDRESS));
        FakeConnection closed=new FakeConnection(blue);closed.block=true;main(()->loader.close());create(address->closed);load(ADDRESS,SCOPE);
        assertTrue(closed.readStarted.await(3,TimeUnit.SECONDS));main(()->loader.close());closed.release.countDown();completed(closed);assertNull(bitmap());assertNull(disk.read(SCOPE,ADDRESS));
    }
    @Test public void unsafeRedirectWrongMimeAndOversizedArtworkLeavePlaceholders() throws Exception {
        FakeConnection[] failures={new FakeConnection(red),new FakeConnection(red),new FakeConnection(new byte[2*1024*1024+1])};
        failures[0].status=302;failures[1].mime="text/html";failures[2].declaredLength=-1;
        for(int index=0;index<failures.length;index++) {
            final FakeConnection connection=failures[index];if(loader!=null)main(()->loader.close());create(address->connection);load(ADDRESS,SCOPE);completed(connection);
            assertNull(bitmap());assertNull(disk.read(SCOPE,ADDRESS));assertFalse(connection.getInstanceFollowRedirects());
        }
        int before=opens.get();load("http://art.invalid/a.png",SCOPE);load("https://user:password@art.invalid/a.png",SCOPE);load(ADDRESS+"#fragment",SCOPE);load(ADDRESS,"");SystemClock.sleep(100);assertEquals(before,opens.get());assertNull(bitmap());
    }
    private static final class FakeConnection extends HttpURLConnection {
        final byte[] data;final CountDownLatch readStarted=new CountDownLatch(1),release=new CountDownLatch(1),done=new CountDownLatch(1),streamClosed=new CountDownLatch(1);
        volatile boolean block,inputOpened;int status=200,declaredLength;String mime="image/png";
        FakeConnection(byte[] data) throws Exception {super(new URL(ADDRESS));this.data=data;declaredLength=data==null?0:data.length;}
        @Override public int getResponseCode() {return status;}
        @Override public int getContentLength() {return declaredLength;}
        @Override public String getContentType() {return mime;}
        @Override public InputStream getInputStream() {inputOpened=true;return new ByteArrayInputStream(data==null?new byte[0]:data) {
            @Override public synchronized int read(byte[] bytes,int offset,int length) {
                if(block) {readStarted.countDown();try {release.await(3,TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}block=false;}
                return super.read(bytes,offset,Math.min(length,128));
            }
            @Override public void close() {streamClosed.countDown();}
        };}
        @Override public void disconnect() {done.countDown();}
        @Override public boolean usingProxy() {return false;}
        @Override public void connect() {}
    }
}
