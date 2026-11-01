package vip.flixify.tv;

import android.content.Context;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.widget.EditText;

/** A hidden TV keyboard can retain its input connection and consume the first remote arrow. */
class RemoteEditText extends EditText {
    private View.OnKeyListener navigation;
    RemoteEditText(Context context){super(context);}
    @Override public void setOnKeyListener(View.OnKeyListener listener){navigation=listener;super.setOnKeyListener(listener);}
    protected boolean imeHidden(){
        if(Build.VERSION.SDK_INT<30)return false;
        WindowInsets insets=getRootWindowInsets();
        return insets!=null && !insets.isVisible(WindowInsets.Type.ime());
    }
    @Override public boolean onKeyPreIme(int keyCode,KeyEvent event){
        if(event.getAction()==KeyEvent.ACTION_DOWN && (keyCode==KeyEvent.KEYCODE_DPAD_DOWN || keyCode==KeyEvent.KEYCODE_DPAD_UP) && imeHidden() && navigation!=null && navigation.onKey(this,keyCode,event))return true;
        return super.onKeyPreIme(keyCode,event);
    }
}
