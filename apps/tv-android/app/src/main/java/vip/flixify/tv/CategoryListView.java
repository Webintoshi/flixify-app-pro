package vip.flixify.tv;

import android.content.Context;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.widget.ListAdapter;
import android.widget.ListView;

/** Confirm the focused category before a hidden TV IME can consume its first OK. */
class CategoryListView extends ListView {
    private int confirmingKey=KeyEvent.KEYCODE_UNKNOWN;
    CategoryListView(Context context){super(context);}
    protected boolean confirmationReady(){
        if(Build.VERSION.SDK_INT<30 || !hasFocus() || !hasWindowFocus() || !isEnabled() || isInTouchMode())return false;
        WindowInsets insets=getRootWindowInsets();ListAdapter adapter=getAdapter();int index=getSelectedItemPosition();View row=getSelectedView();
        return insets!=null && !insets.isVisible(WindowInsets.Type.ime()) && adapter!=null && index>=0 && index<adapter.getCount() && adapter.isEnabled(index) && row!=null && row.isShown();
    }
    protected void confirmSelection(){int index=getSelectedItemPosition();performItemClick(getSelectedView(),index,getAdapter().getItemId(index));}
    @Override public boolean onKeyPreIme(int keyCode,KeyEvent event){
        if(keyCode!=KeyEvent.KEYCODE_DPAD_CENTER && keyCode!=KeyEvent.KEYCODE_ENTER && keyCode!=KeyEvent.KEYCODE_NUMPAD_ENTER)return super.onKeyPreIme(keyCode,event);
        if(event.getAction()==KeyEvent.ACTION_DOWN){
            if(event.getRepeatCount()==0)confirmingKey=confirmationReady()?keyCode:KeyEvent.KEYCODE_UNKNOWN;
            if(confirmingKey==keyCode)return true;
        }else if(event.getAction()==KeyEvent.ACTION_UP && confirmingKey==keyCode){
            confirmingKey=KeyEvent.KEYCODE_UNKNOWN;
            if(!event.isCanceled() && confirmationReady())confirmSelection();
            return true;
        }
        return super.onKeyPreIme(keyCode,event);
    }
    @Override protected void onFocusChanged(boolean focused,int direction,android.graphics.Rect previous){if(!focused)confirmingKey=KeyEvent.KEYCODE_UNKNOWN;super.onFocusChanged(focused,direction,previous);}
}
