package vip.flixify.tv;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.NumberFormat;
import java.util.Locale;

/** A small native surface: no poster bitmaps, animation loops or payment web view. */
final class WelcomeOfferScreen extends FrameLayout {
    interface Actions {void trial();void monthly();void users(int value);void retry();void logout();}
    private final Activity activity;
    private final boolean compact;
    private final int white=TvUi.WHITE,silver=0xffcdd2dd;
    WelcomeOfferScreen(Activity activity,WelcomeOffer offer,int users,boolean busy,String error,String focus,Actions actions){
        super(activity);this.activity=activity;TvLayout sizing=TvLayout.measure(activity);compact=sizing.width<680;
        setTag("tv-welcome");setBackgroundColor(TvUi.BACKGROUND);addView(new Confetti(activity),new FrameLayout.LayoutParams(-1,-1));
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(true);scroll.setClipToPadding(false);scroll.setVerticalScrollBarEnabled(false);
        scroll.setPadding(dp(sizing.width<600?16:28),dp(sizing.shortScreen?12:20),dp(sizing.width<600?16:28),dp(18));addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout center=TvUi.column(activity);center.setGravity(Gravity.CENTER);scroll.addView(center,new ScrollView.LayoutParams(-1,-2));
        ImageView logo=new ImageView(activity);logo.setImageResource(R.drawable.flixify_logo);logo.setContentDescription("Flixify Pro");logo.setScaleType(ImageView.ScaleType.FIT_CENTER);center.addView(logo,new LinearLayout.LayoutParams(dp(190),dp(sizing.shortScreen?32:42)));
        TextView title=label("Flixify’a hoş geldin.",sizing.shortScreen?26:32,white);title.setGravity(Gravity.CENTER);center.addView(title,space(-1,-2,6));
        TextView subtitle=label("İzlemeye nasıl başlamak istersin?",17,TvUi.MUTED);subtitle.setGravity(Gravity.CENTER);center.addView(subtitle,space(-1,-2,2));
        if(offer==null){
            if(busy){ProgressBar progress=new ProgressBar(activity);progress.setTag("welcome-progress");progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(TvUi.ACCENT));center.addView(progress,space(32,32,18));center.addView(label("Seçeneklerin hazırlanıyor…",16,TvUi.MUTED),space(-2,-2,8));}
        }else{
            LinearLayout cards=compact?TvUi.column(activity):TvUi.row(activity);cards.setGravity(Gravity.TOP);center.addView(cards,space(-1,-2,12));
            LinearLayout free=card(silver),paid=card(TvUi.ACCENT);LinearLayout.LayoutParams freeSize=cardSpace(),paidSize=cardSpace();if(!compact){freeSize.rightMargin=dp(9);paidSize.leftMargin=dp(9);}else paidSize.topMargin=dp(14);cards.addView(free,freeSize);cards.addView(paid,paidSize);
            free.addView(label("ÜCRETSİZ DENEME",14,silver),space(-1,-2,0));free.addView(label("3 Saat",30,white),space(-1,-2,8));free.addView(label("Ücretsiz",38,white),space(-1,-2,0));
            free.addView(label("Önce keşfet, sonra karar ver.",16,silver),space(-1,-2,6));
            free.addView(line(number(offer.movies)+" film",silver),space(-1,-2,9));free.addView(line(number(offer.live)+" canlı kanal",silver),space(-1,-2,3));free.addView(line(number(offer.series)+" dizi",silver),space(-1,-2,3));
            Button trial=button("Ücretsiz devam et","welcome-trial",silver,actions::trial);trial.setEnabled(!busy);free.addView(trial,space(-1,48,16));
            LinearLayout heading=TvUi.row(activity);heading.addView(label("YENİ ÜYELERE ÖZEL",14,TvUi.ACCENT),new LinearLayout.LayoutParams(0,-2,1));TextView badge=label("%50 indirim",13,TvUi.ACCENT);badge.setPadding(dp(8),dp(5),dp(8),dp(5));badge.setBackground(TvUi.rounded(activity,TvUi.alpha(TvUi.ACCENT,15),TvUi.ACCENT,8,1));heading.addView(badge,new LinearLayout.LayoutParams(-2,-2));paid.addView(heading,space(-1,-2,0));
            paid.addView(label("1 Ay",30,white),space(-1,-2,5));LinearLayout prices=TvUi.row(activity);TextView regular=label(offer.regularPrice(users),20,TvUi.MUTED);regular.setPaintFlags(regular.getPaintFlags()|Paint.STRIKE_THRU_TEXT_FLAG);prices.addView(regular,new LinearLayout.LayoutParams(-2,-2));TextView price=label(offer.price(users),36,white);price.setTag("welcome-price");LinearLayout.LayoutParams priceSpace=new LinearLayout.LayoutParams(-2,-2);priceSpace.leftMargin=dp(12);prices.addView(price,priceSpace);paid.addView(prices,space(-1,-2,1));
            paid.addView(label("Sevdiğin her şey, bir ay seninle.",16,white),space(-1,-2,5));paid.addView(line("Denemedeki tüm içerikler",TvUi.ACCENT),space(-1,-2,8));paid.addView(line("1 ay boyunca erişim",TvUi.ACCENT),space(-1,-2,3));paid.addView(line("Ödeme sonrası otomatik aktivasyon",TvUi.ACCENT),space(-1,-2,3));
            LinearLayout selection=TvUi.row(activity);Button one=button("1 kullanıcı","welcome-users-1",TvUi.ACCENT,()->actions.users(1)),two=button("2 kullanıcı","welcome-users-2",TvUi.ACCENT,()->actions.users(2));one.setSelected(users==1);two.setSelected(users==2);one.setEnabled(!busy);two.setEnabled(!busy);selection.addView(one,new LinearLayout.LayoutParams(0,dp(38),1));LinearLayout.LayoutParams dual=new LinearLayout.LayoutParams(0,dp(38),1);dual.leftMargin=dp(6);selection.addView(two,dual);paid.addView(selection,space(-1,38,10));
            TextView capacity=label("Tek seferlik ödeme",13,TvUi.MUTED);paid.addView(capacity,space(-1,-2,5));
            Button monthly=button(offer.price(users)+" ile 1 ay izle","welcome-paid",TvUi.ACCENT,actions::monthly);monthly.setEnabled(!busy);paid.addView(monthly,space(-1,48,7));
            TextView fallback=label("Ödeme TV tarayıcısında açılır. Telefonundan da aynı hesapla devam edebilirsin.",12,TvUi.MUTED);paid.addView(fallback,space(-1,-2,6));
            trial.setNextFocusRightId((users==2?two:one).getId());trial.setNextFocusDownId(one.getId());one.setNextFocusLeftId(trial.getId());one.setNextFocusRightId(two.getId());two.setNextFocusLeftId(one.getId());one.setNextFocusDownId(monthly.getId());two.setNextFocusDownId(monthly.getId());monthly.setNextFocusUpId((users==2?two:one).getId());monthly.setNextFocusLeftId(trial.getId());
        }
        if(busy && offer!=null){TextView saving=label("Seçimin kaydediliyor…",14,TvUi.MUTED);saving.setTag("welcome-saving");saving.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);center.addView(saving,space(-2,-2,10));}
        Button retry=null;
        if(error!=null && !error.isEmpty()){TextView message=label(error,15,white);message.setTag("welcome-error");message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);center.addView(message,space(-1,-2,12));retry=button("Tekrar dene","welcome-retry",silver,actions::retry);center.addView(retry,space(-2,44,8));}
        Button logout=button("Hesap değiştir","welcome-logout",silver,actions::logout);logout.setTextSize(13);logout.setBackground(TvUi.utilityBackground(activity));center.addView(logout,space(-2,40,10));
        final String wanted=focus!=null?focus:retry!=null?"welcome-retry":offer!=null && !busy?"welcome-trial":"welcome-logout";
        post(()->{View target=findViewWithTag(wanted);if(target==null || !target.isEnabled())target=findViewWithTag("welcome-logout");if(target!=null)target.requestFocus();});
    }
    private int dp(float value){return TvUi.dp(activity,value);}
    private String number(int value){return NumberFormat.getIntegerInstance(new Locale("tr","TR")).format(value);}
    private LinearLayout.LayoutParams space(int width,int height,int top){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(width<0?width:dp(width),height<0?height:dp(height));p.topMargin=dp(top);return p;}
    private LinearLayout.LayoutParams cardSpace(){return compact?new LinearLayout.LayoutParams(-1,-2):new LinearLayout.LayoutParams(0,-2,1);}
    private LinearLayout card(int accent){LinearLayout view=TvUi.column(activity);view.setPadding(dp(18),dp(18),dp(18),dp(18));view.setBackground(TvUi.rounded(activity,TvUi.alpha(TvUi.PANEL,170),accent,16,1));return view;}
    private TextView label(String text,int size,int color){TextView view=TvUi.text(activity,text,size,color);view.setTypeface(Typeface.DEFAULT, size>=26 || size==14?Typeface.BOLD:Typeface.NORMAL);return view;}
    private TextView line(String text,int color){TextView view=label("✓  "+text,15,white);return view;}
    private Button button(String text,String tag,int accent,Runnable action){Button view=TvUi.button(activity,text,action);view.setTag(tag);StateListDrawable background=new StateListDrawable();background.addState(new int[]{-android.R.attr.state_enabled},TvUi.rounded(activity,TvUi.alpha(TvUi.PANEL,180),TvUi.alpha(accent,70),11,1));background.addState(new int[]{android.R.attr.state_focused},TvUi.rounded(activity,accent==TvUi.ACCENT?TvUi.ACCENT:0xffe8ebf2,white,11,3));background.addState(new int[]{android.R.attr.state_selected},TvUi.rounded(activity,TvUi.alpha(accent,60),accent,11,1));background.addState(new int[]{},TvUi.rounded(activity,TvUi.alpha(accent,accent==TvUi.ACCENT?220:36),accent,11,1));view.setBackground(background);view.setTextColor(accent==TvUi.ACCENT?white:0xfff6f7fa);view.setOnFocusChangeListener((v,focused)->view.setTextColor(focused && accent!=TvUi.ACCENT?TvUi.BACKGROUND:white));return view;}
    private static final class Confetti extends View{
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        Confetti(Activity activity){super(activity);setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);setFocusable(false);}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);int[] colors={TvUi.ACCENT,0xffb9caef,0xffb28bc6,0xffd2b08b};for(int n=0;n<20;n++){float x=(n%2==0?.018f:.965f)*getWidth()+((n*17)%31-15);float y=((n*73)%257)/270f*getHeight();paint.setColor(TvUi.alpha(colors[n%colors.length],150));int save=canvas.save();canvas.rotate(n*29,x,y);canvas.drawRect(x-3,y-5,x+3,y+5,paint);canvas.restoreToCount(save);}}
    }
}
