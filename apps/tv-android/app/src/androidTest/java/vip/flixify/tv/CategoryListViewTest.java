package vip.flixify.tv;

import android.content.Context;
import android.view.KeyEvent;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CategoryListViewTest {
    private CategoryListView list(AtomicBoolean ready,AtomicInteger commits){Context context=ApplicationProvider.getApplicationContext();return new CategoryListView(context){@Override protected boolean confirmationReady(){return ready.get();}@Override protected void confirmSelection(){commits.incrementAndGet();}};}
    private KeyEvent key(int action,int code){return new KeyEvent(action,code);}
    @Test public void pairedConfirmationCommitsExactlyOnceOnRelease(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{AtomicInteger commits=new AtomicInteger();CategoryListView list=list(new AtomicBoolean(true),commits);assertTrue(list.onKeyPreIme(KeyEvent.KEYCODE_DPAD_CENTER,key(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_CENTER)));assertEquals(0,commits.get());assertTrue(list.onKeyPreIme(KeyEvent.KEYCODE_DPAD_CENTER,new KeyEvent(1,2,KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_DPAD_CENTER,1)));assertTrue(list.onKeyPreIme(KeyEvent.KEYCODE_DPAD_CENTER,key(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_CENTER)));assertEquals(1,commits.get());list.onKeyPreIme(KeyEvent.KEYCODE_DPAD_CENTER,key(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_DPAD_CENTER));assertEquals(1,commits.get());});}
    @Test public void visibleOrUnreadyListLeavesConfirmationToNormalDispatch(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{AtomicInteger commits=new AtomicInteger();CategoryListView list=list(new AtomicBoolean(false),commits);assertFalse(list.onKeyPreIme(KeyEvent.KEYCODE_ENTER,key(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_ENTER)));assertFalse(list.onKeyPreIme(KeyEvent.KEYCODE_ENTER,key(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_ENTER)));assertEquals(0,commits.get());});}
    @Test public void canceledPressOrChangedReadinessCannotCommit(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{AtomicInteger commits=new AtomicInteger();AtomicBoolean ready=new AtomicBoolean(true);CategoryListView list=list(ready,commits);list.onKeyPreIme(KeyEvent.KEYCODE_ENTER,key(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_ENTER));KeyEvent canceled=KeyEvent.changeFlags(key(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_ENTER),KeyEvent.FLAG_CANCELED);assertTrue(list.onKeyPreIme(KeyEvent.KEYCODE_ENTER,canceled));assertEquals(0,commits.get());list.onKeyPreIme(KeyEvent.KEYCODE_ENTER,key(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_ENTER));ready.set(false);assertTrue(list.onKeyPreIme(KeyEvent.KEYCODE_ENTER,key(KeyEvent.ACTION_UP,KeyEvent.KEYCODE_ENTER)));assertEquals(0,commits.get());});}
    @Test public void otherKeysNeverTriggerCategoryConfirmation(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{AtomicInteger commits=new AtomicInteger();CategoryListView list=list(new AtomicBoolean(true),commits);for(int key:new int[]{KeyEvent.KEYCODE_BACK,KeyEvent.KEYCODE_A,KeyEvent.KEYCODE_DPAD_DOWN}){list.onKeyPreIme(key,key(KeyEvent.ACTION_DOWN,key));list.onKeyPreIme(key,key(KeyEvent.ACTION_UP,key));}assertEquals(0,commits.get());});}
}
