package vip.flixify.tv;

import android.content.Context;
import android.view.KeyEvent;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class RemoteEditTextTest {
    private RemoteEditText input(boolean hidden){Context context=ApplicationProvider.getApplicationContext();return new RemoteEditText(context){@Override protected boolean imeHidden(){return hidden;}};}
    @Test public void hiddenImeArrowUsesTheExistingNavigationBeforeTheInputMethod(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{RemoteEditText input=input(true);AtomicInteger calls=new AtomicInteger();input.setOnKeyListener((v,key,event)->{calls.incrementAndGet();return true;});for(int key:new int[]{KeyEvent.KEYCODE_DPAD_UP,KeyEvent.KEYCODE_DPAD_DOWN})assertTrue(input.onKeyPreIme(key,new KeyEvent(KeyEvent.ACTION_DOWN,key)));assertEquals(2,calls.get());});}
    @Test public void visibleKeyboardKeepsArrowsWhileNormalDispatchStillWorks(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{RemoteEditText input=input(false);AtomicInteger calls=new AtomicInteger();input.setOnKeyListener((v,key,event)->{calls.incrementAndGet();return true;});KeyEvent event=new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_DOWN);assertFalse(input.onKeyPreIme(event.getKeyCode(),event));assertEquals(0,calls.get());assertTrue(input.dispatchKeyEvent(event));assertEquals(1,calls.get());});}
    @Test public void typingBackOkAndArrowReleaseDoNotEnterPreImeNavigation(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{RemoteEditText input=input(true);AtomicInteger calls=new AtomicInteger();input.setOnKeyListener((v,key,event)->{calls.incrementAndGet();return true;});for(int key:new int[]{KeyEvent.KEYCODE_A,KeyEvent.KEYCODE_BACK,KeyEvent.KEYCODE_DPAD_CENTER})input.onKeyPreIme(key,new KeyEvent(KeyEvent.ACTION_DOWN,key));input.onKeyPreIme(KeyEvent.KEYCODE_DPAD_DOWN,new KeyEvent(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_DOWN));assertEquals(0,calls.get());});}
    @Test public void AnUnconfiguredDirectionIsNotSilentlyConsumed(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{RemoteEditText input=input(true);input.setOnKeyListener((v,key,event)->false);assertFalse(input.onKeyPreIme(KeyEvent.KEYCODE_DPAD_DOWN,new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_DOWN)));});}
}
