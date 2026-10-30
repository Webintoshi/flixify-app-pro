package vip.flixify.tv.update;

import org.json.JSONObject;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    private final UpdatePolicy policy=new UpdatePolicy("vip.flixify.tv",7,35);
    private JSONObject manifest() throws Exception {return new JSONObject().put("packageName","vip.flixify.tv").put("versionName","1.4.0").put("versionCode",8).put("minSdk",23).put("apkUrl","https://flixify.vip/downloads/flixify-pro-1.4.0.apk").put("sha256",new String(new char[64]).replace('\0','a')).put("sizeBytes",1024).put("notes","Cihaz önbelleği ve güncellemeler.");}
    private UpdateInfo parse(JSONObject json) throws Exception {return policy.parse(json.toString().getBytes(StandardCharsets.UTF_8));}
    private interface Work {void run() throws Exception;}
    private void rejects(Work work) throws Exception {try{work.run();fail("Unsafe update accepted");}catch(UpdateFailure expected){assertFalse(expected.getMessage().contains("https://"));}}
    @Test public void parsesOwnNewCompatibleVersionWithAllPublishedFields() throws Exception {UpdateInfo info=parse(manifest());assertEquals("1.4.0",info.versionName);assertEquals(8,info.versionCode);assertEquals(1024,info.sizeBytes);assertEquals(23,info.minSdk);assertEquals("Cihaz önbelleği ve güncellemeler.",info.notes);}
    @Test public void sameAndOlderVersionsRemainValidMetadataButCannotDownload() throws Exception {for(int code:new int[]{6,7}){UpdateInfo info=parse(manifest().put("versionCode",code));rejects(()->policy.validate(info,true));}}
    @Test public void rejectsForeignPackageUnsupportedSdkAndWrongNumberTypes() throws Exception {rejects(()->parse(manifest().put("packageName","other.app")));rejects(()->parse(manifest().put("minSdk",36)));for(String key:new String[]{"versionCode","minSdk","sizeBytes"}){rejects(()->parse(manifest().put(key,"8")));rejects(()->parse(manifest().put(key,8.5)));}}
    @Test public void rejectsOversizeMissingTrailingAndMalformedManifest() throws Exception {rejects(()->policy.parse(new byte[UpdatePolicy.MAX_MANIFEST_BYTES+1]));rejects(()->parse(manifest().put("notes",JSONObject.NULL)));rejects(()->policy.parse((manifest()+" {}").getBytes(StandardCharsets.UTF_8)));rejects(()->policy.parse(new byte[]{(byte)0xc3,0x28}));}
    @Test public void rejectsNonOwnedNonVersionedAndCredentialUrls() throws Exception {for(String url:new String[]{"http://flixify.vip/downloads/flixify-pro-1.4.0.apk","https://evil.test/downloads/flixify-pro-1.4.0.apk","https://flixify.vip.evil.test/downloads/flixify-pro-1.4.0.apk","https://u:p@flixify.vip/downloads/flixify-pro-1.4.0.apk","https://flixify.vip/downloads/flixify-pro-1.4.0.apk?token=secret","https://flixify.vip/downloads/flixify-pro-1.4.0.apk#x","https://flixify.vip/downloads/latest.apk","https://flixify.vip/downloads/../downloads/flixify-pro-1.4.0.apk","https://flixify.vip/downloads/flixify-pro-1.4.1.apk"})rejects(()->parse(manifest().put("apkUrl",url)));}
    @Test public void rejectsMissingHashInvalidSizeAndControlNotes() throws Exception {for(String hash:new String[]{"", "abc",new String(new char[64]).replace('\0','g')})rejects(()->parse(manifest().put("sha256",hash)));for(long size:new long[]{0,-1,UpdatePolicy.MAX_APK_BYTES+1})rejects(()->parse(manifest().put("sizeBytes",size)));rejects(()->parse(manifest().put("notes","hidden\u0000value")));}
    @Test public void acceptsExactInstalledSignerAndExactArtifactIdentity() throws Exception {UpdateInfo info=parse(manifest());policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",8,23,new byte[][]{{1,2,3}},new byte[][]{{1,2,3}});}
    @Test public void refusesWrongSignerMissingSignerDowngradeAndMetadataMismatch() throws Exception {UpdateInfo info=parse(manifest());byte[][] signer={{1,2,3}};rejects(()->policy.verifyIdentity(info,"other.app","1.4.0",8,23,signer,signer));rejects(()->policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",7,23,signer,signer));rejects(()->policy.verifyIdentity(info,"vip.flixify.tv","1.4.1",8,23,signer,signer));rejects(()->policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",8,36,signer,signer));rejects(()->policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",8,23,signer,new byte[][]{{4}}));rejects(()->policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",8,23,signer,new byte[0][]));}
    @Test public void acceptsSameMultipleSignersInDifferentOrderButNotASubset() throws Exception {UpdateInfo info=parse(manifest());byte[][] both={{1},{2}};policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",8,23,both,new byte[][]{{2},{1}});rejects(()->policy.verifyIdentity(info,"vip.flixify.tv","1.4.0",8,23,both,new byte[][]{{1}}));}
    @Test public void deeplyNestedManifestInsideByteLimitIsRejectedWithoutStackOverflow() throws Exception {
        StringBuilder nested=new StringBuilder("{\"notes\":");for(int i=0;i<6000;i++)nested.append('[');nested.append('0');for(int i=0;i<6000;i++)nested.append(']');nested.append('}');
        byte[] bytes=nested.toString().getBytes(StandardCharsets.UTF_8);assertTrue(bytes.length<UpdatePolicy.MAX_MANIFEST_BYTES);
        try{rejects(()->policy.parse(bytes));}catch(StackOverflowError error){fail("Bounded updater manifest overflowed JSONTokener");}
    }
    @Test public void flatManifestAllowsBracesBracketsEscapedQuotesAndBackslashesInNotes() throws Exception {
        String notes="Seçenekler {film} [dizi], \"alıntı\", C:\\TV\\; yeni satır\nİkinci satır";
        assertEquals(notes,parse(manifest().put("notes",notes)).notes);
    }
    @Test public void rejectsNestedObjectArrayAndNullInsteadOfScalarFields() throws Exception {
        rejects(()->parse(manifest().put("notes",new JSONObject().put("hidden",1))));
        rejects(()->policy.parse(manifest().toString().replace("\"notes\":\"Cihaz önbelleği ve güncellemeler.\"","\"notes\":[null]").getBytes(StandardCharsets.UTF_8)));
        rejects(()->parse(manifest().put("versionCode",JSONObject.NULL)));
    }

}
