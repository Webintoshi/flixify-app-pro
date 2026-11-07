package vip.flixify.tv.data;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Proxy;
import java.security.InvalidKeyException;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TokenStoreTest {
    private static final String OWNED_ALIAS="flixify.tv.session.v1";
    private void deleteOwnedAlias() throws Exception {
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(OWNED_ALIAS);
    }
    private TokenStore refusingCommits(Context context) {
        SharedPreferences preferences=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE);
        SharedPreferences failing=(SharedPreferences)Proxy.newProxyInstance(SharedPreferences.class.getClassLoader(),new Class<?>[]{SharedPreferences.class},(proxy,method,args)->{
            if(!method.getName().equals("edit"))return method.invoke(preferences,args);
            SharedPreferences.Editor editor=preferences.edit();
            return Proxy.newProxyInstance(SharedPreferences.Editor.class.getClassLoader(),new Class<?>[]{SharedPreferences.Editor.class},(editorProxy,operation,values)->{
                if(operation.getName().equals("commit")){editor.commit();return false;}
                Object result=operation.invoke(editor,values);return result instanceof SharedPreferences.Editor?editorProxy:result;
            });
        });
        return new TokenStore(new ContextWrapper(context){@Override public SharedPreferences getSharedPreferences(String name,int mode){return name.equals("tv_encrypted_session")?failing:super.getSharedPreferences(name,mode);}});
    }
    @Test public void incompatibleOwnedKeyIsReplacedWithGcmWithoutChangingInstallation() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();TokenStore store=new TokenStore(context);
        String installation=store.installationId();store.clear();deleteOwnedAlias();
        try {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(OWNED_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_CBC).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_PKCS7)
                    .setRandomizedEncryptionRequired(true).build());
            SecretKey incompatible=generator.generateKey();
            Cipher gcm=Cipher.getInstance("AES/GCM/NoPadding");
            assertThrows("Fixture key forbids the required GCM mode",InvalidKeyException.class,()->gcm.init(Cipher.ENCRYPT_MODE,incompatible));
            store.save(new TokenStore.Session("private-access-token","private-refresh-token","fixture-account","1234"));
            assertEquals("private-access-token",store.load().accessToken);
            assertEquals("private-refresh-token",store.load().refreshToken);
            assertEquals(installation,store.installationId());
            String disk=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE).getAll().toString();
            assertFalse(disk.contains("private-access-token"));assertFalse(disk.contains("private-refresh-token"));
        } finally {store.clear();deleteOwnedAlias();}
    }
    @Test public void wrongTypeOwnedKeyIsReplacedWithoutChangingInstallation() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();TokenStore store=new TokenStore(context);
        String installation=store.installationId();store.clear();deleteOwnedAlias();
        try {
            KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(OWNED_ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
                    .setDigests(KeyProperties.DIGEST_SHA256).setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1).build());
            generator.generateKeyPair();
            store.save(new TokenStore.Session("private-access-token","private-refresh-token","fixture-account","1234"));
            assertEquals("private-access-token",store.load().accessToken);assertEquals(installation,store.installationId());
        } finally {store.clear();deleteOwnedAlias();}
    }
    @Test public void savingAnotherSessionKeepsTheHealthyKey() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();TokenStore store=new TokenStore(context);store.clear();
        SharedPreferences preferences=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE);
        store.save(new TokenStore.Session("first-access","first-refresh","fixture-account","1234"));String original=preferences.getString("session",null);
        store.save(new TokenStore.Session("second-access","second-refresh","fixture-account","1234"));assertEquals("second-access",store.load().accessToken);
        assertTrue(preferences.edit().putString("session",original).commit());assertEquals("first-access",store.load().accessToken);
        store.clear();
    }
    @Test public void failedCommitIsTypedAndDoesNotReplaceTheHealthyKeyOrInstallation() throws Exception {
        Context context=ApplicationProvider.getApplicationContext();TokenStore store=new TokenStore(context);store.clear();
        SharedPreferences preferences=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE);String installation=store.installationId();
        store.save(new TokenStore.Session("first-access","first-refresh","fixture-account","1234"));String original=preferences.getString("session",null);store.clear();
        TokenStore failing=refusingCommits(context);
        TokenStore.StorageException failure=assertThrows(TokenStore.StorageException.class,()->failing.save(new TokenStore.Session("second-access","second-refresh","fixture-account","1234")));
        assertEquals("G04",failure.code);assertEquals(TokenStore.Stage.PERSIST,failure.stage);assertEquals(TokenStore.Reason.WRITE_FAILED,failure.reason);
        assertEquals("G04",failure.getMessage());assertNull(failure.getCause());assertNull(store.load());assertEquals(installation,failing.installationId());
        assertTrue(preferences.edit().putString("session",original).commit());assertEquals("first-access",store.load().accessToken);store.clear();
    }
    @Test public void tokensRoundTripOnlyThroughKeystoreCiphertext() throws Exception {
        Context context=ApplicationProvider.getApplicationContext(); TokenStore store=new TokenStore(context); store.clear();
        store.save(new TokenStore.Session("private-access-token", "private-refresh-token", "fixture-account", "1234"));
        assertEquals("private-access-token",store.load().accessToken);
        assertEquals("private-refresh-token",store.load().refreshToken);
        String disk=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE).getAll().toString();
        assertFalse(disk.contains("private-access-token")); assertFalse(disk.contains("private-refresh-token"));
        store.clear(); assertNull(store.load());
    }
    @Test public void tamperedCiphertextFailsClosedAndInstallationIdSurvivesLogout() throws Exception {
        Context context=ApplicationProvider.getApplicationContext(); TokenStore store=new TokenStore(context); String installation=store.installationId();
        store.save(new TokenStore.Session("private-access-token", "private-refresh-token", "fixture-account", "1234"));
        String original=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE).getString("session",null);
        String[] parts=original.split("\\.",-1);byte[] tampered=Base64.decode(parts[1],Base64.NO_WRAP);tampered[0]^=1;
        context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE).edit().putString("session",parts[0]+"."+Base64.encodeToString(tampered,Base64.NO_WRAP)).commit();
        assertNull(store.load()); assertEquals(installation,store.installationId());
        assertTrue(context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE).edit().putString("session",original).commit());
        assertEquals("private-access-token",store.load().accessToken);store.clear();
    }
}
