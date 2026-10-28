package vip.flixify.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Native TV surfaces use the same palette with a clear, quiet focus treatment. */
final class TvUi {
    static final int BACKGROUND=Color.rgb(7,9,12), PANEL=Color.rgb(19,23,30), ACCENT=Color.rgb(255,53,69);
    static final int WHITE=Color.rgb(245,246,248), MUTED=Color.rgb(167,176,190);
    private TvUi() {}
    static int dp(Context c,float n) { return Math.round(c.getResources().getDisplayMetrics().density*n); }
    static TextView text(Context c,String label,int size,int color) {
        TextView t=new TextView(c); t.setText(label); t.setTextSize(size); t.setTextColor(color); t.setGravity(Gravity.CENTER_VERTICAL); return t;
    }
    static GradientDrawable shape(Context c,int fill,int stroke) {
        return rounded(c,fill,stroke,10,1);
    }
    static int alpha(int color,int opacity) {return (color&0x00ffffff)|(opacity<<24);}
    static GradientDrawable rounded(Context c,int fill,int stroke,int radius,int border) {
        GradientDrawable d=new GradientDrawable();d.setColor(fill);d.setCornerRadius(dp(c,radius));if(stroke!=0)d.setStroke(dp(c,border),stroke);return d;
    }
    private static GradientDrawable glass(Context c,int opacity,int stroke,int radius) {
        GradientDrawable d=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{alpha(WHITE,opacity),alpha(PANEL,224)});
        d.setCornerRadius(dp(c,radius));if(stroke!=0)d.setStroke(dp(c,1),stroke);return d;
    }
    static StateListDrawable focusBackground(Context c) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{-android.R.attr.state_enabled},rounded(c,alpha(PANEL,170),0,12,1));
        d.addState(new int[]{android.R.attr.state_focused},glass(c,48,alpha(WHITE,200),12));
        d.addState(new int[]{android.R.attr.state_pressed},glass(c,38,alpha(WHITE,140),12));
        d.addState(new int[]{android.R.attr.state_selected},rounded(c,alpha(WHITE,20),alpha(ACCENT,150),12,1));
        d.addState(new int[]{},rounded(c,alpha(PANEL,220),alpha(WHITE,25),12,1));return d;
    }
    static StateListDrawable railBackground(Context c) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{android.R.attr.state_focused},glass(c,48,alpha(WHITE,190),24));
        d.addState(new int[]{android.R.attr.state_selected},glass(c,22,alpha(WHITE,35),24));
        d.addState(new int[]{},rounded(c,Color.TRANSPARENT,0,24,1));return d;
    }
    static StateListDrawable utilityBackground(Context c) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{android.R.attr.state_focused},glass(c,42,alpha(WHITE,180),22));
        d.addState(new int[]{android.R.attr.state_pressed},glass(c,30,alpha(WHITE,100),22));
        d.addState(new int[]{},rounded(c,Color.TRANSPARENT,0,22,1));return d;
    }
    static StateListDrawable artworkBackground(Context c) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{android.R.attr.state_focused},rounded(c,alpha(WHITE,12),alpha(WHITE,230),13,2));
        d.addState(new int[]{android.R.attr.state_pressed},rounded(c,alpha(WHITE,20),alpha(WHITE,160),13,2));
        d.addState(new int[]{},rounded(c,Color.TRANSPARENT,0,13,2));return d;
    }
    static StateListDrawable catalogActionBackground(Context c,boolean active) {
        StateListDrawable d=new StateListDrawable();
        d.addState(new int[]{android.R.attr.state_focused},glass(c,42,alpha(WHITE,190),24));
        d.addState(new int[]{android.R.attr.state_pressed},glass(c,32,alpha(WHITE,130),24));
        d.addState(new int[]{},rounded(c,alpha(active?WHITE:PANEL,active?20:150),alpha(active?ACCENT:WHITE,active?110:28),24,1));return d;
    }
    static Drawable catalogIcon(Context c,int kind,int size) {return new CatalogIcon(kind,dp(c,size));}
    private static final class CatalogIcon extends Drawable {
        final int kind,size;final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        CatalogIcon(int kind,int size){this.kind=kind;this.size=size;paint.setColor(WHITE);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.8f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);}
        @Override public void draw(Canvas canvas){int saved=canvas.save();canvas.translate(getBounds().left,getBounds().top);canvas.scale(getBounds().width()/24f,getBounds().height()/24f);
            if(kind==0){canvas.drawCircle(10,10,6.5f,paint);canvas.drawLine(15,15,21,21,paint);}
            else if(kind==1){canvas.drawLine(3,5,21,5,paint);canvas.drawLine(6,12,18,12,paint);canvas.drawLine(9,19,15,19,paint);}
            else{canvas.drawArc(4,4,20,20,35,290,false,paint);canvas.drawLine(20,3,20,8,paint);canvas.drawLine(15,8,20,8,paint);}
            canvas.restoreToCount(saved);}
        @Override public int getIntrinsicWidth(){return size;}@Override public int getIntrinsicHeight(){return size;}
        @Override public void setAlpha(int alpha){paint.setAlpha(alpha);invalidateSelf();}@Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);invalidateSelf();}@Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }
    static Drawable railIcon(Context c,int section,int size) {return new BrowseIcon(section,dp(c,size));}
    private static final class BrowseIcon extends Drawable {
        private final int section,size;
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        BrowseIcon(int section,int size) {this.section=section;this.size=size;paint.setColor(WHITE);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.7f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);}
        @Override public void draw(Canvas canvas) {
            int saved=canvas.save();canvas.translate(getBounds().left,getBounds().top);canvas.scale(getBounds().width()/24f,getBounds().height()/24f);
            Path path=new Path();
            switch(section) {
                case 0:
                    path.moveTo(3,10);path.lineTo(12,3);path.lineTo(21,10);path.moveTo(5,9);path.lineTo(5,21);path.lineTo(10,21);path.lineTo(10,15);path.lineTo(14,15);path.lineTo(14,21);path.lineTo(19,21);path.lineTo(19,9);canvas.drawPath(path,paint);break;
                case 1:
                    canvas.drawRoundRect(new RectF(3,4,21,18),3,3,paint);canvas.drawLine(9,21,15,21,paint);canvas.drawLine(12,18,12,21,paint);path.moveTo(10,8);path.lineTo(15,11);path.lineTo(10,14);path.close();canvas.drawPath(path,paint);break;
                case 2:
                    canvas.drawRoundRect(new RectF(3,4,21,20),2,2,paint);canvas.drawLine(7,4,7,20,paint);canvas.drawLine(17,4,17,20,paint);for(int y=8;y<=16;y+=4){canvas.drawLine(3,y,7,y,paint);canvas.drawLine(17,y,21,y,paint);}break;
                case 3:
                    canvas.drawRoundRect(new RectF(3,8,21,21),2,2,paint);canvas.drawLine(5,5,19,5,paint);canvas.drawLine(8,2,16,2,paint);break;
                case 4:
                    path.moveTo(12,21);path.cubicTo(9,18,3,14,3,9);path.cubicTo(3,3,9,2,12,7);path.cubicTo(15,2,21,3,21,9);path.cubicTo(21,14,15,18,12,21);canvas.drawPath(path,paint);break;
                default:
                    canvas.drawCircle(12,7,3.5f,paint);path.moveTo(4,21);path.cubicTo(4,12,20,12,20,21);canvas.drawPath(path,paint);break;
            }
            canvas.restoreToCount(saved);
        }
        @Override public void setAlpha(int alpha) {paint.setAlpha(alpha);invalidateSelf();}
        @Override public void setColorFilter(ColorFilter filter) {paint.setColorFilter(filter);invalidateSelf();}
        @Override public int getOpacity() {return PixelFormat.TRANSLUCENT;}
        @Override public int getIntrinsicWidth() {return size;}
        @Override public int getIntrinsicHeight() {return size;}
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
