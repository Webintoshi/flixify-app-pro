package vip.flixify.tv;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Shared TV-sized native controls. Focus always has both a bright outline and a fill. */
final class TvUi {
    static final int BACKGROUND=Color.rgb(7,9,12), PANEL=Color.rgb(19,23,30), ACCENT=Color.rgb(255,53,69);
    static final int WHITE=Color.rgb(245,246,248), MUTED=Color.rgb(167,176,190);
    private TvUi() {}
    static int dp(Context c,float n) { return Math.round(c.getResources().getDisplayMetrics().density*n); }
    static TextView text(Context c,String label,int size,int color) {
        TextView t=new TextView(c); t.setText(label); t.setTextSize(size); t.setTextColor(color); t.setGravity(Gravity.CENTER_VERTICAL); return t;
    }
    static GradientDrawable shape(Context c,int fill,int stroke) {
        GradientDrawable d=new GradientDrawable(); d.setColor(fill); d.setCornerRadius(dp(c,8)); if(stroke!=0)d.setStroke(dp(c,2),stroke); return d;
    }
    static StateListDrawable focusBackground(Context c) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{android.R.attr.state_focused},shape(c,Color.rgb(98,26,39),ACCENT));
        d.addState(new int[]{android.R.attr.state_selected},shape(c,Color.rgb(39,30,38),Color.rgb(101,47,58)));
        d.addState(new int[]{},shape(c,PANEL,Color.rgb(43,49,60))); return d;
    }
    static StateListDrawable railBackground(Context c) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{android.R.attr.state_focused},shape(c,Color.rgb(98,26,39),ACCENT));
        d.addState(new int[]{android.R.attr.state_selected},shape(c,Color.rgb(39,30,38),Color.rgb(101,47,58)));
        d.addState(new int[]{},shape(c,Color.TRANSPARENT,0));return d;
    }
    static Button button(Context c,String label,Runnable action) {
        Button b=new Button(c); b.setId(View.generateViewId()); b.setText(label); b.setTextSize(16); b.setTextColor(WHITE);
        b.setAllCaps(false); b.setTypeface(Typeface.DEFAULT,Typeface.NORMAL); b.setMinHeight(dp(c,46)); b.setMinimumHeight(dp(c,46)); b.setMinWidth(0); b.setMinimumWidth(0);
        b.setPadding(dp(c,16),dp(c,8),dp(c,16),dp(c,8)); b.setGravity(Gravity.CENTER);
        b.setBackground(focusBackground(c)); b.setFocusable(true); b.setFocusableInTouchMode(true);
        b.setOnClickListener(v->action.run()); return b;
    }
    static LinearLayout column(Context c) { LinearLayout l=new LinearLayout(c); l.setOrientation(LinearLayout.VERTICAL); return l; }
    static LinearLayout row(Context c) { LinearLayout l=new LinearLayout(c); l.setOrientation(LinearLayout.HORIZONTAL); l.setGravity(Gravity.CENTER_VERTICAL); return l; }
    static LinearLayout.LayoutParams space(Context c,int width,int height) {
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(width<0?width:dp(c,width),height<0?height:dp(c,height)); p.setMargins(dp(c,4),dp(c,4),dp(c,4),dp(c,4)); return p;
    }
    static void heading(TextView text) { text.setTypeface(Typeface.DEFAULT,Typeface.BOLD); }
}
