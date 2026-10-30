package vip.flixify.tv.update;

import org.json.JSONObject;
import org.json.JSONTokener;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

final class UpdatePolicy {
    static final int MAX_MANIFEST_BYTES=64*1024;
    static final long MAX_APK_BYTES=32L*1024*1024;
    final String packageName;final long installedVersion;final int sdk;
    UpdatePolicy(String packageName,long installedVersion,int sdk) {this.packageName=packageName;this.installedVersion=installedVersion;this.sdk=sdk;}

    UpdateInfo parse(byte[] data) throws UpdateFailure {
        if(data==null || data.length==0 || data.length>MAX_MANIFEST_BYTES)throw new UpdateFailure();
        try {
            String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data)).toString();
            requireFlatObject(text);
            JSONTokener tokener=new JSONTokener(text);Object value=tokener.nextValue();
            if(!(value instanceof JSONObject) || tokener.nextClean()!=0)throw new UpdateFailure();
            JSONObject json=(JSONObject)value;if(json.length()!=8)throw new UpdateFailure();
            long code=integer(json,"versionCode"),minimum=integer(json,"minSdk"),size=integer(json,"sizeBytes");
            if(minimum<23 || minimum>Integer.MAX_VALUE)throw new UpdateFailure();
            UpdateInfo info=new UpdateInfo(string(json,"packageName"),string(json,"versionName"),code,(int)minimum,string(json,"apkUrl"),string(json,"sha256"),size,string(json,"notes"));
            validate(info,false);return info;
        } catch(UpdateFailure error) {throw error;} catch(Exception error) {throw new UpdateFailure();}
    }
    private static void requireFlatObject(String text) throws UpdateFailure {
        boolean quoted=false,escaped=false,finished=false;int depth=0;
        for(int i=0;i<text.length();i++) {
            char c=text.charAt(i);
            if(quoted) {
                if(escaped)escaped=false;
                else if(c=='\\')escaped=true;
                else if(c=='"')quoted=false;
            } else if(c=='"') {if(depth!=1)throw new UpdateFailure();quoted=true;}
            else if(c=='{') {if(depth!=0 || finished)throw new UpdateFailure();depth=1;}
            else if(c=='}') {if(depth!=1)throw new UpdateFailure();depth=0;finished=true;}
            else if(c=='[' || c==']')throw new UpdateFailure();
            else if(depth==0 && c!=' ' && c!='\n' && c!='\r' && c!='\t')throw new UpdateFailure();
        }
        if(quoted || depth!=0 || !finished)throw new UpdateFailure();
    }
    private static String string(JSONObject json,String key) throws Exception {Object value=json.get(key);if(!(value instanceof String))throw new UpdateFailure();return (String)value;}
    private static long integer(JSONObject json,String key) throws Exception {Object value=json.get(key);if(!(value instanceof Integer) && !(value instanceof Long))throw new UpdateFailure();return ((Number)value).longValue();}

    void validate(UpdateInfo info,boolean requireNewer) throws UpdateFailure {
        if(info==null || !packageName.equals(info.packageName) || installedVersion<1 || sdk<23 ||
            info.versionName==null || !info.versionName.matches("[0-9]{1,4}(?:\\.[0-9]{1,4}){1,3}") ||
            info.versionCode<1 || info.versionCode>Integer.MAX_VALUE || (requireNewer && info.versionCode<=installedVersion) ||
            info.minSdk<23 || info.minSdk>sdk || info.sizeBytes<1 || info.sizeBytes>MAX_APK_BYTES ||
            info.sha256==null || !info.sha256.matches("[0-9a-f]{64}") ||
            !("https://flixify.vip/downloads/flixify-pro-"+info.versionName+".apk").equals(info.apkUrl) ||
            info.notes==null || info.notes.length()>2048)throw new UpdateFailure();
        for(int i=0;i<info.notes.length();i++)if(Character.isISOControl(info.notes.charAt(i)) && info.notes.charAt(i)!='\n')throw new UpdateFailure();
    }
    void verifyIdentity(UpdateInfo info,String archivePackage,String archiveName,long archiveVersion,int archiveMinSdk,byte[][] installedSigners,byte[][] archiveSigners) throws UpdateFailure {
        validate(info,true);
        if(!info.packageName.equals(archivePackage) || !info.versionName.equals(archiveName) || archiveVersion!=info.versionCode || archiveMinSdk!=info.minSdk || archiveMinSdk>sdk)throw new UpdateFailure();
        String[] installed=signers(installedSigners),archive=signers(archiveSigners);
        if(!Arrays.equals(installed,archive))throw new UpdateFailure();
    }
    private static String[] signers(byte[][] values) throws UpdateFailure {
        if(values==null || values.length==0 || values.length>8)throw new UpdateFailure();
        String[] result=new String[values.length];
        try {
            for(int i=0;i<values.length;i++){if(values[i]==null || values[i].length==0 || values[i].length>32768)throw new UpdateFailure();result[i]=hex(MessageDigest.getInstance("SHA-256").digest(values[i]));}
        }catch(UpdateFailure error){throw error;}catch(Exception error){throw new UpdateFailure();}
        Arrays.sort(result);for(int i=1;i<result.length;i++)if(result[i].equals(result[i-1]))throw new UpdateFailure();return result;
    }
    static String hex(byte[] bytes) {StringBuilder result=new StringBuilder(bytes.length*2);for(byte b:bytes){result.append(Character.forDigit((b>>>4)&15,16));result.append(Character.forDigit(b&15,16));}return result.toString();}
}
