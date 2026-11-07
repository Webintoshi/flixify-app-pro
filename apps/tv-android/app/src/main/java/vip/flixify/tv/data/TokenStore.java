package vip.flixify.tv.data;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.Key;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/** Android 6+ device-bound AES-GCM storage. Provider credentials must never be passed here. */
final class TokenStore {
    private static final String ALIAS="flixify.tv.session.v1";
    private static final Object KEY_LOCK=new Object();
    private final SharedPreferences preferences;
    enum Stage {
        KEY_LOAD("G01"),KEY_CREATE("G02"),ENCRYPT("G03"),PERSIST("G04");
        final String code;
        Stage(String code){this.code=code;}
    }
    enum Reason {UNAVAILABLE,INCOMPATIBLE_KEY,INVALID_OUTPUT,WRITE_FAILED}
    static final class StorageException extends Exception {
        final String code;final Stage stage;final Reason reason;
        StorageException(Stage stage,Reason reason){super(stage.code);this.code=stage.code;this.stage=stage;this.reason=reason;}
    }
    private static final class KeyMaterial {
        final SecretKey key;final boolean existing;
        KeyMaterial(SecretKey key,boolean existing){this.key=key;this.existing=existing;}
    }
    static final class Session {
        final String accessToken,refreshToken,accountId,codeSuffix;
        Session(String accessToken,String refreshToken,String accountId,String codeSuffix) {
            this.accessToken=accessToken;this.refreshToken=refreshToken;this.accountId=accountId;this.codeSuffix=codeSuffix;
        }
    }
    TokenStore(Context context) {preferences=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE);}
    private KeyMaterial key() throws StorageException {
        try {
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            if(store.containsAlias(ALIAS)) {
                Key stored=store.getKey(ALIAS,null);
                if(stored==null)throw new StorageException(Stage.KEY_LOAD,Reason.UNAVAILABLE);
                if(!(stored instanceof SecretKey) || !KeyProperties.KEY_ALGORITHM_AES.equals(stored.getAlgorithm()))throw new StorageException(Stage.KEY_LOAD,Reason.INCOMPATIBLE_KEY);
                return new KeyMaterial((SecretKey)stored,true);
            }
        }catch(StorageException safe){throw safe;}
        catch(Exception unavailable){throw new StorageException(Stage.KEY_LOAD,Reason.UNAVAILABLE);}
        try {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).build());
            return new KeyMaterial(generator.generateKey(),false);
        }catch(Exception unavailable){throw new StorageException(Stage.KEY_CREATE,Reason.UNAVAILABLE);}
    }
    synchronized Session load() {
        synchronized(KEY_LOCK) {
        try {
            String encoded=preferences.getString("session",null);if(encoded==null)return null;
            if(encoded.length()>100000)throw new Exception();
            String[] parts=encoded.split("\\.",-1);if(parts.length!=2)throw new Exception();
            byte[] iv=Base64.decode(parts[0],Base64.NO_WRAP),ciphertext=Base64.decode(parts[1],Base64.NO_WRAP);if(iv.length!=12)throw new Exception();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key().key,new GCMParameterSpec(128,iv));
            cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            JSONObject raw=new JSONObject(new String(cipher.doFinal(ciphertext),StandardCharsets.UTF_8));
            return new Session(ProviderParser.secret(raw.opt("access"),16384),ProviderParser.secret(raw.opt("refresh"),16384),ProviderParser.secret(raw.opt("account"),256),ProviderParser.text(raw.opt("suffix"),4));
        }catch(Exception ignored){clear();return null;}
        }
    }
    synchronized void save(Session session) throws StorageException {
        synchronized(KEY_LOCK) {
            final String record;
            try {record=encryptedRecord(session);}
            catch(StorageException failure) {
                if(failure.reason!=Reason.INCOMPATIBLE_KEY)throw failure;
                replaceUnusableKey();
                persist(encryptedRecord(session));return;
            }
            persist(record);
        }
    }
    private String encryptedRecord(Session session) throws StorageException {
        KeyMaterial material=null;byte[] plaintext=null,verified=null;
        try {
            material=key();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,material.key);cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            JSONObject raw=new JSONObject().put("access",session.accessToken).put("refresh",session.refreshToken).put("account",session.accountId).put("suffix",session.codeSuffix);
            plaintext=raw.toString().getBytes(StandardCharsets.UTF_8);byte[] encrypted=cipher.doFinal(plaintext),iv=cipher.getIV();
            if(iv==null || iv.length!=12 || encrypted.length<16)throw new StorageException(Stage.ENCRYPT,Reason.INVALID_OUTPUT);
            Cipher verification=Cipher.getInstance("AES/GCM/NoPadding");verification.init(Cipher.DECRYPT_MODE,material.key,new GCMParameterSpec(128,iv));verification.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            verified=verification.doFinal(encrypted);
            if(!MessageDigest.isEqual(plaintext,verified))throw new StorageException(Stage.ENCRYPT,Reason.INVALID_OUTPUT);
            return Base64.encodeToString(iv,Base64.NO_WRAP)+"."+Base64.encodeToString(encrypted,Base64.NO_WRAP);
        }catch(StorageException safe){throw safe;}
        catch(InvalidKeyException rejected){throw new StorageException(Stage.ENCRYPT,material!=null && material.existing && demonstrablyUnusable(material.key,rejected)?Reason.INCOMPATIBLE_KEY:Reason.UNAVAILABLE);}
        catch(Exception unavailable){throw new StorageException(Stage.ENCRYPT,Reason.UNAVAILABLE);}
        finally {if(plaintext!=null)Arrays.fill(plaintext,(byte)0);if(verified!=null)Arrays.fill(verified,(byte)0);}
    }
    private boolean demonstrablyUnusable(SecretKey key,InvalidKeyException rejected) {
        if(rejected instanceof UserNotAuthenticatedException)return false;
        if(rejected instanceof KeyPermanentlyInvalidatedException)return true;
        try {
            KeyInfo info=(KeyInfo)SecretKeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").getKeySpec(key,KeyInfo.class);
            if(info.isUserAuthenticationRequired())return false;
            int required=KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT;
            return (info.getPurposes()&required)!=required || !contains(info.getBlockModes(),KeyProperties.BLOCK_MODE_GCM) || !contains(info.getEncryptionPaddings(),KeyProperties.ENCRYPTION_PADDING_NONE);
        }catch(Exception unavailable){return false;}
    }
    private boolean contains(String[] values,String expected){for(String value:values)if(expected.equals(value))return true;return false;}
    private void replaceUnusableKey() throws StorageException {
        try {if(!preferences.edit().remove("session").commit())throw new StorageException(Stage.PERSIST,Reason.WRITE_FAILED);}
        catch(StorageException safe){throw safe;}
        catch(RuntimeException unavailable){throw new StorageException(Stage.PERSIST,Reason.WRITE_FAILED);}
        try {KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(ALIAS);}
        catch(Exception unavailable){throw new StorageException(Stage.KEY_LOAD,Reason.UNAVAILABLE);}
    }
    private void persist(String record) throws StorageException {
        try {if(!preferences.edit().putString("session",record).commit())throw new StorageException(Stage.PERSIST,Reason.WRITE_FAILED);}
        catch(StorageException safe){discardFailedWrite();throw safe;}
        catch(RuntimeException unavailable){discardFailedWrite();throw new StorageException(Stage.PERSIST,Reason.WRITE_FAILED);}
    }
    private void discardFailedWrite(){try{preferences.edit().remove("session").apply();}catch(RuntimeException ignored){}}
    synchronized void clear() {synchronized(KEY_LOCK){preferences.edit().remove("session").apply();}}
    synchronized String installationId() {
        String value=preferences.getString("installation","");
        if(!value.matches("[A-Za-z0-9_-]{16,128}")){value="tv-"+UUID.randomUUID().toString();preferences.edit().putString("installation",value).apply();}
        return value;
    }
}
