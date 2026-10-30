package vip.flixify.tv;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** The loading cover belongs to a rendered surface, never to a delayed timer. */
final class StartupScreen implements AutoCloseable {
    private static final String PROCESS_ID=java.util.UUID.randomUUID().toString();
    private final Activity activity;
    private boolean complete,closed;
    private View content,overlay;
    private int accessibility;
    private ViewTreeObserver.OnPreDrawListener pending;
    private long generation;

    StartupScreen(Activity activity,boolean complete){this.activity=activity;this.complete=complete;}
    static boolean restoredComplete(Bundle state){return state!=null && state.getBoolean("startupComplete",false) && PROCESS_ID.equals(state.getString("startupProcess"));}
    void saveInstanceState(Bundle state){state.putBoolean("startupComplete",complete);state.putString("startupProcess",PROCESS_ID);}

    void show(View next) {
        cancelPendingFrame();restoreAccessibility();content=next;
        if(complete || closed){activity.setContentView(next);return;}
        accessibility=next.getImportantForAccessibility();next.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        FrameLayout host=new FrameLayout(activity);host.setBackgroundColor(TvUi.BACKGROUND);
        host.addView(next,new FrameLayout.LayoutParams(-1,-1));
        FrameLayout cover=new FrameLayout(activity);cover.setTag("tv-startup-overlay");cover.setBackgroundColor(TvUi.BACKGROUND);cover.setClickable(true);cover.setFocusable(false);cover.setFocusableInTouchMode(false);
        LinearLayout center=TvUi.column(activity);center.setGravity(Gravity.CENTER);center.setPadding(TvUi.dp(activity,24),TvUi.dp(activity,16),TvUi.dp(activity,24),TvUi.dp(activity,16));
        cover.addView(center,new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER));
        ImageView logo=new ImageView(activity);logo.setTag("tv-startup-logo");logo.setImageResource(R.drawable.flixify_logo);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        center.addView(logo,new LinearLayout.LayoutParams(-1,TvUi.dp(activity,70)));
        LinearLayout row=TvUi.row(activity);row.setGravity(Gravity.CENTER);LinearLayout.LayoutParams rowSpace=new LinearLayout.LayoutParams(-2,TvUi.dp(activity,44));rowSpace.topMargin=TvUi.dp(activity,18);center.addView(row,rowSpace);
        ProgressBar spinner=new ProgressBar(activity,null,android.R.attr.progressBarStyleSmall);spinner.setTag("tv-startup-spinner");spinner.setIndeterminate(true);spinner.setIndeterminateTintList(ColorStateList.valueOf(TvUi.ACCENT));spinner.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);row.addView(spinner,new LinearLayout.LayoutParams(TvUi.dp(activity,22),TvUi.dp(activity,22)));
        TextView label=TvUi.text(activity,"Yükleniyor…",17,TvUi.MUTED);label.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);LinearLayout.LayoutParams labelSpace=new LinearLayout.LayoutParams(-2,-2);labelSpace.leftMargin=TvUi.dp(activity,12);row.addView(label,labelSpace);
        host.addView(cover,new FrameLayout.LayoutParams(-1,-1));overlay=cover;activity.setContentView(host);
    }
    boolean isShowing(){return !complete && !closed;}

    void ready() {
        if(!isShowing() || content==null)return;
        cancelPendingFrame();final long ticket=generation;final View surface=content;
        pending=()->{
            if(ticket!=generation || surface!=content || closed)return true;
            cancelPendingFrame();restoreAccessibility();complete=true;
            if(overlay!=null){overlay.setVisibility(View.GONE);ViewGroup parent=(ViewGroup)overlay.getParent();if(parent!=null)parent.removeView(overlay);overlay=null;}
            return true;
        };
        surface.getViewTreeObserver().addOnPreDrawListener(pending);surface.invalidate();
    }
    void cancelPendingFrame() {
        generation++;
        if(pending!=null && content!=null){ViewTreeObserver observer=content.getViewTreeObserver();if(observer.isAlive())observer.removeOnPreDrawListener(pending);}
        pending=null;
    }
    private void restoreAccessibility(){if(content!=null && !complete)content.setImportantForAccessibility(accessibility);}
    @Override public void close(){cancelPendingFrame();restoreAccessibility();closed=true;content=null;overlay=null;}
}
