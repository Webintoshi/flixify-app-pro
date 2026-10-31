package vip.flixify.tv;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.Checkable;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import vip.flixify.tv.TvModels.Item;

/** Native, local catalogue tools. Construction is separate from showing so the Activity owns dismissal. */
final class CatalogDialogs {
    interface PreviewProvider { CatalogFilterData.SearchPreview preview(String query); }
    interface SearchAction { void apply(String query); }
    interface SearchSelection { void select(Item item,String query); }
    interface CategoryAction { void select(CatalogFilterData.CategoryOption option); }
    private static final Locale TURKISH=Locale.forLanguageTag("tr-TR");
    private CatalogDialogs() {}

    static Dialog search(Activity activity,String section,String query,String categoryTitle,
                         PreviewProvider preview,SearchAction apply,SearchSelection select,Runnable dismissed) {
        Dialog dialog=dialog(activity);
        Handler handler=new Handler(Looper.getMainLooper());
        boolean[] closed={false};
        BoundedScroll scroll=new BoundedScroll(activity);
        scroll.setTag("tv_search_dialog");scroll.setFillViewport(false);scroll.setClipToPadding(false);scroll.setVerticalScrollBarEnabled(false);
        scroll.setBackground(panel(activity,28));scroll.setPadding(dp(activity,24),dp(activity,22),dp(activity,24),dp(activity,20));
        LinearLayout content=column(activity);scroll.addView(content,new ScrollView.LayoutParams(-1,-2));
        LinearLayout header=row(activity);
        LinearLayout headings=column(activity);
        TextView eyebrow=text(activity,safe(section).toUpperCase(TURKISH),12,TvUi.MUTED);eyebrow.setLetterSpacing(.12f);
        scroll.optionalEyebrow=eyebrow;
        headings.addView(eyebrow,new LinearLayout.LayoutParams(-1,dp(activity,20)));
        TextView heading=text(activity,"Ne izlemek istersin?",26,TvUi.WHITE);heading.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        heading.setMinHeight(dp(activity,38));headings.addView(heading,new LinearLayout.LayoutParams(-1,-2));
        header.addView(headings,new LinearLayout.LayoutParams(0,-2,1));
        ImageButton close=icon(activity,Icon.CLOSE,"Aramayı kapat");close.setTag("tv_search_close");close.setOnClickListener(v->dialog.dismiss());
        header.addView(close,new LinearLayout.LayoutParams(dp(activity,44),dp(activity,44)));
        content.addView(header,new LinearLayout.LayoutParams(-1,-2));
        TextView scope=text(activity,"Kategori: "+safe(categoryTitle),12,TvUi.MUTED);
        scroll.optionalScope=scope;
        scope.setPadding(dp(activity,10),0,dp(activity,10),0);scope.setBackground(TvUi.rounded(activity,TvUi.alpha(TvUi.WHITE,12),0,12,1));
        LinearLayout.LayoutParams scopeSpace=new LinearLayout.LayoutParams(-2,dp(activity,24));scopeSpace.topMargin=dp(activity,8);content.addView(scope,scopeSpace);

        LinearLayout inputRow=row(activity);inputRow.setPadding(dp(activity,16),dp(activity,2),dp(activity,6),dp(activity,2));
        inputRow.setBackground(inputSurface(activity,false));
        ImageView magnifier=new ImageView(activity);magnifier.setImageDrawable(new Symbol(activity,Icon.SEARCH,TvUi.MUTED));
        magnifier.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        inputRow.addView(magnifier,new LinearLayout.LayoutParams(dp(activity,24),dp(activity,24)));
        EditText input=editor(activity,"İçerik adıyla ara","İçerik adı",22);
        input.setTag("tv_search_input");input.setText(safe(query));input.setSelection(input.length());
        inputRow.addView(input,new LinearLayout.LayoutParams(0,dp(activity,56),1));
        ImageButton clear=icon(activity,Icon.CLEAR,"Aramayı temizle");clear.setTag("tv_search_clear");
        inputRow.addView(clear,new LinearLayout.LayoutParams(dp(activity,44),dp(activity,44)));
        LinearLayout.LayoutParams inputSpace=new LinearLayout.LayoutParams(-1,dp(activity,60));inputSpace.topMargin=dp(activity,16);content.addView(inputRow,inputSpace);
        input.setOnFocusChangeListener((v,focused)->inputRow.setBackground(inputSurface(activity,focused)));

        LinearLayout previewBox=column(activity);previewBox.setTag("tv_search_preview");previewBox.setPadding(dp(activity,2),0,dp(activity,2),0);
        TextView result=text(activity,"",15,TvUi.WHITE);result.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        result.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        previewBox.addView(result,new LinearLayout.LayoutParams(-1,dp(activity,26)));
        TextView[] examples=new TextView[3];
        Item[] selectedItems=new Item[examples.length];String[] shownQuery={null};
        for(int n=0;n<examples.length;n++) {
            examples[n]=action(activity,"",false);examples[n].setTextSize(14);examples[n].setTextColor(TvUi.MUTED);examples[n].setSingleLine(true);examples[n].setEllipsize(TextUtils.TruncateAt.END);
            examples[n].setId(View.generateViewId());examples[n].setTag("tv_search_result_"+n);
            examples[n].setGravity(Gravity.CENTER_VERTICAL);examples[n].setPadding(dp(activity,10),0,dp(activity,10),0);
            examples[n].setBackground(buttonSurface(activity,false));
            final int index=n;
            examples[n].setOnClickListener(v->{
                if(closed[0] || selectedItems[index]==null || !input.getText().toString().trim().equals(shownQuery[0]))return;
                hideKeyboard(input);
                try{select.select(selectedItems[index],shownQuery[0]);}finally{dialog.dismiss();}
            });
            previewBox.addView(examples[n],new LinearLayout.LayoutParams(-1,dp(activity,40)));
        }
        scroll.examples=examples;
        LinearLayout.LayoutParams previewSpace=new LinearLayout.LayoutParams(-1,-2);previewSpace.topMargin=dp(activity,14);content.addView(previewBox,previewSpace);
        LinearLayout actions=row(activity);actions.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);
        Button cancel=action(activity,"Vazgeç",false);cancel.setTag("tv_search_cancel");cancel.setOnClickListener(v->dialog.dismiss());
        Button search=action(activity,"Ara",true);search.setTag("tv_search_apply");
        LinearLayout.LayoutParams cancelSpace=new LinearLayout.LayoutParams(dp(activity,112),dp(activity,46));cancelSpace.setMarginEnd(dp(activity,10));
        actions.addView(cancel,cancelSpace);actions.addView(search,new LinearLayout.LayoutParams(dp(activity,112),dp(activity,46)));
        LinearLayout.LayoutParams actionSpace=new LinearLayout.LayoutParams(-1,dp(activity,46));actionSpace.topMargin=dp(activity,18);content.addView(actions,actionSpace);
        Runnable submit=()->{
            if(closed[0])return;
            String value=input.getText().toString().trim();hideKeyboard(input);
            try {apply.apply(value);}finally {dialog.dismiss();}
        };
        search.setOnClickListener(v->submit.run());
        clear.setOnClickListener(v->{input.setText("");input.requestFocus();});
        input.setOnEditorActionListener((v,action,event)->{
            if(action==EditorInfo.IME_ACTION_SEARCH || (event!=null && event.getKeyCode()==KeyEvent.KEYCODE_ENTER && event.getAction()==KeyEvent.ACTION_DOWN)){submit.run();return true;}
            return false;
        });
        input.setOnKeyListener((v,key,event)->{
            if(event.getAction()!=KeyEvent.ACTION_DOWN)return false;
            if(key==KeyEvent.KEYCODE_DPAD_DOWN){searchResultFocus(examples,0,1,search).requestFocus();return true;}
            if(key==KeyEvent.KEYCODE_DPAD_UP){close.requestFocus();return true;}
            return false;
        });
        close.setNextFocusDownId(input.getId());close.setNextFocusLeftId(input.getId());
        input.setNextFocusDownId(search.getId());input.setNextFocusUpId(close.getId());
        clear.setNextFocusLeftId(input.getId());clear.setNextFocusDownId(cancel.getId());clear.setNextFocusUpId(close.getId());
        search.setNextFocusUpId(input.getId());search.setNextFocusLeftId(cancel.getId());search.setNextFocusRightId(search.getId());
        cancel.setNextFocusRightId(search.getId());cancel.setNextFocusLeftId(cancel.getId());
        for(int n=0;n<examples.length;n++) {
            final int index=n;
            examples[n].setOnKeyListener((v,key,event)->{
                if(event.getAction()!=KeyEvent.ACTION_DOWN)return false;
                if(key==KeyEvent.KEYCODE_DPAD_UP){searchResultFocus(examples,index-1,-1,input).requestFocus();return true;}
                if(key==KeyEvent.KEYCODE_DPAD_DOWN){searchResultFocus(examples,index+1,1,search).requestFocus();return true;}
                if(key==KeyEvent.KEYCODE_DPAD_LEFT){input.requestFocus();return true;}
                if(key==KeyEvent.KEYCODE_DPAD_RIGHT){search.requestFocus();return true;}
                return false;
            });
        }
        search.setOnKeyListener((v,key,event)->{if(event.getAction()==KeyEvent.ACTION_DOWN && key==KeyEvent.KEYCODE_DPAD_UP){searchResultFocus(examples,examples.length-1,-1,input).requestFocus();return true;}return false;});
        clear.setOnKeyListener((v,key,event)->{if(event.getAction()==KeyEvent.ACTION_DOWN && key==KeyEvent.KEYCODE_DPAD_DOWN){searchResultFocus(examples,0,1,search).requestFocus();return true;}return false;});
        Runnable update=()->{
            if(closed[0])return;
            String value=input.getText().toString().trim();
            CatalogFilterData.SearchPreview summary=preview.preview(value);
            if(closed[0])return;
            int count=summary==null?0:summary.count;
            result.setText(value.isEmpty()?"Katalogda "+count+" içerik":count+" sonuç");
            List<Item> items=summary==null?null:summary.items;shownQuery[0]=value;
            for(int n=0;n<examples.length;n++) {
                boolean exists=items!=null && n<items.size();selectedItems[n]=exists?items.get(n):null;
                examples[n].setVisibility(exists || (n==0 && count==0)?View.VISIBLE:View.GONE);
                examples[n].setText(exists?items.get(n).title:(count==0?"Farklı bir içerik adı deneyebilirsin.":""));
                examples[n].setEnabled(exists);examples[n].setFocusable(exists);examples[n].setFocusableInTouchMode(exists);
            }
            boolean hasQuery=input.length()>0;
            clear.setEnabled(hasQuery);clear.setFocusable(hasQuery);clear.setAlpha(hasQuery?1f:.3f);
            input.setNextFocusRightId(hasQuery?clear.getId():search.getId());search.setNextFocusRightId(hasQuery?clear.getId():close.getId());cancel.setNextFocusUpId(hasQuery?clear.getId():input.getId());
        };
        TextWatcher watcher=watcher(()->{handler.removeCallbacksAndMessages(null);handler.postDelayed(update,120);});
        input.addTextChangedListener(watcher);
        dialog.setContentView(scroll);
        dialog.setOnShowListener(ignored->{
            Window window=dialog.getWindow();
            if(window!=null){window.setLayout(Math.min(dp(activity,600),usableWidth(activity)-dp(activity,40)),-2);window.setGravity(Gravity.CENTER);}
            update.run();input.requestFocus();
        });
        dialog.setOnDismissListener(ignored->{
            if(closed[0])return;closed[0]=true;handler.removeCallbacksAndMessages(null);input.removeTextChangedListener(watcher);hideKeyboard(input);dismissed.run();
        });
        return dialog;
    }

    private static View searchResultFocus(TextView[] rows,int start,int step,View fallback) {
        for(int n=start;n>=0 && n<rows.length;n+=step)if(rows[n].isShown() && rows[n].isEnabled() && rows[n].isFocusable())return rows[n];
        return fallback;
    }

    static Dialog categories(Activity activity,String section,List<CatalogFilterData.CategoryOption> rows,
                             String selectedId,CategoryAction apply,Runnable dismissed) {
        Dialog dialog=dialog(activity);boolean[] closed={false};
        InsetPanel inset=new InsetPanel(activity);inset.setTag("tv_categories_dialog");
        CompactColumn content=new CompactColumn(activity);content.setBackground(panel(activity,26));
        inset.addView(content,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout header=row(activity);
        TextView title=text(activity,"Kategoriler",26,TvUi.WHITE);title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        header.addView(title,new LinearLayout.LayoutParams(0,dp(activity,46),1));
        ImageButton close=icon(activity,Icon.CLOSE,"Kategorileri kapat");close.setTag("tv_categories_close");close.setOnClickListener(v->dialog.dismiss());
        header.addView(close,new LinearLayout.LayoutParams(dp(activity,44),dp(activity,44)));
        content.addView(header,new LinearLayout.LayoutParams(-1,dp(activity,48)));
        TextView subtitle=text(activity,safe(section)+" · "+Math.max(0,rows.size()-1)+" kategori",12,TvUi.MUTED);
        content.addView(subtitle,new LinearLayout.LayoutParams(-1,dp(activity,24)));content.optionalHeader=subtitle;
        LinearLayout inputRow=row(activity);inputRow.setPadding(dp(activity,12),0,dp(activity,8),0);inputRow.setBackground(inputSurface(activity,false));
        ImageView searchIcon=new ImageView(activity);searchIcon.setImageDrawable(new Symbol(activity,Icon.SEARCH,TvUi.MUTED));searchIcon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        inputRow.addView(searchIcon,new LinearLayout.LayoutParams(dp(activity,21),dp(activity,21)));
        EditText filter=editor(activity,"Kategori bul","Kategori bul",17);filter.setTag("tv_categories_filter");filter.setImeOptions(EditorInfo.IME_ACTION_DONE);
        inputRow.addView(filter,new LinearLayout.LayoutParams(0,dp(activity,48),1));
        LinearLayout.LayoutParams filterSpace=new LinearLayout.LayoutParams(-1,dp(activity,50));filterSpace.topMargin=dp(activity,12);filterSpace.bottomMargin=dp(activity,12);content.addView(inputRow,filterSpace);
        filter.setOnFocusChangeListener((v,focused)->inputRow.setBackground(inputSurface(activity,focused)));
        FrameLayout listHost=new FrameLayout(activity);
        ListView list=new ListView(activity);list.setId(View.generateViewId());list.setTag("tv_categories_list");list.setFocusable(true);list.setFocusableInTouchMode(true);
        list.setItemsCanFocus(false);list.setChoiceMode(ListView.CHOICE_MODE_SINGLE);list.setVerticalScrollBarEnabled(false);
        list.setDivider(new ColorDrawable(Color.TRANSPARENT));list.setDividerHeight(dp(activity,5));list.setClipToPadding(false);
        list.setSelector(rowSelector(activity));list.setDrawSelectorOnTop(false);list.setPadding(0,dp(activity,3),0,dp(activity,3));
        CategoryAdapter adapter=new CategoryAdapter(activity,rows,selectedId);list.setAdapter(adapter);
        listHost.addView(list,new FrameLayout.LayoutParams(-1,-1));
        TextView empty=text(activity,"Kategori bulunamadı",16,TvUi.MUTED);empty.setGravity(Gravity.CENTER);empty.setSingleLine(false);empty.setPadding(dp(activity,16),0,dp(activity,16),0);
        listHost.addView(empty,new FrameLayout.LayoutParams(-1,-1));list.setEmptyView(empty);
        content.addView(listHost,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout footer=row(activity);
        TextView hint=text(activity,"OK ile seç",12,TvUi.MUTED);footer.addView(hint,new LinearLayout.LayoutParams(0,dp(activity,44),1));
        Button cancel=action(activity,"Vazgeç",false);cancel.setTag("tv_categories_cancel");cancel.setOnClickListener(v->dialog.dismiss());
        footer.addView(cancel,new LinearLayout.LayoutParams(dp(activity,102),dp(activity,44)));
        LinearLayout.LayoutParams footerSpace=new LinearLayout.LayoutParams(-1,dp(activity,44));footerSpace.topMargin=dp(activity,8);content.addView(footer,footerSpace);content.optionalFooter=footer;
        Runnable focusList=()->{
            if(adapter.getCount()==0){close.requestFocus();return;}
            hideKeyboard(filter);list.requestFocus();
            int index=adapter.selectedPosition();list.clearChoices();if(index>=0)list.setItemChecked(index,true);list.setSelection(Math.max(0,index));
        };
        list.setOnItemClickListener((parent,view,position,id)->{
            if(closed[0] || position<0 || position>=adapter.getCount())return;
            hideKeyboard(filter);
            try {apply.select(adapter.getItem(position));}finally {dialog.dismiss();}
        });
        list.setOnKeyListener((v,key,event)->{
            if(event.getAction()!=KeyEvent.ACTION_DOWN)return false;
            if(key==KeyEvent.KEYCODE_DPAD_UP && list.getSelectedItemPosition()<=0){filter.requestFocus();return true;}
            if(key==KeyEvent.KEYCODE_DPAD_DOWN && list.getSelectedItemPosition()>=adapter.getCount()-1){if(cancel.isShown())cancel.requestFocus();else close.requestFocus();return true;}
            if(key==KeyEvent.KEYCODE_DPAD_LEFT){filter.requestFocus();return true;}
            if(key==KeyEvent.KEYCODE_DPAD_RIGHT){close.requestFocus();return true;}
            return false;
        });
        filter.setOnKeyListener((v,key,event)->{
            if(event.getAction()!=KeyEvent.ACTION_DOWN)return false;
            if(key==KeyEvent.KEYCODE_DPAD_DOWN){focusList.run();return true;}
            if(key==KeyEvent.KEYCODE_DPAD_UP){close.requestFocus();return true;}
            return false;
        });
        filter.setOnEditorActionListener((v,action,event)->{
            if(action==EditorInfo.IME_ACTION_DONE || (event!=null && event.getKeyCode()==KeyEvent.KEYCODE_ENTER && event.getAction()==KeyEvent.ACTION_DOWN)){focusList.run();return true;}
            return false;
        });
        close.setNextFocusDownId(filter.getId());close.setNextFocusLeftId(filter.getId());filter.setNextFocusUpId(close.getId());filter.setNextFocusDownId(list.getId());
        list.setNextFocusUpId(filter.getId());list.setNextFocusDownId(cancel.getId());cancel.setNextFocusUpId(list.getId());cancel.setNextFocusLeftId(filter.getId());cancel.setNextFocusRightId(close.getId());
        TextWatcher watcher=watcher(()->{
            if(closed[0])return;adapter.filter(filter.getText().toString());list.clearChoices();
            int index=adapter.selectedPosition();if(adapter.getCount()>0){if(index>=0)list.setItemChecked(index,true);list.setSelection(Math.max(0,index));}
        });
        filter.addTextChangedListener(watcher);
        dialog.setContentView(inset);
        dialog.setOnShowListener(ignored->{
            Window window=dialog.getWindow();
            if(window!=null){window.setLayout(Math.min(dp(activity,380),usableWidth(activity)-dp(activity,32)),-1);WindowManager.LayoutParams p=window.getAttributes();p.gravity=Gravity.END|Gravity.CENTER_VERTICAL;p.x=dp(activity,24);window.setAttributes(p);}
            int index=adapter.selectedPosition();if(adapter.getCount()>0){if(index>=0)list.setItemChecked(index,true);list.setSelection(Math.max(0,index));list.requestFocus();}else filter.requestFocus();
        });
        dialog.setOnDismissListener(ignored->{if(closed[0])return;closed[0]=true;filter.removeTextChangedListener(watcher);hideKeyboard(filter);dismissed.run();});
        return dialog;
    }

    private static Dialog dialog(Activity activity) {
        Dialog dialog=new Dialog(activity);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);dialog.setCanceledOnTouchOutside(true);
        Window window=dialog.getWindow();
        if(window!=null){window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);window.setDimAmount(.25f);window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);}
        return dialog;
    }
    private static int usableWidth(Activity activity) {
        View content=activity.findViewById(android.R.id.content);int width=content==null?0:content.getWidth();
        return Math.max(dp(activity,280),Math.min(activity.getResources().getDisplayMetrics().widthPixels,width>0?width:Integer.MAX_VALUE));
    }
    private static int usableHeight(Activity activity) {
        View content=activity.findViewById(android.R.id.content);int height=content==null?0:content.getHeight();
        return Math.max(dp(activity,160),Math.min(activity.getResources().getDisplayMetrics().heightPixels,height>0?height:Integer.MAX_VALUE));
    }
    private static String safe(String text){return text==null?"":text;}
    private static int dp(Context context,float value){return TvUi.dp(context,value);}
    private static LinearLayout column(Context context){LinearLayout layout=new LinearLayout(context);layout.setOrientation(LinearLayout.VERTICAL);return layout;}
    private static LinearLayout row(Context context){LinearLayout layout=new LinearLayout(context);layout.setOrientation(LinearLayout.HORIZONTAL);layout.setGravity(Gravity.CENTER_VERTICAL);return layout;}
    private static TextView text(Context context,String value,int size,int color){TextView view=TvUi.text(context,value,size,color);view.setSingleLine(true);view.setEllipsize(TextUtils.TruncateAt.END);return view;}
    private static EditText editor(Context context,String hint,String description,int size) {
        EditText input=new EditText(context);input.setId(View.generateViewId());input.setSingleLine(true);input.setTextSize(size);input.setTextColor(TvUi.WHITE);input.setHintTextColor(TvUi.MUTED);input.setHint(hint);input.setContentDescription(description);
        input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setImeOptions(EditorInfo.IME_ACTION_SEARCH);input.setBackgroundColor(Color.TRANSPARENT);input.setPadding(dp(context,10),dp(context,7),dp(context,8),dp(context,7));input.setMinWidth(0);input.setMinimumWidth(0);return input;
    }
    private static Button action(Context context,String value,boolean primary) {
        Button button=TvUi.button(context,value,()->{});button.setBackground(buttonSurface(context,primary));button.setTextSize(16);button.setMinHeight(dp(context,44));button.setMinimumHeight(dp(context,44));return button;
    }
    private static ImageButton icon(Context context,Icon symbol,String description) {
        ImageButton button=new ImageButton(context);button.setId(View.generateViewId());button.setContentDescription(description);button.setImageDrawable(new Symbol(context,symbol,TvUi.WHITE));button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);button.setPadding(dp(context,11),dp(context,11),dp(context,11),dp(context,11));button.setBackground(buttonSurface(context,false));button.setFocusable(true);button.setFocusableInTouchMode(true);return button;
    }
    private static GradientDrawable panel(Context context,int radius) {
        // Composite the highlight over our own surface so background text never bleeds through.
        int lift=24,base=TvUi.PANEL,light=TvUi.WHITE;
        int highlight=Color.rgb((Color.red(base)*(255-lift)+Color.red(light)*lift)/255,(Color.green(base)*(255-lift)+Color.green(light)*lift)/255,(Color.blue(base)*(255-lift)+Color.blue(light)*lift)/255);
        GradientDrawable value=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{highlight,TvUi.PANEL,TvUi.PANEL});value.setCornerRadius(dp(context,radius));value.setStroke(dp(context,1),TvUi.alpha(TvUi.WHITE,48));return value;
    }
    private static GradientDrawable inputSurface(Context context,boolean focused) {
        GradientDrawable value=new GradientDrawable();value.setColor(TvUi.alpha(TvUi.BACKGROUND,145));value.setCornerRadius(dp(context,28));value.setStroke(dp(context,focused?1.5f:1f),TvUi.alpha(TvUi.WHITE,focused?220:55));return value;
    }
    private static StateListDrawable buttonSurface(Context context,boolean primary) {
        StateListDrawable value=new StateListDrawable();value.addState(new int[]{android.R.attr.state_focused},focusGlass(context));value.addState(new int[]{android.R.attr.state_pressed},focusGlass(context));
        value.addState(new int[]{},TvUi.rounded(context,primary?TvUi.alpha(TvUi.WHITE,24):Color.TRANSPARENT,primary?TvUi.alpha(TvUi.WHITE,45):0,26,1));return value;
    }
    private static GradientDrawable focusGlass(Context context) {
        GradientDrawable value=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{TvUi.alpha(TvUi.WHITE,66),TvUi.alpha(TvUi.PANEL,230)});value.setCornerRadius(dp(context,26));value.setStroke(dp(context,1.5f),TvUi.WHITE);return value;
    }
    private static StateListDrawable rowSelector(Context context) {
        StateListDrawable value=new StateListDrawable();value.addState(new int[]{android.R.attr.state_focused},focusGlass(context));value.addState(new int[]{android.R.attr.state_pressed},focusGlass(context));value.addState(new int[]{},new ColorDrawable(Color.TRANSPARENT));return value;
    }
    private static void hideKeyboard(View view) {
        InputMethodManager keyboard=(InputMethodManager)view.getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        if(keyboard!=null && view.getWindowToken()!=null)keyboard.hideSoftInputFromWindow(view.getWindowToken(),0);
    }
    private static TextWatcher watcher(Runnable change) {
        return new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){}public void afterTextChanged(Editable text){change.run();}};
    }
    private static final class BoundedScroll extends ScrollView {
        private final Activity activity;
        View optionalEyebrow,optionalScope;TextView[] examples;
        BoundedScroll(Activity activity){super(activity);this.activity=activity;}
        @Override protected void onMeasure(int widthSpec,int heightSpec) {
            int maximum=Math.max(dp(activity,140),usableHeight(activity)-dp(activity,40));
            int mode=MeasureSpec.getMode(heightSpec),size=MeasureSpec.getSize(heightSpec);
            int limit=mode==MeasureSpec.UNSPECIFIED?maximum:Math.min(size,maximum);
            boolean compact=limit<dp(activity,360);
            int top=dp(activity,compact?14:22),bottom=dp(activity,compact?14:20);
            if(getPaddingTop()!=top || getPaddingBottom()!=bottom)setPadding(dp(activity,24),top,dp(activity,24),bottom);
            if(optionalEyebrow!=null)optionalEyebrow.setVisibility(compact?GONE:VISIBLE);
            if(optionalScope!=null)optionalScope.setVisibility(limit<dp(activity,320)?GONE:VISIBLE);
            if(examples!=null)for(int n=1;n<examples.length;n++)examples[n].setVisibility(!compact && examples[n].length()>0?VISIBLE:GONE);
            super.onMeasure(widthSpec,MeasureSpec.makeMeasureSpec(limit,MeasureSpec.AT_MOST));
        }
    }
    private static final class InsetPanel extends FrameLayout {
        private final Activity activity;
        InsetPanel(Activity activity){super(activity);this.activity=activity;}
        @Override protected void onMeasure(int widthSpec,int heightSpec) {
            int mode=MeasureSpec.getMode(heightSpec),size=MeasureSpec.getSize(heightSpec);
            int height=mode==MeasureSpec.UNSPECIFIED?usableHeight(activity):Math.min(size,usableHeight(activity));
            int inset=dp(activity,height<dp(activity,300)?10:24);if(getPaddingTop()!=inset)setPadding(0,inset,0,inset);
            super.onMeasure(widthSpec,MeasureSpec.makeMeasureSpec(height,MeasureSpec.EXACTLY));
        }
    }
    private static final class CompactColumn extends LinearLayout {
        View optionalHeader,optionalFooter;
        CompactColumn(Context context){super(context);setOrientation(VERTICAL);}
        @Override protected void onMeasure(int widthSpec,int heightSpec) {
            boolean shortWindow=MeasureSpec.getSize(heightSpec)<dp(getContext(),290);
            int inset=dp(getContext(),shortWindow?14:20);if(getPaddingLeft()!=inset)setPadding(inset,inset,inset,inset);
            if(optionalHeader!=null)optionalHeader.setVisibility(shortWindow?GONE:VISIBLE);if(optionalFooter!=null)optionalFooter.setVisibility(shortWindow?GONE:VISIBLE);
            super.onMeasure(widthSpec,heightSpec);
        }
    }
    private static final class CategoryAdapter extends BaseAdapter {
        final Context context;final List<CatalogFilterData.CategoryOption> all,visible=new ArrayList<>();final Map<String,Long> stableIds=new HashMap<>();final String selected;
        CategoryAdapter(Context context,List<CatalogFilterData.CategoryOption> rows,String selected){this.context=context;this.all=new ArrayList<>(rows);this.selected=selected;for(int n=0;n<all.size();n++)stableIds.put(all.get(n).id,(long)n);filter("");}
        void filter(String query){String normalized=safe(query).trim().toLowerCase(TURKISH);visible.clear();for(CatalogFilterData.CategoryOption option:all)if(option.title.toLowerCase(TURKISH).contains(normalized))visible.add(option);notifyDataSetChanged();}
        int selectedPosition(){for(int n=0;n<visible.size();n++)if(visible.get(n).id.equals(selected))return n;return -1;}
        @Override public int getCount(){return visible.size();}
        @Override public CatalogFilterData.CategoryOption getItem(int position){return visible.get(position);}
        @Override public long getItemId(int position){return stableIds.get(getItem(position).id);}
        @Override public boolean hasStableIds(){return true;}
        @Override public View getView(int position,View convertView,ViewGroup parent){CategoryRow row=convertView instanceof CategoryRow?(CategoryRow)convertView:new CategoryRow(context);CatalogFilterData.CategoryOption option=getItem(position);row.bind(option,option.id.equals(selected));return row;}
    }
    private static final class CategoryRow extends LinearLayout implements Checkable {
        final TextView mark,title,count;boolean checked;
        CategoryRow(Context context){super(context);setOrientation(HORIZONTAL);setGravity(Gravity.CENTER_VERTICAL);setPadding(dp(context,12),dp(context,10),dp(context,12),dp(context,10));setMinimumHeight(dp(context,64));
            mark=text(context,"✓",16,TvUi.ACCENT);addView(mark,new LinearLayout.LayoutParams(dp(context,25),-2));
            title=text(context,"",16,TvUi.WHITE);title.setSingleLine(false);title.setMaxLines(2);addView(title,new LinearLayout.LayoutParams(0,-2,1));
            count=text(context,"",12,TvUi.MUTED);count.setGravity(Gravity.CENTER);count.setPadding(dp(context,9),0,dp(context,9),0);count.setMinWidth(dp(context,36));count.setBackground(TvUi.rounded(context,TvUi.alpha(TvUi.WHITE,12),0,14,1));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(context,28));p.setMarginStart(dp(context,10));addView(count,p);
            setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
        }
        void bind(CatalogFilterData.CategoryOption option,boolean selected){setTag("tv_category_"+option.id);title.setText(option.title);count.setText(String.valueOf(option.count));setChecked(selected);setContentDescription(option.title+", "+option.count+" içerik"+(selected?", seçili":""));}
        @Override public void setChecked(boolean value){checked=value;mark.setVisibility(value?VISIBLE:INVISIBLE);title.setTypeface(Typeface.DEFAULT,value?Typeface.BOLD:Typeface.NORMAL);}
        @Override public boolean isChecked(){return checked;}
        @Override public void toggle(){setChecked(!checked);}
    }
    private enum Icon {SEARCH,CLEAR,CLOSE}
    private static final class Symbol extends Drawable {
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final Icon icon;private final int size;
        Symbol(Context context,Icon icon,int color){this.icon=icon;size=dp(context,24);paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeWidth(1.8f);}
        @Override public void draw(Canvas canvas){int save=canvas.save();canvas.translate(getBounds().left,getBounds().top);canvas.scale(getBounds().width()/24f,getBounds().height()/24f);if(icon==Icon.SEARCH){canvas.drawCircle(10.5f,10.5f,6.5f,paint);canvas.drawLine(15.5f,15.5f,21,21,paint);}else{canvas.drawLine(6,6,18,18,paint);canvas.drawLine(18,6,6,18,paint);}canvas.restoreToCount(save);}
        @Override public void setAlpha(int alpha){paint.setAlpha(alpha);invalidateSelf();}
        @Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);invalidateSelf();}
        @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
        @Override public int getIntrinsicWidth(){return size;}
        @Override public int getIntrinsicHeight(){return size;}
    }
}
