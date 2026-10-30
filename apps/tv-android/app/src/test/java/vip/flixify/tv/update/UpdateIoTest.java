package vip.flixify.tv.update;

import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.Assert.*;

public class UpdateIoTest {
    private static final byte[] BODY=new byte[]{1,2,3,4,5,6};
    private static final UpdateIo.Guard ALLOWED=new UpdateIo.Guard(){public void check(){}public void connected(HttpURLConnection c){}};
    private interface Work {void run() throws Exception;}
    private void rejects(Work work) throws Exception {try{work.run();fail("Unverified update accepted");}catch(IOException expected){}}
    private UpdateInfo info(byte[] body) throws Exception {return new UpdateInfo("vip.flixify.tv","1.4.0",8,23,"https://flixify.vip/downloads/flixify-pro-1.4.0.apk",UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(body)),body.length,"Update");}
    private File directory() throws Exception {return Files.createTempDirectory("flixify-updater-test-").toFile().getCanonicalFile();}
    private void remove(File root) {File[] files=root.listFiles();if(files!=null)for(File file:files){if(file.isDirectory())remove(file);else file.delete();}root.delete();}
    private static final class Response extends HttpURLConnection {
        final byte[] body;int status=200;long length;boolean closed;InputStream stream;
        Response(URL url,byte[] body){super(url);this.body=body;this.length=body.length;}
        @Override public int getResponseCode(){return status;}
        @Override public long getContentLengthLong(){return length;}
        @Override public int getContentLength(){return (int)length;}
        @Override public InputStream getInputStream(){return stream==null?new ByteArrayInputStream(body):stream;}
        @Override public void disconnect(){closed=true;}
        @Override public boolean usingProxy(){return false;}
        @Override public void connect(){}
    }
    @Test public void readsOnlyTheFixedBoundedManifestAndDisconnects() throws Exception {
        List<Response> opened=new ArrayList<>();UpdateIo io=new UpdateIo(url->{assertEquals(UpdateIo.MANIFEST_URL,url.toString());Response r=new Response(url,"{}".getBytes());opened.add(r);return r;},System::nanoTime);
        assertArrayEquals("{}".getBytes(),io.manifest(ALLOWED));assertFalse(opened.get(0).getInstanceFollowRedirects());assertTrue(opened.get(0).closed);
    }
    @Test public void rejectsRedirectStatusAndOversizeChunkedManifestWithoutFollowing() throws Exception {
        for(int status:new int[]{301,302,403}){int[] calls={0};UpdateIo io=new UpdateIo(url->{calls[0]++;Response r=new Response(url,BODY);r.status=status;return r;},System::nanoTime);rejects(()->io.manifest(ALLOWED));assertEquals(1,calls[0]);}
        UpdateIo io=new UpdateIo(url->{Response r=new Response(url,new byte[UpdatePolicy.MAX_MANIFEST_BYTES+1]);r.length=-1;return r;},System::nanoTime);rejects(()->io.manifest(ALLOWED));
    }
    @Test public void verifiesExactBytesBeforePublishingAtomicApkAndProgress() throws Exception {
        File dir=directory();List<Integer> progress=new ArrayList<>();int[] verified={0};UpdateIo io=new UpdateIo(url->new Response(url,BODY),System::nanoTime);
        try{File apk=io.download(info(BODY),dir,ALLOWED,progress::add,(file,info)->{verified[0]++;assertTrue(file.isFile());assertEquals(6,file.length());});assertTrue(apk.getName().endsWith(".apk"));assertEquals(1,verified[0]);assertEquals(1,dir.listFiles().length);assertEquals(Integer.valueOf(100),progress.get(progress.size()-1));UpdateIo.verifyBytes(apk,info(BODY),ALLOWED);}
        finally{remove(dir);}
    }
    @Test public void refusesTruncatedExtraWrongHashAndDeclaredSizeBeforeArchiveVerification() throws Exception {
        for(byte[] body:new byte[][]{{1,2},{1,2,3,4,5,6,7},{7,7,7,7,7,7}}){File dir=directory();int[] verified={0};UpdateIo io=new UpdateIo(url->{Response r=new Response(url,body);r.length=-1;return r;},System::nanoTime);try{rejects(()->io.download(info(BODY),dir,ALLOWED,p->{},(f,i)->verified[0]++));assertEquals(0,verified[0]);assertEquals(0,dir.listFiles().length);}finally{remove(dir);}}
        File dir=directory();try{UpdateIo io=new UpdateIo(url->{Response r=new Response(url,BODY);r.length=900;return r;},System::nanoTime);rejects(()->io.download(info(BODY),dir,ALLOWED,p->{},(f,i)->fail("Size mismatch reached archive verifier")));assertEquals(0,dir.listFiles().length);}finally{remove(dir);}
    }
    @Test public void archiveRejectionDeletesStagingBytes() throws Exception {File dir=directory();try{UpdateIo io=new UpdateIo(url->new Response(url,BODY),System::nanoTime);rejects(()->io.download(info(BODY),dir,ALLOWED,p->{},(f,i)->{throw new UpdateFailure();}));assertEquals(0,dir.listFiles().length);}finally{remove(dir);}}
    @Test public void cancellationAndPlaybackGateNeverPublishOrOpenWhenAlreadyBlocked() throws Exception {
        File dir=directory();int[] opens={0};UpdateIo io=new UpdateIo(url->{opens[0]++;return new Response(url,BODY);},System::nanoTime);
        UpdateIo.Guard blocked=new UpdateIo.Guard(){public void check() throws IOException {throw new IOException("cancelled");}public void connected(HttpURLConnection c){}};
        try{rejects(()->io.download(info(BODY),dir,blocked,p->{},(f,i)->fail("Cancelled download verified")));assertEquals(0,opens[0]);assertEquals(0,dir.listFiles().length);}
        finally{remove(dir);}
    }
    @Test public void cancellationAfterReadAndTotalDeadlineDeleteIncompleteFiles() throws Exception {
        File dir=directory();int[] checks={0};UpdateIo.Guard cancelled=new UpdateIo.Guard(){public void check() throws IOException {if(++checks[0]>=4)throw new IOException("cancelled");}public void connected(HttpURLConnection c){}};
        try{UpdateIo io=new UpdateIo(url->new Response(url,BODY),System::nanoTime);rejects(()->io.download(info(BODY),dir,cancelled,p->{},(f,i)->fail("Cancelled download verified")));assertEquals(0,dir.listFiles().length);long[] now={0};UpdateIo slow=new UpdateIo(url->new Response(url,BODY),()->{long result=now[0];now[0]+=121_000_000_000L;return result;});rejects(()->slow.download(info(BODY),dir,ALLOWED,p->{},(f,i)->fail("Expired work verified")));assertEquals(0,dir.listFiles().length);}
        finally{remove(dir);}
    }
    @Test public void replacesOldUpdateCacheAndRechecksTamperedReadyFile() throws Exception {
        File dir=directory();try{File old=new File(dir,"update-old.apk");try(FileOutputStream out=new FileOutputStream(old)){out.write(7);}UpdateIo io=new UpdateIo(url->new Response(url,BODY),System::nanoTime);File apk=io.download(info(BODY),dir,ALLOWED,p->{},(f,i)->{});assertFalse(old.exists());try(FileOutputStream out=new FileOutputStream(apk)){out.write(new byte[6]);}rejects(()->UpdateIo.verifyBytes(apk,info(BODY),ALLOWED));}finally{remove(dir);}
    }
}
