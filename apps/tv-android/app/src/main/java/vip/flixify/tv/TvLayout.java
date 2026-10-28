package vip.flixify.tv;

import android.app.Activity;
import android.view.View;

/** Layout decisions are made in usable app-content dp, including resized/IME windows. */
final class TvLayout {
    final int width,height,inset,rail,gap,heading,control,hero;
    final boolean compact,shortScreen;
    private TvLayout(int width,int height) {
        this.width=width;this.height=height;compact=width<760;shortScreen=height<420;
        inset=width<560?12:width<900?18:26;gap=compact?10:18;
        rail=width<560?126:compact?142:166;heading=shortScreen?34:44;control=46;
        hero=height>=460?Math.min(170,Math.round(height*.28f)):0;
    }
    static TvLayout measure(Activity activity) {
        View content=activity.findViewById(android.R.id.content);
        float density=activity.getResources().getDisplayMetrics().density;
        int width=content!=null && content.getWidth()>0?content.getWidth():activity.getResources().getDisplayMetrics().widthPixels;
        int height=content!=null && content.getHeight()>0?content.getHeight():activity.getResources().getDisplayMetrics().heightPixels;
        return new TvLayout(Math.round(width/density),Math.round(height/density));
    }
    int contentWidth(){return Math.max(120,width-inset*2-rail-gap);}
    int columns(){return Math.max(1,Math.min(6,contentWidth()/(shortScreen?135:145)));}
    int liveColumns(){return Math.max(1,Math.min(4,contentWidth()/196));}
    int liveCardHeight(int columns,int span){
        int imageWidth=Math.max(48,contentWidth()*span/columns-18);
        int available=height-inset*2-heading-62-12;
        return Math.max(90,Math.min(Math.round(imageWidth*9f/16f)+(shortScreen?52:60),available));
    }
    int cardHeight(boolean home) {
        int available=height-inset*2-heading-62-(home?hero+36:0)-12;
        int imageWidth=Math.max(48,contentWidth()/columns()-18);
        int caption=shortScreen?52:60;
        int portrait=Math.round(imageWidth*1.5f)+caption;
        // Portrait catalogs; the home shelf and short windows use a consistent landscape crop.
        int wanted=!home && !shortScreen && portrait<=available?portrait:Math.round(imageWidth*9f/16f)+caption;
        return Math.max(90,Math.min(wanted,available));
    }
}
