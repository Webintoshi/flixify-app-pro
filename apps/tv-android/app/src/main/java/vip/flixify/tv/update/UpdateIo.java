package vip.flixify.tv.update;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

final class UpdateIo {
    static final String MANIFEST_URL="https://flixify.vip/downloads/flixify-tv-update.json";
    interface ConnectionFactory {HttpURLConnection open(URL url) throws IOException;}
    interface Clock {long nowNanos();}
    interface Guard {void check() throws IOException;void connected(HttpURLConnection connection) throws IOException;}
    interface Progress {void onProgress(int percent);}
    interface Verifier {void verify(File file,UpdateInfo info) throws IOException;}
    private final ConnectionFactory factory;private final Clock clock;
    UpdateIo(ConnectionFactory factory,Clock clock) {this.factory=factory;this.clock=clock;}
    private void active(Guard guard,long started,long budgetMs) throws IOException {guard.check();if((clock.nowNanos()-started)/1_000_000L>=budgetMs)throw new UpdateFailure("Güncelleme bağlantısı zaman aşımına uğradı.");}
    private HttpURLConnection open(String address,Guard guard) throws IOException {
        guard.check();HttpURLConnection connection=factory.open(new URL(address));
        try {
            guard.connected(connection);guard.check();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setUseCaches(false);connection.setRequestProperty("Cache-Control","no-cache");
            if(connection.getResponseCode()!=200)throw new UpdateFailure("Güncelleme sunucusuna bağlanılamadı. Tekrar deneyebilirsiniz.");
            return connection;
        }catch(IOException|RuntimeException error){connection.disconnect();throw error;}
    }
    byte[] manifest(Guard guard) throws IOException {
        long started=clock.nowNanos();active(guard,started,20000);HttpURLConnection connection=open(MANIFEST_URL,guard);
        try {
            if(connection.getContentLength()>UpdatePolicy.MAX_MANIFEST_BYTES)throw new UpdateFailure();
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[4096];int count;
                while((count=input.read(buffer))!=-1){active(guard,started,20000);if(out.size()+count>UpdatePolicy.MAX_MANIFEST_BYTES)throw new UpdateFailure();out.write(buffer,0,count);}
                active(guard,started,20000);return out.toByteArray();
            }
        }finally{connection.disconnect();}
    }
    File download(UpdateInfo info,File directory,Guard guard,Progress progress,Verifier verifier) throws IOException {
        if(info==null || info.sizeBytes<1 || info.sizeBytes>UpdatePolicy.MAX_APK_BYTES || info.sha256==null || !info.sha256.matches("[0-9a-f]{64}") || !("https://flixify.vip/downloads/flixify-pro-"+info.versionName+".apk").equals(info.apkUrl))throw new UpdateFailure();
        long started=clock.nowNanos();active(guard,started,120000);
        if((!directory.isDirectory() && !directory.mkdirs()) || !directory.getCanonicalFile().equals(directory.getAbsoluteFile()))throw new UpdateFailure("Güncelleme için depolama alanı açılamadı.");
        File[] old=directory.listFiles();if(old==null)throw new UpdateFailure();
        for(File file:old)if(file.getName().startsWith("update-") && file.getName().endsWith(".apk") && !file.delete())throw new UpdateFailure("Önceki güncelleme dosyası temizlenemedi.");
        if(directory.getUsableSpace()<info.sizeBytes+8L*1024*1024)throw new UpdateFailure("Güncelleme için yeterli boş alan yok.");
        HttpURLConnection connection=null;File staging=null;boolean published=false;
        try {
            connection=open(info.apkUrl,guard);int declared=connection.getContentLength();
            if(declared>=0 && declared!=info.sizeBytes)throw new UpdateFailure();
            staging=File.createTempFile("update-",".part.apk",directory);long size=0;int last=-1;
            try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(staging)) {
                byte[] buffer=new byte[16384];int count;
                while((count=input.read(buffer))!=-1){active(guard,started,120000);size+=count;if(size>info.sizeBytes || size>UpdatePolicy.MAX_APK_BYTES)throw new UpdateFailure();output.write(buffer,0,count);int value=(int)Math.min(99,size*100/info.sizeBytes);if(value!=last){last=value;progress.onProgress(value);}}
                output.getFD().sync();
            }
            active(guard,started,120000);verifyBytes(staging,info,guard);verifier.verify(staging,info);active(guard,started,120000);
            File result=new File(directory,"update-"+info.versionCode+"-"+info.sha256.substring(0,16)+".apk");
            if(!staging.renameTo(result))throw new UpdateFailure("Güncelleme dosyası hazırlanamadı.");
            staging=result;active(guard,started,120000);progress.onProgress(100);published=true;return result;
        }finally{if(connection!=null)connection.disconnect();if(!published && staging!=null)staging.delete();}
    }
    static void verifyBytes(File file,UpdateInfo info,Guard guard) throws IOException {
        guard.check();if(file==null || !file.isFile() || info==null || file.length()!=info.sizeBytes || info.sizeBytes<1 || info.sizeBytes>UpdatePolicy.MAX_APK_BYTES || info.sha256==null || !info.sha256.matches("[0-9a-f]{64}"))throw new UpdateFailure();
        try {
            MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;
            try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1){guard.check();size+=count;if(size>info.sizeBytes)throw new UpdateFailure();digest.update(buffer,0,count);}}
            guard.check();if(size!=info.sizeBytes || !UpdatePolicy.hex(digest.digest()).equals(info.sha256))throw new UpdateFailure();
        }catch(IOException error){throw error;}catch(Exception error){throw new UpdateFailure();}
    }
}
