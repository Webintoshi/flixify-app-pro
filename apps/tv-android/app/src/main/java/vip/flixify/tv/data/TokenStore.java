package vip.flixify.tv.data;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android 6+ device-bound AES-GCM storage. Provider credentials must never be passed here. */
final class TokenStore {
    private static final String ALIAS="flixify.tv.session.v1";
    private final SharedPreferences preferences;
    static final class Session {
        final String accessToken,refreshToken,accountId,codeSuffix;
        Session(String accessToken,String refreshToken,String accountId,String codeSuffix) {
            this.accessToken=accessToken;this.refreshToken=refreshToken;this.accountId=accountId;this.codeSuffix=codeSuffix;
        }
    }
    TokenStore(Context context) {preferences=context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE);}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    synchronized Session load() {
        try {
            String encoded=preferences.getString("session",null);if(encoded==null)return null;
            if(encoded.length()>100000)throw new Exception();
            String[] parts=encoded.split("\\.",-1);if(parts.length!=2)throw new Exception();
            byte[] iv=Base64.decode(parts[0],Base64.NO_WRAP),ciphertext=Base64.decode(parts[1],Base64.NO_WRAP);if(iv.length!=12)throw new Exception();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
            cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            JSONObject raw=new JSONObject(new String(cipher.doFinal(ciphertext),StandardCharsets.UTF_8));
            return new Session(ProviderParser.secret(raw.opt("access"),16384),ProviderParser.secret(raw.opt("refresh"),16384),ProviderParser.secret(raw.opt("account"),256),ProviderParser.text(raw.opt("suffix"),4));
        }catch(Exception ignored){clear();return null;}
    }
    synchronized void save(Session session) throws Exception {
        // Fail closed: there is no plaintext or software-key fallback.
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
        JSONObject raw=new JSONObject().put("access",session.accessToken).put("refresh",session.refreshToken).put("account",session.accountId).put("suffix",session.codeSuffix);
        byte[] encrypted=cipher.doFinal(raw.toString().getBytes(StandardCharsets.UTF_8));
        String record=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+"."+Base64.encodeToString(encrypted,Base64.NO_WRAP);
        if(!preferences.edit().putString("session",record).commit())throw new Exception("Encrypted session unavailable");
    }
    synchronized void clear() {preferences.edit().remove("session").apply();}
    synchronized String installationId() {
        String value=preferences.getString("installation","");
        if(!value.matches("[A-Za-z0-9_-]{16,128}")){value="tv-"+UUID.randomUUID().toString();preferences.edit().putString("installation",value).apply();}
        return value;
    }
}
