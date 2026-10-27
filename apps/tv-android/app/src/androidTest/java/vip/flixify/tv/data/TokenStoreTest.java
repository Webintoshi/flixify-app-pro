package vip.flixify.tv.data;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TokenStoreTest {
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
        context.getSharedPreferences("tv_encrypted_session",Context.MODE_PRIVATE).edit().putString("session","AAAA").commit();
        assertNull(store.load()); assertEquals(installation,store.installationId());
    }
}
