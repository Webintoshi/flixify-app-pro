package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;

import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DeviceLoginRemoteTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private MainActivity activity;private FakeTvRepository repository;private Attempt attempt;
    private static final class Attempt implements DeviceLogin.Attempt {
        int cancelled;String png;
        Attempt(){Bitmap image=Bitmap.createBitmap(128,128,Bitmap.Config.ARGB_8888);image.eraseColor(android.graphics.Color.WHITE);ByteArrayOutputStream out=new ByteArrayOutputStream();image.compress(Bitmap.CompressFormat.PNG,100,out);png=Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);image.recycle();}
        public DeviceLogin.Display display(){return new DeviceLogin.Display("BCDF-GHJK",png,180,2);}
        public void poll(TvRepository.Callback<DeviceLogin.Poll> callback){callback.onResult(new DeviceLogin.Poll("pending",2));}
        public void adopt(DeviceLogin.AdoptionGuard allowed,TvRepository.Callback<Void> callback){throw new AssertionError("No approval in fixture");}
        public void ack(TvRepository.Callback<Void> callback){throw new AssertionError("No approval in fixture");}
        public void cancel(){cancelled++;}
    }
    @Before public void launch(){repository=new FakeTvRepository();attempt=new Attempt();repository.pairingAttempt=attempt;instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));instrumentation.waitForIdleSync();}
    @After public void close(){if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));}
    private View text(View root,String value){if(root.getVisibility()!=View.VISIBLE)return null;if(root instanceof TextView && value.contentEquals(((TextView)root).getText()))return root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View found=text(((ViewGroup)root).getChildAt(i),value);if(found!=null)return found;}return null;}
    private void key(int value){instrumentation.sendKeyDownUpSync(value);instrumentation.waitForIdleSync();}
    @Test public void qrAndManualLoginAreVisibleAndRemoteCanRenewWithoutKeyboard(){
        instrumentation.runOnMainSync(()->{assertNotNull(text(activity.getWindow().getDecorView(),"BCDF-GHJK"));assertTrue(activity.getCurrentFocus() instanceof EditText);});
        key(KeyEvent.KEYCODE_DPAD_LEFT);instrumentation.runOnMainSync(()->assertEquals("QR kodunu yenile",((TextView)activity.getCurrentFocus()).getText().toString()));key(KeyEvent.KEYCODE_DPAD_CENTER);
        assertEquals(2,repository.pairingStarts);assertEquals(1,attempt.cancelled);
        key(KeyEvent.KEYCODE_DPAD_RIGHT);instrumentation.runOnMainSync(()->assertTrue(activity.getCurrentFocus() instanceof EditText));key(KeyEvent.KEYCODE_DPAD_DOWN);instrumentation.runOnMainSync(()->assertEquals("Giriş yap",((TextView)activity.getCurrentFocus()).getText().toString()));
    }
    @Test public void manualSubmissionInvalidatesPendingQrBeforeSigningIn(){
        instrumentation.runOnMainSync(()->((EditText)activity.getCurrentFocus()).setText("1234567890123456"));
        key(KeyEvent.KEYCODE_DPAD_DOWN);
        instrumentation.runOnMainSync(()->assertEquals("Giriş yap",((TextView)activity.getCurrentFocus()).getText().toString()));
        key(KeyEvent.KEYCODE_DPAD_CENTER);
        assertEquals(1,attempt.cancelled);
        instrumentation.runOnMainSync(()->{assertTrue(repository.hasSession());assertNotNull("Existing welcome/access flow reaches catalogue",text(activity.getWindow().getDecorView(),"Uzay Yolculuğu"));});
    }
}
