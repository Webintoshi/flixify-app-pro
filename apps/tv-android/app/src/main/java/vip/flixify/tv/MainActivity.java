package vip.flixify.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextUtils;
import android.graphics.drawable.GradientDrawable;
import android.widget.FrameLayout;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import vip.flixify.tv.TvModels.*;

/** Native Android TV navigation. Items carry scoped identifiers; playback URLs stay in the repository. */
public final class MainActivity extends Activity {
    private enum Section { HOME, LIVE, MOVIES, SERIES, FAVORITES, ACCOUNT }
    private static final String[] NAV={"Ana Sayfa","Canlı TV","Filmler","Diziler","Favoriler","Hesabım"};
    private static final class Page {
        final Section section;
        Catalog catalog;
        String query="",category="",categoryTitle="Tümü",focusKey="";
        int scroll;
        Page(Section section) { this.section=section; }
    }
    private final EnumMap<Section,Page> pages=new EnumMap<>(Section.class);
    private TvRepository repository;
    private ArtworkLoader artwork;
    private LinearLayout body;
    private Button[] rail;
    private RecyclerView grid;
    private Page page;
    private Item detail;
    private SeriesDetail seriesDetail;
    private int selectedSeason;
    private long generation;
    private boolean stopped,destroyed,initialized,resumeReload;
    private AlertDialog dialog;
    private EditText loginCode;
    private LinearLayout loginForm;
    private ScrollView loginScroll;
    private String resizeFocus;
    private static final class FocusToken { final String key;FocusToken(String key){this.key=key;} }
    private TextView loginMessage;
    private TvLayout sizing;
    private int measuredWidth,measuredHeight;
    private boolean resizePosted;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN);
        repository=TvApplication.repository(this); artwork=new ArtworkLoader();
        for(Section section:Section.values())pages.put(section,new Page(section));
        page=pages.get(Section.HOME);
        if(state!=null) {
            try { page=pages.get(Section.valueOf(state.getString("section","HOME"))); } catch(IllegalArgumentException ignored) {}
            page.query=state.getString("query",""); page.category=state.getString("category",""); page.categoryTitle=state.getString("categoryTitle","Tümü");
            page.focusKey=state.getString("focusKey",""); page.scroll=state.getInt("scroll",0);
            Object saved=state.getSerializable("detail"); if(saved instanceof Item)detail=(Item)saved;
            selectedSeason=state.getInt("season",0);
        }
        if(!repository.hasSession())showLogin("");
        else if(detail!=null && detail.scope.equals(repository.currentScope()))showDetail(detail,false);
        else { detail=null; showPage(true,false); }
        initialized=true;
        View content=findViewById(android.R.id.content);
        content.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{
            TvLayout next=TvLayout.measure(this);
            if(next.width==measuredWidth && next.height==measuredHeight)return;
            measuredWidth=next.width;measuredHeight=next.height;
            if(resizePosted)return;resizePosted=true;
            v.post(()->{resizePosted=false;if(destroyed || stopped)return;resizeScreen();});
        });
    }
    @Override protected void onStart() { super.onStart(); stopped=false; }
    @Override protected void onResume() {
        super.onResume(); if(!initialized)return;
        boolean returning=resumeReload; resumeReload=false;
        if(!repository.hasSession()) { if(returning)showLogin(""); return; }
        if(returning && detail==null && page.catalog!=null)for(Item item:page.catalog.items) {
            if(!item.scope.equals(repository.currentScope())) { invalidateScopedCatalogs();break; }
        }
        if(body==null) { page=pages.get(Section.HOME);showPage(true,false); }
        else if(returning) {
            if(detail!=null)showDetail(detail,false);
            else if(page.section==Section.ACCOUNT)showAccount();
            else showPage(page.catalog==null,true);
        }
        final String scope=repository.currentScope(); final long ticket=generation;
        repository.refreshAccess(new TvRepository.Callback<Account>() {
            public void onResult(Account account) {
                if(!screenAlive(ticket))return;
                if(!scope.equals(repository.currentScope())) {
                    invalidateScopedCatalogs();detail=null;if(page.section==Section.ACCOUNT)showAccount();else showPage(true,false);
                } else if(!account.canPlay && page.section!=Section.ACCOUNT)showAccount();
            }
            public void onError(Failure failure) { if(screenAlive(ticket) && failure.code==Failure.Code.AUTH)sessionEnded(failure.message); }
        });
    }
    @Override protected void onStop() { captureGrid(); stopped=true;resumeReload=true;generation++;if(dialog!=null)dialog.dismiss();super.onStop(); }
    @Override protected void onDestroy() { destroyed=true; generation++; if(artwork!=null)artwork.close(); super.onDestroy(); }
    @Override protected void onSaveInstanceState(Bundle out) {
        captureGrid(); out.putString("section",page.section.name()); out.putString("query",page.query); out.putString("category",page.category);
        out.putString("categoryTitle",page.categoryTitle); out.putString("focusKey",page.focusKey); out.putInt("scroll",page.scroll);
        if(detail!=null)out.putSerializable("detail",detail); out.putInt("season",selectedSeason); super.onSaveInstanceState(out);
    }
    private boolean screenAlive(long ticket) { return !destroyed && !stopped && !isFinishing() && ticket==generation; }
    private boolean valid(long ticket,String scope) {
        // A remembered session bootstraps its first source inside the repository operation.
        // The repository rejects stale auth/source generations before delivering this callback.
        return screenAlive(ticket) && (scope.equals(repository.currentScope()) || (scope.isEmpty() && repository.hasSession()));
    }
    private void invalidateScopedCatalogs() {
        for(Page p:pages.values()){p.catalog=null;p.focusKey="";p.scroll=0;p.category="";p.categoryTitle="Tümü";p.query="";}
    }
    private <T> TvRepository.Callback<T> callback(long ticket,String scope,Result<T> result,Runnable retry) {
        return new TvRepository.Callback<T>() {
            public void onResult(T value) { if(valid(ticket,scope))result.accept(value); }
            public void onError(Failure failure) {
                if(!screenAlive(ticket) || failure.code==Failure.Code.STALE)return;
                if(failure.code==Failure.Code.AUTH && (scope.equals(repository.currentScope()) || !repository.hasSession()))sessionEnded(failure.message);
                else if(failure.code!=Failure.Code.AUTH && valid(ticket,scope))showFailure(failure.message,retry);
            }
        };
    }
    private interface Result<T> { void accept(T value); }
    private void sessionEnded(String message) { repository.logout(); for(Page p:pages.values()){p.catalog=null;p.focusKey="";p.query="";p.category="";p.categoryTitle="Tümü";} detail=null; showLogin(message); }
    private void resizeScreen() {
        if(!repository.hasSession()) {
            // Resize existing views: replacing the editor would detach the IME and invalidate a pending login.
            sizing=TvLayout.measure(this);
            if(loginScroll!=null)loginScroll.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,14),TvUi.dp(this,sizing.inset),TvUi.dp(this,14));
            if(loginForm!=null){ViewGroup.LayoutParams p=loginForm.getLayoutParams();p.width=TvUi.dp(this,Math.min(480,sizing.width-sizing.inset*2-8));loginForm.setLayoutParams(p);}
            return;
        }
        View focus=getCurrentFocus();boolean posterFocus=focus!=null && focus.getTag() instanceof String;
        resizeFocus=focusIdentity(focus);captureGrid();
        if(detail!=null) { if(detail.kind==Kind.SERIES && seriesDetail!=null)renderSeries();else showDetail(detail,false); }
        else if(page.section==Section.ACCOUNT)showAccount();else showPage(page.catalog==null,posterFocus);
        restoreResizeFocus();
    }
    private void markFocus(View view,String key){view.setTag(new FocusToken(key));}
    private String focusIdentity(View view) {
        if(view==null)return null;Object tag=view.getTag();
        if(tag instanceof FocusToken)return ((FocusToken)tag).key;
        return tag instanceof String?"poster:"+tag:null;
    }
    private View findFocus(View root,String key) {
        if(key.equals(focusIdentity(root)) && root.isFocusable() && root.getVisibility()==View.VISIBLE)return root;
        if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){View found=findFocus(((ViewGroup)root).getChildAt(n),key);if(found!=null)return found;}
        return null;
    }
    private void restoreResizeFocus(){restoreResizeFocus(false);}
    private void restoreResizeFocus(boolean completeSurface) {
        final String wanted=resizeFocus;if(wanted==null)return;
        View content=findViewById(android.R.id.content);
        content.post(()->{
            if(destroyed || !wanted.equals(resizeFocus))return;
            View target=findFocus(content,wanted);
            if(target!=null){target.requestFocus();resizeFocus=null;}else if(completeSurface)resizeFocus=null;
        });
    }
    private void showLogin(String message) {
        generation++; detail=null; body=null; grid=null;resizeFocus=null;sizing=TvLayout.measure(this);measuredWidth=sizing.width;measuredHeight=sizing.height;
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        ScrollView background=new ScrollView(this);loginScroll=background;background.setTag("tv-login");background.setFillViewport(true);background.setBackgroundColor(TvUi.BACKGROUND);
        background.setClipToPadding(false);background.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,14),TvUi.dp(this,sizing.inset),TvUi.dp(this,14));
        LinearLayout center=TvUi.column(this);center.setGravity(Gravity.CENTER);background.addView(center,new ScrollView.LayoutParams(-1,-2));
        LinearLayout form=TvUi.column(this);loginForm=form;form.setGravity(Gravity.CENTER_HORIZONTAL);
        center.addView(form,new LinearLayout.LayoutParams(TvUi.dp(this,Math.min(480,sizing.width-sizing.inset*2-8)),-2));
        ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.flixify_logo);logo.setContentDescription("Flixify");logo.setScaleType(ImageView.ScaleType.FIT_CENTER);form.addView(logo,TvUi.space(this,220,sizing.shortScreen?44:66));
        TextView title=TvUi.text(this,"TV'de izlemeye başlayın",sizing.compact?23:28,TvUi.WHITE);TvUi.heading(title);form.addView(title,TvUi.space(this,-1,-2));
        TextView hint=TvUi.text(this,"16 karakterli hesap kodunuzla giriş yapın.",16,TvUi.MUTED);form.addView(hint,TvUi.space(this,-1,-2));
        loginCode=new EditText(this);loginCode.setId(View.generateViewId());loginCode.setTextColor(TvUi.WHITE);loginCode.setTextSize(22);loginCode.setSingleLine(true);
        loginCode.setHint("Giriş kodu");loginCode.setHintTextColor(TvUi.MUTED);loginCode.setContentDescription("16 karakterli giriş kodu");
        loginCode.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);loginCode.setFilters(new InputFilter[]{new InputFilter.LengthFilter(16)});
        loginCode.setImeOptions(EditorInfo.IME_ACTION_GO);loginCode.setPadding(TvUi.dp(this,16),TvUi.dp(this,8),TvUi.dp(this,16),TvUi.dp(this,8));loginCode.setBackground(TvUi.focusBackground(this));form.addView(loginCode,TvUi.space(this,-1,54));
        Button submit=TvUi.button(this,"Giriş yap",this::login);form.addView(submit,TvUi.space(this,-1,48));loginCode.setNextFocusDownId(submit.getId());submit.setNextFocusUpId(loginCode.getId());
        loginCode.setOnKeyListener((v,key,event)->{if(key==KeyEvent.KEYCODE_DPAD_DOWN && event.getAction()==KeyEvent.ACTION_DOWN){submit.requestFocus();return true;}return false;});
        loginCode.setOnEditorActionListener((v,action,event)->{if(action==EditorInfo.IME_ACTION_GO){login();return true;}return false;});
        loginMessage=TvUi.text(this,message,15,TvUi.ACCENT);loginMessage.setMinHeight(TvUi.dp(this,26));form.addView(loginMessage,TvUi.space(this,-1,-2));
        TextView remember=TvUi.text(this,"Oturumunuz bu cihazda güvenle hatırlanır.",14,TvUi.MUTED);form.addView(remember,TvUi.space(this,-1,-2));
        setContentView(background);loginCode.requestFocus();
    }
    private void login() {
        String code=loginCode.getText().toString().trim();
        if(code.length()!=16) {
            loginMessage.setText("16 karakterli giriş kodunuzu yazın.");
            loginMessage.post(()->loginMessage.requestRectangleOnScreen(new android.graphics.Rect(0,0,loginMessage.getWidth(),loginMessage.getHeight()),true));return;
        }
        ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(loginCode.getWindowToken(),0);
        final long ticket=++generation; loginMessage.setText("Giriş yapılıyor…"); loginCode.setEnabled(false);
        repository.login(code,new TvRepository.Callback<Account>() {
            public void onResult(Account account) {
                if(destroyed || stopped || ticket!=generation)return;
                loginCode.setText(""); page=pages.get(Section.HOME); detail=null; showPage(true,false);
            }
            public void onError(Failure failure) {
                if(destroyed || stopped || ticket!=generation)return;
                loginCode.setEnabled(true); loginMessage.setText(safeMessage(failure.message)); loginCode.requestFocus();
            }
        });
    }
    private void shell(String title,String subtitle) {
        generation++;grid=null;sizing=TvLayout.measure(this);measuredWidth=sizing.width;measuredHeight=sizing.height;
        LinearLayout root=TvUi.row(this);root.setTag("tv-catalog-shell");root.setGravity(Gravity.TOP);root.setBackgroundColor(TvUi.BACKGROUND);
        root.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,sizing.shortScreen?10:18),TvUi.dp(this,sizing.inset),TvUi.dp(this,sizing.shortScreen?10:16));
        ScrollView railScroll=new ScrollView(this);railScroll.setVerticalScrollBarEnabled(false);railScroll.setFillViewport(false);railScroll.setClipToPadding(false);
        root.addView(railScroll,new LinearLayout.LayoutParams(TvUi.dp(this,sizing.rail),-1));
        LinearLayout navigation=TvUi.column(this);navigation.setPadding(0,0,TvUi.dp(this,8),0);railScroll.addView(navigation,new ScrollView.LayoutParams(-1,-2));
        ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.flixify_logo);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setContentDescription("Flixify");navigation.addView(logo,TvUi.space(this,-1,sizing.shortScreen?36:52));
        rail=new Button[NAV.length];
        for(int n=0;n<NAV.length;n++) {
            final Section target=Section.values()[n];Button b=TvUi.button(this,NAV[n],()->navigate(target));b.setBackground(TvUi.railBackground(this));b.setTextSize(sizing.compact?14:15);b.setPadding(TvUi.dp(this,12),0,TvUi.dp(this,10),0);
            b.setGravity(Gravity.CENTER_VERTICAL|Gravity.START);b.setSelected(target==page.section);b.setSingleLine(true);
            markFocus(b,"rail:"+n);navigation.addView(b,TvUi.space(this,-1,44));rail[n]=b;
        }
        for(int n=0;n<rail.length;n++){if(n>0)rail[n].setNextFocusUpId(rail[n-1].getId());if(n<rail.length-1)rail[n].setNextFocusDownId(rail[n+1].getId());rail[n].setNextFocusLeftId(rail[n].getId());}
        body=TvUi.column(this);body.setPadding(TvUi.dp(this,sizing.gap),0,0,0);root.addView(body,new LinearLayout.LayoutParams(0,-1,1));
        TextView heading=TvUi.text(this,title,sizing.shortScreen?22:28,TvUi.WHITE);TvUi.heading(heading);heading.setSingleLine(true);heading.setEllipsize(TextUtils.TruncateAt.END);body.addView(heading,TvUi.space(this,-1,sizing.heading));
        if(subtitle!=null && !subtitle.isEmpty() && !sizing.shortScreen){TextView sub=TvUi.text(this,subtitle,14,TvUi.MUTED);sub.setSingleLine(true);sub.setEllipsize(TextUtils.TruncateAt.END);body.addView(sub,TvUi.space(this,-1,24));}
        setContentView(root);rail[page.section.ordinal()].requestFocus();restoreResizeFocus();
    }
    private void navigate(Section target) {
        resizeFocus=null;captureGrid(); detail=null; seriesDetail=null; page=pages.get(target);
        if(target==Section.ACCOUNT)showAccount(); else showPage(target==Section.FAVORITES || page.catalog==null,false);
    }
    private Kind pageKind() { return page.section==Section.LIVE?Kind.LIVE:page.section==Section.SERIES?Kind.SERIES:Kind.MOVIE; }
    private String pageTitle() { return page.section==Section.HOME?"Sizin için":NAV[page.section.ordinal()]; }
    private void showPage(boolean reload,boolean contentFocus) {
        detail=null; shell(pageTitle(),page.section==Section.HOME?"Filmler, diziler ve canlı yayınlar tek yerde.":"");
        if(!reload && page.catalog!=null) { renderCatalog(contentFocus); return; }
        TextView loading=TvUi.text(this,"Yükleniyor…",20,TvUi.MUTED); body.addView(loading,TvUi.space(this,-1,64));
        final long ticket=generation; final String scope=repository.currentScope();
        if(page.section==Section.FAVORITES) repository.favorites(callback(ticket,scope,items->{
            page.catalog=new Catalog(Kind.MOVIE,items,new ArrayList<>()); replaceCatalog(contentFocus);
        },()->showPage(true,true)));
        else repository.catalog(pageKind(),reload,callback(ticket,scope,catalog->{page.catalog=catalog;replaceCatalog(contentFocus);},()->showPage(true,true)));
    }
    private void replaceCatalog(boolean contentFocus) { shell(pageTitle(),page.section==Section.HOME?"Filmler, diziler ve canlı yayınlar tek yerde.":""); renderCatalog(contentFocus); }
    private void captureGrid() {
        if(grid==null || page==null)return;
        RecyclerView.LayoutManager layout=grid.getLayoutManager(); if(layout instanceof GridLayoutManager)page.scroll=Math.max(0,((GridLayoutManager)layout).findFirstVisibleItemPosition());
        View focus=getCurrentFocus(); if(focus!=null && focus.getTag() instanceof String)page.focusKey=(String)focus.getTag();
    }
    private void linkContent(View first) { for(Button b:rail)b.setNextFocusRightId(first.getId()); first.setNextFocusLeftId(rail[page.section.ordinal()].getId()); }
    private void renderCatalog(boolean contentFocus) {
        if(page.section==Section.HOME && sizing.hero>0 && !page.catalog.items.isEmpty())addHomeHero(page.catalog.items.get(0));
        LinearLayout controls=TvUi.row(this);body.addView(controls,TvUi.space(this,-1,50));
        Button search=TvUi.button(this,"Ara",this::search);markFocus(search,"catalog:search");controls.addView(search,TvUi.space(this,sizing.compact?66:78,42));
        Button category=TvUi.button(this,"Kategori: "+page.categoryTitle,this::categories);markFocus(category,"catalog:category");category.setSingleLine(true);category.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams categorySpace=TvUi.space(this,0,42);categorySpace.weight=1;controls.addView(category,categorySpace);
        Button refresh=TvUi.button(this,"Yenile",()->showPage(true,true));markFocus(refresh,"catalog:refresh");controls.addView(refresh,TvUi.space(this,sizing.compact?78:92,42));
        linkContent(search); search.setNextFocusRightId(category.getId()); category.setNextFocusLeftId(search.getId()); category.setNextFocusRightId(refresh.getId()); refresh.setNextFocusLeftId(category.getId());
        List<Item> filtered=new ArrayList<>(); String query=page.query.toLowerCase(Locale.forLanguageTag("tr-TR"));
        for(Item item:page.catalog.items)if((page.category.isEmpty() || page.category.equals(item.categoryId)) && item.title.toLowerCase(Locale.forLanguageTag("tr-TR")).contains(query))filtered.add(item);
        if(!page.query.isEmpty())body.addView(TvUi.text(this,"Arama: "+page.query+" · "+filtered.size()+" sonuç",15,TvUi.MUTED),TvUi.space(this,-1,30));
        if(filtered.isEmpty()) {
            body.addView(TvUi.text(this,page.section==Section.FAVORITES?"Henüz favoriniz yok. Bir içeriği açıp favorilere ekleyin.":"İçerik bulunamadı.",18,TvUi.MUTED),TvUi.space(this,-1,72));
            if(contentFocus)search.requestFocus();restoreResizeFocus(true);return;
        }
        grid=new RecyclerView(this); grid.setId(View.generateViewId()); grid.setClipToPadding(false); grid.setPadding(0,TvUi.dp(this,8),0,TvUi.dp(this,12)); grid.setItemAnimator(null);
        grid.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS); grid.setFocusable(false);
        int columns=sizing.columns();
        GridLayoutManager layout=new GridLayoutManager(this,columns); grid.setLayoutManager(layout); grid.setHasFixedSize(true); grid.setItemViewCacheSize(columns*2);
        PosterAdapter adapter=new PosterAdapter(filtered,search.getId(),columns); grid.setAdapter(adapter); body.addView(grid,new LinearLayout.LayoutParams(-1,0,1)); layout.scrollToPositionWithOffset(Math.min(page.scroll,filtered.size()-1),0);
        final String restoreKey=page.focusKey; if(contentFocus)grid.post(()->{
            if(grid==null || detail!=null)return;
            int position=0; for(int n=0;n<filtered.size();n++)if(filtered.get(n).key().equals(restoreKey)){position=n;break;}
            grid.scrollToPosition(position); final int wanted=position; grid.post(()->{if(grid!=null){RecyclerView.ViewHolder holder=grid.findViewHolderForAdapterPosition(wanted);if(holder!=null)holder.itemView.requestFocus();else search.requestFocus();}});
        });
        restoreResizeFocus(true);
    }
    private void addHomeHero(Item item) {
        FrameLayout hero=new FrameLayout(this);hero.setTag("tv-home-hero");hero.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{TvUi.PANEL,TvUi.BACKGROUND,TvUi.PANEL}));hero.setClipToOutline(true);hero.setContentDescription(item.title);
        body.addView(hero,TvUi.space(this,-1,sizing.hero));
        ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);hero.addView(image,new FrameLayout.LayoutParams(-1,-1));loadArtwork(image,item.artwork);
        View shade=new View(this);shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,new int[]{TvUi.BACKGROUND,0xdd07090c,0x3307090c}));hero.addView(shade,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout story=TvUi.column(this);story.setGravity(Gravity.CENTER_VERTICAL);story.setPadding(TvUi.dp(this,22),TvUi.dp(this,12),TvUi.dp(this,22),TvUi.dp(this,12));hero.addView(story,new FrameLayout.LayoutParams(-1,-1));
        TextView eyebrow=TvUi.text(this,item.categoryName.isEmpty()?"FLIXIFY":item.categoryName.toUpperCase(Locale.forLanguageTag("tr-TR")),12,TvUi.ACCENT);eyebrow.setSingleLine(true);story.addView(eyebrow,new LinearLayout.LayoutParams(-1,-2));
        TextView title=TvUi.text(this,item.title,30,TvUi.WHITE);TvUi.heading(title);title.setMaxLines(2);title.setEllipsize(TextUtils.TruncateAt.END);story.addView(title,new LinearLayout.LayoutParams(-1,-2));
        if(!item.description.isEmpty()){TextView description=TvUi.text(this,item.description,14,TvUi.MUTED);description.setMaxLines(2);description.setEllipsize(TextUtils.TruncateAt.END);story.addView(description,new LinearLayout.LayoutParams(-1,-2));}
    }
    private final class PosterAdapter extends RecyclerView.Adapter<PosterHolder> {
        private final List<Item> items; private final int toolbar,columns;
        PosterAdapter(List<Item> items,int toolbar,int columns) { this.items=items;this.toolbar=toolbar;this.columns=columns; setHasStableIds(true); }
        @Override public long getItemId(int p) { return p; }
        @Override public int getItemCount() { return items.size(); }
        @Override public PosterHolder onCreateViewHolder(ViewGroup parent,int type) {
            LinearLayout card=TvUi.column(MainActivity.this); card.setId(View.generateViewId()); card.setFocusable(true); card.setFocusableInTouchMode(true); card.setBackground(TvUi.focusBackground(MainActivity.this)); card.setPadding(TvUi.dp(MainActivity.this,5),TvUi.dp(MainActivity.this,5),TvUi.dp(MainActivity.this,5),TvUi.dp(MainActivity.this,5));
            RecyclerView.LayoutParams p=new RecyclerView.LayoutParams(-1,TvUi.dp(MainActivity.this,sizing.cardHeight(page.section==Section.HOME))); p.setMargins(TvUi.dp(MainActivity.this,4),TvUi.dp(MainActivity.this,4),TvUi.dp(MainActivity.this,4),TvUi.dp(MainActivity.this,4)); card.setLayoutParams(p);
            ImageView image=new ImageView(MainActivity.this); image.setScaleType(ImageView.ScaleType.CENTER_CROP); image.setBackground(TvUi.shape(MainActivity.this,0xff202733,0)); card.addView(image,new LinearLayout.LayoutParams(-1,0,1));
            TextView title=TvUi.text(MainActivity.this,"",16,TvUi.WHITE); title.setMaxLines(2); title.setEllipsize(TextUtils.TruncateAt.END); title.setPadding(TvUi.dp(MainActivity.this,5),TvUi.dp(MainActivity.this,5),TvUi.dp(MainActivity.this,5),0); card.addView(title,new LinearLayout.LayoutParams(-1,TvUi.dp(MainActivity.this,sizing.shortScreen?42:50)));
            return new PosterHolder(card,image,title);
        }
        @Override public void onBindViewHolder(PosterHolder holder,int position) {
            Item item=items.get(position); holder.title.setText(item.title); holder.itemView.setTag(item.key()); holder.itemView.setContentDescription(item.title);
            holder.itemView.setNextFocusLeftId(position%columns==0?rail[page.section.ordinal()].getId():View.NO_ID); holder.itemView.setNextFocusUpId(position<columns?toolbar:View.NO_ID);
            holder.itemView.setOnFocusChangeListener((v,focus)->{if(focus){page.focusKey=item.key();int positionNow=holder.getBindingAdapterPosition();if(grid!=null && positionNow!=RecyclerView.NO_POSITION)grid.scrollToPosition(positionNow);}});
            holder.itemView.setOnClickListener(v->{captureGrid();showDetail(item,true);}); loadArtwork(holder.image,item.artwork);
        }
        @Override public void onViewRecycled(PosterHolder holder) { artwork.unbind(holder.image); holder.itemView.setOnFocusChangeListener(null); }
    }
    private static final class PosterHolder extends RecyclerView.ViewHolder {
        final ImageView image; final TextView title;
        PosterHolder(View view,ImageView image,TextView title) { super(view);this.image=image;this.title=title; }
    }
    private void search() {
        EditText field=new EditText(this); field.setSingleLine(true); field.setText(page.query); field.setSelectAllOnFocus(true); field.setTextColor(TvUi.WHITE); field.setHintTextColor(TvUi.MUTED); field.setHint("İçerik adı"); field.setTextSize(22); field.setPadding(TvUi.dp(this,24),TvUi.dp(this,12),TvUi.dp(this,24),TvUi.dp(this,12)); field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        Runnable apply=()->{page.query=field.getText().toString().trim();page.scroll=0;page.focusKey="";if(dialog!=null)dialog.dismiss();showPage(false,true);};
        dialog=new AlertDialog.Builder(this).setTitle("İçerik ara").setView(field).setPositiveButton("Ara",(d,w)->apply.run()).setNegativeButton("Vazgeç",null).create();
        field.setOnEditorActionListener((v,action,event)->{if(action==EditorInfo.IME_ACTION_SEARCH || (event!=null && event.getKeyCode()==KeyEvent.KEYCODE_ENTER && event.getAction()==KeyEvent.ACTION_DOWN)){apply.run();return true;}return false;});
        field.setOnKeyListener((v,key,event)->{
            if(key==KeyEvent.KEYCODE_DPAD_DOWN && event.getAction()==KeyEvent.ACTION_DOWN){dialog.getButton(AlertDialog.BUTTON_POSITIVE).requestFocus();return true;}
            return false;
        });
        dialog.setOnShowListener(d->{
            if(dialog.getWindow()!=null)dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
            field.requestFocus();
        }); dialog.show();
    }
    private void categories() {
        List<Category> rows=new ArrayList<>(); rows.add(new Category("","Tümü")); rows.addAll(page.catalog.categories);
        if(rows.size()==1)for(Item item:page.catalog.items) { boolean found=false;for(Category c:rows)if(c.id.equals(item.categoryId)){found=true;break;}if(!found && !item.categoryId.isEmpty())rows.add(new Category(item.categoryId,item.categoryName)); }
        String[] titles=new String[rows.size()];int checked=0;for(int n=0;n<rows.size();n++){titles[n]=rows.get(n).title;if(rows.get(n).id.equals(page.category))checked=n;}
        final int selection=checked;
        dialog=new AlertDialog.Builder(this).setTitle("Kategori seçin").setSingleChoiceItems(titles,checked,(d,which)->{
            page.category=rows.get(which).id;page.categoryTitle=rows.get(which).title;page.focusKey="";page.scroll=0;d.dismiss();showPage(false,true);
        }).setNegativeButton("Vazgeç",null).create();
        dialog.setOnShowListener(d->{dialog.getListView().requestFocus();dialog.getListView().setSelection(selection);});dialog.show();
    }
    private void showDetail(Item item,boolean newItem) {
        if(!item.scope.equals(repository.currentScope())) {
            detail=null;seriesDetail=null;invalidateScopedCatalogs();showPage(true,false);return;
        }
        detail=item;if(newItem)selectedSeason=0;
        shell(item.title,item.kind==Kind.LIVE?"Canlı yayın":item.kind==Kind.SERIES?"Dizi":item.categoryName);
        if(item.kind==Kind.SERIES) { loadSeries(item); return; }
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);LinearLayout inner=TvUi.column(this);scroll.addView(inner);body.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        inner.addView(storyPanel(item),TvUi.space(this,-1,-2));
        LinearLayout actions=TvUi.row(this);inner.addView(actions,TvUi.space(this,-1,56));
        Button play=TvUi.button(this,item.kind==Kind.LIVE?"Canlı izle":"İzle",()->play(item));markFocus(play,"detail:play");actions.addView(play,TvUi.space(this,sizing.compact?108:140,48));
        Button favorite=favoriteButton(item);LinearLayout.LayoutParams favoriteSpace=TvUi.space(this,0,48);favoriteSpace.weight=1;actions.addView(favorite,favoriteSpace);
        play.setNextFocusRightId(favorite.getId());favorite.setNextFocusLeftId(play.getId());linkContent(play);play.requestFocus();
        TextView back=TvUi.text(this,"Geri: listeye dön",14,TvUi.MUTED);inner.addView(back,TvUi.space(this,-1,30));
        if(item.kind==Kind.LIVE) {
            TextView epg=TvUi.text(this,"Yayın akışı yükleniyor…",17,TvUi.MUTED);inner.addView(epg,TvUi.space(this,-1,-2));
            final long ticket=generation;String scope=repository.currentScope();repository.epg(item,new TvRepository.Callback<List<Programme>>() {
                public void onResult(List<Programme> rows) { if(!valid(ticket,scope))return;StringBuilder text=new StringBuilder("Yayın akışı");for(int n=0;n<Math.min(rows.size(),8);n++){Programme p=rows.get(n);text.append("\n").append(DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(p.startsAtMs))).append("  ").append(p.title);}if(rows.isEmpty())text.append("\nYayın bilgisi bulunamadı.");epg.setText(text); }
                public void onError(Failure failure) { if(valid(ticket,scope))epg.setText("Yayın bilgisi şu anda alınamıyor."); }
            });
        }
        restoreResizeFocus(true);
    }
    private View storyPanel(Item item) {
        LinearLayout panel=TvUi.row(this);panel.setTag("tv-detail-artwork");panel.setGravity(Gravity.TOP);panel.setBackground(TvUi.shape(this,TvUi.PANEL,0));panel.setPadding(TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12));
        int artWidth=sizing.shortScreen?72:sizing.compact?104:132;
        ImageView poster=new ImageView(this);poster.setBackground(TvUi.shape(this,TvUi.BACKGROUND,0));poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        panel.addView(poster,new LinearLayout.LayoutParams(TvUi.dp(this,artWidth),TvUi.dp(this,artWidth*3/2)));loadArtwork(poster,item.artwork);
        LinearLayout info=TvUi.column(this);info.setPadding(TvUi.dp(this,16),0,0,0);panel.addView(info,new LinearLayout.LayoutParams(0,-2,1));
        TextView category=TvUi.text(this,item.categoryName.isEmpty()?(item.kind==Kind.LIVE?"CANLI YAYIN":item.kind==Kind.SERIES?"DİZİ":"FİLM"):item.categoryName,12,TvUi.ACCENT);category.setMaxLines(1);category.setEllipsize(TextUtils.TruncateAt.END);info.addView(category,new LinearLayout.LayoutParams(-1,-2));
        TextView title=TvUi.text(this,item.title,sizing.shortScreen?18:24,TvUi.WHITE);TvUi.heading(title);title.setMaxLines(sizing.shortScreen?2:3);title.setEllipsize(TextUtils.TruncateAt.END);info.addView(title,new LinearLayout.LayoutParams(-1,-2));
        if(!item.description.isEmpty() && !sizing.shortScreen){TextView description=TvUi.text(this,item.description,15,TvUi.MUTED);description.setMaxLines(sizing.compact?3:5);description.setEllipsize(TextUtils.TruncateAt.END);info.addView(description,new LinearLayout.LayoutParams(-1,-2));}
        return panel;
    }
    private void loadArtwork(ImageView image,String address) {
        artwork.load(image,address);
        if(address==null || address.isEmpty()) {image.setImageResource(R.drawable.flixify_logo);image.setScaleType(ImageView.ScaleType.FIT_CENTER);image.setPadding(TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12));image.setImageAlpha(90);}
        else {image.setScaleType(ImageView.ScaleType.CENTER_CROP);image.setPadding(0,0,0,0);image.setImageAlpha(255);}
    }
    private Button favoriteButton(Item item) {
        Button favorite=TvUi.button(this,repository.isFavorite(item)?"Favorilerden çıkar":"Favorilere ekle",()->{});markFocus(favorite,"detail:favorite");
        favorite.setOnClickListener(v->{final long ticket=generation;String scope=repository.currentScope();favorite.setEnabled(false);
            repository.toggleFavorite(item,new TvRepository.Callback<Boolean>() {
                public void onResult(Boolean saved) { if(valid(ticket,scope)){favorite.setEnabled(true);favorite.setText(saved?"Favorilerden çıkar":"Favorilere ekle");favorite.requestFocus();pages.get(Section.FAVORITES).catalog=null;} }
                public void onError(Failure failure) { if(valid(ticket,scope)){favorite.setEnabled(true);notice(safeMessage(failure.message));} }
            });
        });return favorite;
    }
    private void loadSeries(Item item) {
        TextView loading=TvUi.text(this,"Bölümler yükleniyor…",20,TvUi.MUTED);body.addView(loading,TvUi.space(this,-1,64));
        final long ticket=generation;String scope=repository.currentScope();repository.series(item,callback(ticket,scope,value->{seriesDetail=value;renderSeries();},()->showDetail(item,false)));
    }
    private void renderSeries() {
        shell(detail.title,"Sezonu ve bölümü kumandayla seçin.");
        if(seriesDetail.seasons.isEmpty()) { showFailure("Bölüm bulunamadı.",()->showDetail(detail,false));return; }
        selectedSeason=Math.max(0,Math.min(selectedSeason,seriesDetail.seasons.size()-1));
        // Artwork, seasons and episodes share a viewport so no fixed header can crowd out an action.
        LinearLayout seriesContent=scrollContent();
        if(!sizing.shortScreen)seriesContent.addView(storyPanel(detail),TvUi.space(this,-1,-2));
        android.widget.HorizontalScrollView seasonScroll=new android.widget.HorizontalScrollView(this);seasonScroll.setHorizontalScrollBarEnabled(false);LinearLayout seasons=TvUi.row(this);seasonScroll.addView(seasons);seriesContent.addView(seasonScroll,TvUi.space(this,-1,58));
        List<Button> seasonButtons=new ArrayList<>();for(int n=0;n<seriesDetail.seasons.size();n++) {
            final int position=n;Button season=TvUi.button(this,seriesDetail.seasons.get(n).number+". Sezon",()->{selectedSeason=position;renderSeries();});season.setSelected(n==selectedSeason);markFocus(season,"season:"+seriesDetail.seasons.get(n).number);seasons.addView(season,TvUi.space(this,-2,46));seasonButtons.add(season);
        }
        for(int n=0;n<seasonButtons.size();n++){if(n>0)seasonButtons.get(n).setNextFocusLeftId(seasonButtons.get(n-1).getId());if(n<seasonButtons.size()-1)seasonButtons.get(n).setNextFocusRightId(seasonButtons.get(n+1).getId());}
        LinearLayout episodes=TvUi.column(this);seriesContent.addView(episodes,new LinearLayout.LayoutParams(-1,-2));
        Button firstEpisode=null;Button prior=null;for(Item episode:seriesDetail.seasons.get(selectedSeason).episodes) {
            Button b=TvUi.button(this,episode.episode+". Bölüm · "+episode.title,()->play(episode));markFocus(b,"episode:"+episode.key());b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setMaxLines(2);b.setEllipsize(TextUtils.TruncateAt.END);b.setNextFocusLeftId(rail[page.section.ordinal()].getId());episodes.addView(b,TvUi.space(this,-1,56));
            if(firstEpisode==null)firstEpisode=b;if(prior!=null){prior.setNextFocusDownId(b.getId());b.setNextFocusUpId(prior.getId());}prior=b;
        }
        Button favorite=favoriteButton(detail);episodes.addView(favorite,TvUi.space(this,-2,48));if(prior!=null){prior.setNextFocusDownId(favorite.getId());favorite.setNextFocusUpId(prior.getId());}
        if(firstEpisode!=null){firstEpisode.setNextFocusUpId(seasonButtons.get(selectedSeason).getId());for(Button season:seasonButtons)season.setNextFocusDownId(firstEpisode.getId());}
        favorite.setNextFocusLeftId(rail[page.section.ordinal()].getId());
        linkContent(seasonButtons.get(0));seasonButtons.get(selectedSeason).requestFocus();restoreResizeFocus(true);
    }
    private void play(Item item) {
        if(!item.scope.equals(repository.currentScope())) { notice("Kaynak değişti. Listeyi yenileyin.");return; }
        Intent intent=new Intent(this,PlayerActivity.class);intent.putExtra(PlayerActivity.EXTRA_ITEM,item);startActivity(intent);
    }
    private LinearLayout scrollContent() {
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setClipToPadding(false);
        LinearLayout inner=TvUi.column(this);inner.setPadding(0,TvUi.dp(this,8),0,TvUi.dp(this,16));scroll.addView(inner,new ScrollView.LayoutParams(-1,-2));body.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));return inner;
    }
    private void showAccount() {
        detail=null;page=pages.get(Section.ACCOUNT);shell("Hesabım","");
        LinearLayout loading=scrollContent();loading.addView(TvUi.text(this,"Hesap yükleniyor…",20,TvUi.MUTED),TvUi.space(this,-1,64));linkContent(addLocalLogout(loading));
        final long ticket=generation;String scope=repository.currentScope();repository.account(true,callback(ticket,scope,account->{
            String accountFocus=focusIdentity(getCurrentFocus());
            shell("Hesabım","");LinearLayout inner=scrollContent();
            TextView packageTitle=TvUi.text(this,account.packageTitle,26,TvUi.WHITE);TvUi.heading(packageTitle);inner.addView(packageTitle,TvUi.space(this,-1,-2));
            inner.addView(TvUi.text(this,"Hesap kodu: •••• "+account.codeSuffix,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            String expiry=account.expiresAtMs>0?DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(new Date(account.expiresAtMs)):"Belirtilmedi";
            inner.addView(TvUi.text(this,"Bitiş: "+expiry,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            TextView message=TvUi.text(this,account.message.isEmpty()?(account.canPlay?"Hesabınız aktif":"İzleme erişimi bulunmuyor."):account.message,18,account.canPlay?TvUi.MUTED:TvUi.ACCENT);inner.addView(message,TvUi.space(this,-1,-2));
            linkContent(addLocalLogout(inner));if(resizeFocus==null)resizeFocus=accountFocus;restoreResizeFocus(true);
        },this::showAccount));
    }
    private Button addLocalLogout(LinearLayout parent) {
        Button logout=TvUi.button(this,"Oturumu kapat",this::confirmLogout);markFocus(logout,"account:logout");parent.addView(logout,TvUi.space(this,Math.min(230,sizing.contentWidth()-8),48));return logout;
    }
    private void confirmLogout() {
        dialog=new AlertDialog.Builder(this).setTitle("Oturum kapatılsın mı?").setMessage("Bu cihazda tekrar giriş yapmak için hesap kodunuz gerekir.")
            .setNegativeButton("Vazgeç",null).setPositiveButton("Oturumu kapat",(d,w)->sessionEnded("")).create();
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());dialog.show();
    }
    private String safeMessage(String message) { return message==null || message.trim().isEmpty()?"İşlem tamamlanamadı. Lütfen tekrar deneyin.":message; }
    private void showFailure(String message,Runnable retry) {
        while(body.getChildCount()>1)body.removeViewAt(1);
        LinearLayout inner=scrollContent();
        TextView text=TvUi.text(this,safeMessage(message),20,TvUi.MUTED);inner.addView(text,TvUi.space(this,-1,-2));
        Button logout=page.section==Section.ACCOUNT && detail==null?addLocalLogout(inner):null;
        Button button=TvUi.button(this,"Tekrar dene",retry);markFocus(button,"content:retry");inner.addView(button,TvUi.space(this,Math.min(220,sizing.contentWidth()-8),48));
        if(logout!=null){linkContent(logout);logout.setNextFocusDownId(button.getId());button.setNextFocusUpId(logout.getId());}
        else linkContent(button);restoreResizeFocus(true);
    }
    private void notice(String message) { dialog=new AlertDialog.Builder(this).setMessage(message).setPositiveButton("Tamam",null).create();dialog.show(); }
    @Override public void onBackPressed() {
        if(body==null) { super.onBackPressed();return; }
        if(detail!=null) { detail=null;seriesDetail=null;showPage(false,true);return; }
        if(!page.query.isEmpty() || !page.category.isEmpty()) { page.query="";page.category="";page.categoryTitle="Tümü";page.scroll=0;page.focusKey="";showPage(false,true);return; }
        View focus=getCurrentFocus();boolean inRail=false;for(Button b:rail)if(focus==b)inRail=true;
        if(!inRail) { rail[page.section.ordinal()].requestFocus();return; }
        if(page.section!=Section.HOME) { navigate(Section.HOME);return; }
        dialog=new AlertDialog.Builder(this).setTitle("Flixify'dan çıkılsın mı?").setNegativeButton("Vazgeç",null).setPositiveButton("Çık",(d,w)->finish()).create();dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());dialog.show();
    }
}
