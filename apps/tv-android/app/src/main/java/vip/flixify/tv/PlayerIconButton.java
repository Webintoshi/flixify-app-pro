package vip.flixify.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.widget.ImageButton;

/** Small native transport control. Focus changes paint, never layout or hit bounds. */
final class PlayerIconButton extends ImageButton {
    enum Icon { PLAY, PAUSE, BACK, FORWARD, AUDIO, SUBTITLES, NEXT, PREVIOUS, EPISODES, FAVORITE, FAVORITED, GUIDE, EXIT }
    PlayerIconButton(Context context,Icon icon,String description,boolean glass) {
        super(context);
        setScaleType(ScaleType.CENTER_INSIDE);
        setPadding(TvUi.dp(context,11),TvUi.dp(context,11),TvUi.dp(context,11),TvUi.dp(context,11));
        setBackground(surface(context,glass));setFocusable(true);setFocusableInTouchMode(true);
        setIcon(icon,description);setElevation(TvUi.dp(context,2));
    }
    void setIcon(Icon icon,String description) {
        setImageDrawable(new Glyph(icon,TvUi.dp(getContext(),24)));setContentDescription(description);
        setAlpha(isEnabled()?1f:0.35f);
    }
    @Override public void setEnabled(boolean enabled) {super.setEnabled(enabled);setAlpha(enabled?1f:0.35f);}
    static StateListDrawable surface(Context c,boolean glass) {
        StateListDrawable states=new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_focused},glass(c,true));
        states.addState(new int[]{android.R.attr.state_pressed},glass(c,true));
        states.addState(new int[]{},glass?glass(c,false):new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        return states;
    }
    static GradientDrawable glass(Context c,boolean focused) {
        GradientDrawable d=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                focused?new int[]{0x99a7b0be,0xb313171e,0x66a7b0be}:new int[]{0x667b8491,0x9913171e,0x443d4552});
        d.setCornerRadius(TvUi.dp(c,32));d.setStroke(TvUi.dp(c,focused?1.5f:0.7f),focused?TvUi.WHITE:0x55a7b0be);return d;
    }
    private static final class Glyph extends Drawable {
        final Icon icon; final int size; final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        Glyph(Icon icon,int size) {this.icon=icon;this.size=size;}
        @Override public int getIntrinsicWidth(){return size;}
        @Override public int getIntrinsicHeight(){return size;}
        private void line(Canvas c,float x,float y,float a,float b){c.drawLine(x,y,a,b,paint);}
        @Override public void draw(Canvas canvas) {
            Rect b=getBounds();int saved=canvas.save();canvas.translate(b.left,b.top);canvas.scale(b.width()/24f,b.height()/24f);
            paint.setColor(TvUi.WHITE);paint.setStrokeWidth(1.7f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);paint.setStyle(Paint.Style.STROKE);
            Path path=new Path();
            switch(icon) {
                case PLAY: paint.setStyle(Paint.Style.FILL);path.moveTo(8,4);path.lineTo(20,12);path.lineTo(8,20);path.close();canvas.drawPath(path,paint);break;
                case PAUSE: paint.setStyle(Paint.Style.FILL);canvas.drawRoundRect(6,4,10,20,1,1,paint);canvas.drawRoundRect(14,4,18,20,1,1,paint);break;
                case BACK: case FORWARD:
                    if(icon==Icon.FORWARD){canvas.save();canvas.scale(-1,1,12,12);}
                    canvas.drawArc(4,4,20,20,-105,290,false,paint);path.moveTo(4,3);path.lineTo(4,8);path.lineTo(9,8);canvas.drawPath(path,paint);
                    if(icon==Icon.FORWARD)canvas.restore();
                    paint.setStyle(Paint.Style.FILL);paint.setTypeface(Typeface.DEFAULT_BOLD);paint.setTextAlign(Paint.Align.CENTER);paint.setTextSize(7);canvas.drawText("10",12,15,paint);break;
                case AUDIO:
                    for(int i=0;i<5;i++){float h=new float[]{4,9,15,9,4}[i];line(canvas,4+i*4,12-h/2,4+i*4,12+h/2);}break;
                case SUBTITLES:
                    canvas.drawRoundRect(3,4,21,17,3,3,paint);path.moveTo(8,17);path.lineTo(8,21);path.lineTo(13,17);canvas.drawPath(path,paint);
                    line(canvas,7,9,11,9);line(canvas,14,9,17,9);line(canvas,7,13,17,13);break;
                case NEXT: case PREVIOUS: if(icon==Icon.PREVIOUS)canvas.scale(-1,1,12,12);path.moveTo(6,5);path.lineTo(15,12);path.lineTo(6,19);canvas.drawPath(path,paint);line(canvas,19,5,19,19);break;
                case EPISODES:
                    canvas.drawRoundRect(3,6,21,21,2,2,paint);line(canvas,6,3,18,3);path.moveTo(10,10);path.lineTo(16,13.5f);path.lineTo(10,17);path.close();canvas.drawPath(path,paint);break;
                case FAVORITE: case FAVORITED:
                    if(icon==Icon.FAVORITED)paint.setStyle(Paint.Style.FILL);
                    path.moveTo(12,21);path.cubicTo(9,18,3,14,3,8.5f);path.cubicTo(3,3,9,1.5f,12,6);path.cubicTo(15,1.5f,21,3,21,8.5f);path.cubicTo(21,14,15,18,12,21);path.close();canvas.drawPath(path,paint);break;
                case GUIDE:
                    canvas.drawRoundRect(3,4,21,21,2,2,paint);line(canvas,3,9,21,9);line(canvas,8,3,8,6);line(canvas,16,3,16,6);line(canvas,7,13,11,13);line(canvas,14,13,17,13);line(canvas,7,17,17,17);break;
                case EXIT: path.moveTo(13,5);path.lineTo(6,12);path.lineTo(13,19);canvas.drawPath(path,paint);line(canvas,6,12,21,12);break;
            }
            canvas.restoreToCount(saved);
        }
        @Override public void setAlpha(int alpha){paint.setAlpha(alpha);}
        @Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);}
        @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }
}
