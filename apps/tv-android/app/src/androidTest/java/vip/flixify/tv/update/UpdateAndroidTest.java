package vip.flixify.tv.update;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ProviderInfo;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import vip.flixify.tv.BackgroundWorkGate;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class UpdateAndroidTest {
    private Context context;private TvUpdater updater;private final Object player=new Object();
    @Before public void setup(){context=InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();}
    @After public void cleanup(){BackgroundWorkGate.endPlayback(player);if(updater!=null)updater.close();}
    private byte[] manifest() throws Exception {long code=new AndroidApkVerifier(context).installed().versionCode;return new JSONObject().put("packageName",context.getPackageName()).put("versionName","1.4.1").put("versionCode",code+1).put("minSdk",23).put("apkUrl","https://flixify.vip/downloads/flixify-pro-1.4.1.apk").put("sha256","039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81").put("sizeBytes",3).put("notes","Offline update fixture").toString().getBytes(StandardCharsets.UTF_8);}
    private static class Response extends HttpURLConnection {
        final byte[] body;volatile boolean disconnected;final CountDownLatch entered,release;
        Response(URL url,byte[] body){this(url,body,null,null);}
        Response(URL url,byte[] body,CountDownLatch entered,CountDownLatch release){super(url);this.body=body;this.entered=entered;this.release=release;}
        @Override public int getResponseCode(){return 200;}
        @Override public int getContentLength(){return body.length;}
        @Override public InputStream getInputStream(){return new ByteArrayInputStream(body){@Override public synchronized int read(byte[] bytes,int offset,int length){if(entered!=null){entered.countDown();try{release.await(3,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}if(disconnected)return -1;}return super.read(bytes,offset,length);}};}
        @Override public void disconnect(){disconnected=true;if(release!=null)release.countDown();}
        @Override public boolean usingProxy(){return false;}
        @Override public void connect(){}
    }
    @Test public void actualPackageManagerReadsInstalledArchiveAndCurrentSigner() throws Exception {
        AndroidApkVerifier verifier=new AndroidApkVerifier(context);AndroidApkVerifier.Identity installed=verifier.installed(),archive=verifier.archive(new File(context.getApplicationInfo().sourceDir),23);
        assertEquals(context.getPackageName(),archive.packageName);assertEquals(installed.versionCode,archive.versionCode);assertEquals(installed.versionName,archive.versionName);assertTrue(installed.signers.length>0);assertEquals(installed.signers.length,archive.signers.length);for(int i=0;i<installed.signers.length;i++)assertArrayEquals(installed.signers[i],archive.signers[i]);
        File bad=File.createTempFile("bad-update-",".apk",context.getCacheDir());try{try(FileOutputStream out=new FileOutputStream(bad)){out.write(new byte[]{1,2,3});}try{verifier.archive(bad,23);fail("Corrupt archive accepted");}catch(UpdateFailure expected){}}finally{bad.delete();}
    }
    @Test public void fileProviderExposesOnlyPrivateUpdateDirectoryAndNoExportedAccess() throws Exception {
        File dir=new File(context.getCacheDir(),"apk-updates");assertTrue(dir.isDirectory()||dir.mkdirs());File apk=new File(dir,"update-fixture.apk"),outside=File.createTempFile("outside-update-",".apk",context.getCacheDir());
        try{try(FileOutputStream out=new FileOutputStream(apk)){out.write(1);}assertEquals("content",FileProvider.getUriForFile(context,context.getPackageName()+".updates",apk).getScheme());try{FileProvider.getUriForFile(context,context.getPackageName()+".updates",outside);fail("Outside cache file exposed");}catch(IllegalArgumentException expected){}ProviderInfo provider=context.getPackageManager().getProviderInfo(new ComponentName(context,UpdateFileProvider.class),0);assertFalse(provider.exported);assertTrue(provider.grantUriPermissions);assertEquals(context.getPackageName()+".updates",provider.authority);}finally{apk.delete();outside.delete();}
    }
    @Test public void explicitCheckReadsManifestOnlyAndNeverAutomaticallyDownloadsApk() throws Exception {
        byte[] body=manifest();AtomicInteger calls=new AtomicInteger();CountDownLatch ready=new CountDownLatch(1);UpdateInfo[] result={null};
        updater=new TvUpdater(context,new UpdateIo(url->{calls.incrementAndGet();assertEquals(UpdateIo.MANIFEST_URL,url.toString());return new Response(url,body);},System::nanoTime));assertEquals(0,calls.get());
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){result[0]=info;ready.countDown();}public void onError(String error){ready.countDown();}});assertTrue(ready.await(3,TimeUnit.SECONDS));assertNotNull(result[0]);assertEquals(1,calls.get());
    }
    @Test public void correctlyHashedNonApkCannotBecomeReadyOrReachInstaller() throws Exception {
        byte[] body=manifest();CountDownLatch checked=new CountDownLatch(1),failed=new CountDownLatch(1);UpdateInfo[] info={null};AtomicInteger ready=new AtomicInteger();
        updater=new TvUpdater(context,new UpdateIo(url->new Response(url,url.toString().equals(UpdateIo.MANIFEST_URL)?body:new byte[]{1,2,3}),System::nanoTime));
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo value){info[0]=value;checked.countDown();}public void onError(String error){checked.countDown();}});assertTrue(checked.await(3,TimeUnit.SECONDS));assertNotNull(info[0]);
        updater.download(info[0],new TvUpdater.DownloadCallback(){public void onProgress(int p){}public void onReady(File file){ready.incrementAndGet();failed.countDown();}public void onError(String error){assertFalse(error.contains("https://"));failed.countDown();}});assertTrue(failed.await(3,TimeUnit.SECONDS));assertEquals(0,ready.get());
        File[] files=new File(context.getCacheDir(),"apk-updates").listFiles();assertNotNull(files);assertEquals(0,files.length);
        boolean[] rejected={false};InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{updater.requestInstall(new Activity(),new File(context.getCacheDir(),"unissued.apk"));}catch(IllegalStateException expected){rejected[0]=true;}});assertTrue("Unissued file reached installer",rejected[0]);
    }
    @Test public void playbackGateBlocksOptionalNetworkAndAllowsLaterUserCheck() throws Exception {
        byte[] body=manifest();AtomicInteger requests=new AtomicInteger();CountDownLatch blocked=new CountDownLatch(1),ready=new CountDownLatch(1);
        updater=new TvUpdater(context,new UpdateIo(url->{requests.incrementAndGet();return new Response(url,body);},System::nanoTime));BackgroundWorkGate.beginPlayback(player);
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){fail("Player-active check succeeded");}public void onError(String error){assertTrue(error.contains("oynatıcı"));blocked.countDown();}});assertTrue(blocked.await(3,TimeUnit.SECONDS));assertEquals(0,requests.get());BackgroundWorkGate.endPlayback(player);
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){ready.countDown();}public void onError(String error){}});assertTrue(ready.await(3,TimeUnit.SECONDS));assertEquals(1,requests.get());
    }
    @Test public void cancelDisconnectsPendingReadSuppressesOldCallbackAndAllowsRetry() throws Exception {
        byte[] body=manifest();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),ready=new CountDownLatch(1);AtomicInteger requests=new AtomicInteger(),oldCallbacks=new AtomicInteger();
        updater=new TvUpdater(context,new UpdateIo(url->requests.getAndIncrement()==0?new Response(url,body,entered,release):new Response(url,body),System::nanoTime));
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){oldCallbacks.incrementAndGet();}public void onError(String error){oldCallbacks.incrementAndGet();}});assertTrue(entered.await(3,TimeUnit.SECONDS));updater.cancel();
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){ready.countDown();}public void onError(String error){}});assertTrue(ready.await(3,TimeUnit.SECONDS));assertEquals(2,requests.get());assertEquals(0,oldCallbacks.get());
    }
    @Test public void closeDisconnectsPendingReadAndRejectsFurtherCallbacks() throws Exception {
        byte[] body=manifest();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);AtomicInteger calls=new AtomicInteger(),callbacks=new AtomicInteger();
        updater=new TvUpdater(context,new UpdateIo(url->{calls.incrementAndGet();return new Response(url,body,entered,release);},System::nanoTime));TvUpdater.Callback<UpdateInfo> callback=new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){callbacks.incrementAndGet();}public void onError(String error){callbacks.incrementAndGet();}};
        updater.check(callback);assertTrue(entered.await(3,TimeUnit.SECONDS));updater.close();updater.check(callback);assertTrue(release.await(1,TimeUnit.SECONDS));InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertEquals(1,calls.get());assertEquals(0,callbacks.get());
    }
    private Activity activity() {Activity[] result={null};InstrumentationRegistry.getInstrumentation().runOnMainSync(()->result[0]=new Activity());return result[0];}
    private File readyFile(PackageChecks checks,TvUpdater.InstallLauncher launcher) throws Exception {
        byte[] metadata=manifest();CountDownLatch checked=new CountDownLatch(1),downloaded=new CountDownLatch(1);UpdateInfo[] update={null};File[] result={null};
        updater=new TvUpdater(context,new UpdateIo(url->new Response(url,url.toString().equals(UpdateIo.MANIFEST_URL)?metadata:new byte[]{1,2,3}),System::nanoTime),checks,launcher);
        updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){update[0]=info;checked.countDown();}public void onError(String error){checked.countDown();}});assertTrue(checked.await(3,TimeUnit.SECONDS));assertNotNull(update[0]);
        updater.download(update[0],new TvUpdater.DownloadCallback(){public void onProgress(int percent){}public void onReady(File file){result[0]=file;downloaded.countDown();}public void onError(String error){downloaded.countDown();}});assertTrue(downloaded.await(3,TimeUnit.SECONDS));assertNotNull(result[0]);return result[0];
    }
    private PackageChecks checks() throws Exception {long installed=new AndroidApkVerifier(context).installed().versionCode;return new PackageChecks(){public UpdatePolicy policy(){return new UpdatePolicy(context.getPackageName(),installed,android.os.Build.VERSION.SDK_INT);}public void verify(File file,UpdateInfo info){}};}
    @Test public void installVerifiesOnWorkerThenLaunchesAndReturnsOnMain() throws Exception {
        PackageChecks base=checks();AtomicInteger launches=new AtomicInteger(),verifies=new AtomicInteger();boolean[] background={true},main={false};CountDownLatch done=new CountDownLatch(1);Boolean[] result={null};
        PackageChecks observed=new PackageChecks(){public UpdatePolicy policy() throws UpdateFailure{return base.policy();}public void verify(File file,UpdateInfo info){verifies.incrementAndGet();background[0]&=android.os.Looper.myLooper()!=android.os.Looper.getMainLooper();}};
        File file=readyFile(observed,(owner,apk)->{launches.incrementAndGet();main[0]=android.os.Looper.myLooper()==android.os.Looper.getMainLooper();return true;});Activity owner=activity();
        updater.requestInstallAsync(owner,file,new TvUpdater.Callback<Boolean>(){public void onResult(Boolean value){result[0]=value;main[0]&=android.os.Looper.myLooper()==android.os.Looper.getMainLooper();done.countDown();}public void onError(String error){done.countDown();}});
        assertTrue(done.await(3,TimeUnit.SECONDS));assertEquals(Boolean.TRUE,result[0]);assertEquals(1,launches.get());assertEquals(2,verifies.get());assertTrue(background[0]);assertTrue(main[0]);
    }
    @Test public void cancellingPendingInstallVerificationPreventsLaunchAndStaleCallback() throws Exception {
        PackageChecks base=checks();AtomicInteger verifies=new AtomicInteger(),launches=new AtomicInteger(),callbacks=new AtomicInteger();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),retried=new CountDownLatch(1);
        PackageChecks blocked=new PackageChecks(){public UpdatePolicy policy() throws UpdateFailure{return base.policy();}public void verify(File file,UpdateInfo info) throws IOException {if(verifies.incrementAndGet()==2){entered.countDown();try{release.await(3,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}}}};
        File file=readyFile(blocked,(owner,apk)->{launches.incrementAndGet();return true;});Activity owner=activity();updater.requestInstallAsync(owner,file,new TvUpdater.Callback<Boolean>(){public void onResult(Boolean value){callbacks.incrementAndGet();}public void onError(String error){callbacks.incrementAndGet();}});
        assertTrue(entered.await(3,TimeUnit.SECONDS));updater.cancel();release.countDown();updater.check(new TvUpdater.Callback<UpdateInfo>(){public void onResult(UpdateInfo info){retried.countDown();}public void onError(String error){retried.countDown();}});assertTrue(retried.await(3,TimeUnit.SECONDS));assertEquals(0,launches.get());assertEquals(0,callbacks.get());
    }
    @Test public void tamperedIssuedApkReportsErrorWithoutLaunchingInstaller() throws Exception {
        AtomicInteger launches=new AtomicInteger();CountDownLatch failed=new CountDownLatch(1);Boolean[] result={null};File file=readyFile(checks(),(owner,apk)->{launches.incrementAndGet();return true;});try(FileOutputStream out=new FileOutputStream(file)){out.write(new byte[]{4,5,6});}
        updater.requestInstallAsync(activity(),file,new TvUpdater.Callback<Boolean>(){public void onResult(Boolean value){result[0]=value;failed.countDown();}public void onError(String error){failed.countDown();}});assertTrue(failed.await(3,TimeUnit.SECONDS));assertNull(result[0]);assertEquals(0,launches.get());
    }

    @Test public void androidManifestParserRejectsDeepJsonBeforeVmStackCanOverflow() throws Exception {
        UpdatePolicy policy=new UpdatePolicy(context.getPackageName(),1,android.os.Build.VERSION.SDK_INT);
        StringBuilder nested=new StringBuilder("{\"notes\":");for(int i=0;i<6000;i++)nested.append('[');nested.append('0');for(int i=0;i<6000;i++)nested.append(']');nested.append('}');
        byte[] payload=nested.toString().getBytes(StandardCharsets.UTF_8);assertTrue(payload.length<UpdatePolicy.MAX_MANIFEST_BYTES);
        try{policy.parse(payload);fail("Nested update schema accepted");}catch(UpdateFailure expected){}catch(StackOverflowError error){fail("Bounded updater manifest overflowed Android JSONTokener");}
        JSONObject valid=new JSONObject(new String(manifest(),StandardCharsets.UTF_8));String notes="{film} [dizi] \"alıntı\" \\TV\\";valid.put("notes",notes);assertEquals(notes,policy.parse(valid.toString().getBytes(StandardCharsets.UTF_8)).notes);
        valid.put("notes",JSONObject.NULL);try{policy.parse(valid.toString().getBytes(StandardCharsets.UTF_8));fail("Null notes accepted");}catch(UpdateFailure expected){}
    }

}
