package vip.flixify.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextUtils;
import android.graphics.drawable.GradientDrawable;
import android.widget.FrameLayout;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.SoundEffectConstants;
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
        String query="",category="",categoryTitle="Tümü",focusKey="",catalogScope="";
        int scroll;
        Page(Section section) { this.section=section; }
    }
    private final EnumMap<Section,Page> pages=new EnumMap<>(Section.class);
    private TvRepository repository;
    private ArtworkLoader artwork;
    private PosterFocusSound posterSound;
    private TvUpdatePanel updatePanel;
    private AutoCloseable catalogObservation;
    private long observationEpoch;
    private final EnumMap<Kind,Catalog> pendingCatalogUpdates=new EnumMap<>(Kind.class);
    private final EnumMap<Kind,String> pendingCatalogScopes=new EnumMap<>(Kind.class);
    private LinearLayout body;
    private Button[] rail;
    private RecyclerView grid;
    private Page page;
    private long generation;
    private boolean stopped,destroyed,initialized,resumeReload,playerLaunching;
    private Dialog dialog,catalogDialog;
    private boolean resizeAfterCatalog;
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
        repository=TvApplication.repository(this); artwork=new ArtworkLoader(this);posterSound=PosterFocusSound.create(this);updatePanel=new TvUpdatePanel(this);
        for(Section section:Section.values())pages.put(section,new Page(section));
        page=pages.get(Section.HOME);
        if(state!=null) {
            try { page=pages.get(Section.valueOf(state.getString("section","HOME"))); } catch(IllegalArgumentException ignored) {}
            page.query=state.getString("query",""); page.category=state.getString("category",""); page.categoryTitle=state.getString("categoryTitle","Tümü");
            page.focusKey=state.getString("focusKey",""); page.scroll=state.getInt("scroll",0);
            resizeFocus=state.getString("controlFocus");
        }
        if(!repository.hasSession())showLogin("");
        else if(page.section==Section.ACCOUNT)showAccount();
        else showPage(false,false);
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
    @Override protected void onStart() {
        super.onStart();stopped=false;
        final long epoch=++observationEpoch;
        catalogObservation=repository.observeCatalog(catalog->{if(epoch==observationEpoch)receiveCatalog(catalog);});
    }
    @Override protected void onResume() {
        super.onResume();playerLaunching=false;posterSound.resume();updatePanel.resumed(); if(!initialized)return;
        boolean returning=resumeReload; resumeReload=false;
        if(!repository.hasSession()) { if(returning)showLogin(""); return; }
        discardPreviousSource();
        if(body==null) { page=pages.get(Section.HOME);showPage(false,false); }
        else if(returning) {
            if(page.section==Section.ACCOUNT){resizeFocus=focusIdentity(getCurrentFocus());showAccount();}
            else showPage(page.section==Section.FAVORITES,true);
        }
        final String scope=repository.currentScope(); final long ticket=generation;
        repository.refreshAccess(new TvRepository.Callback<Account>() {
            public void onResult(Account account) {
                if(!screenAlive(ticket))return;
                if(!scope.equals(repository.currentScope())) {
                    invalidateScopedCatalogs();if(page.section==Section.ACCOUNT)showAccount();else showPage(false,false);
                } else if(!account.canPlay && page.section!=Section.ACCOUNT)showAccount();
            }
            public void onError(Failure failure) { if(screenAlive(ticket) && failure.code==Failure.Code.AUTH)sessionEnded(failure.message); }
        });
    }
    @Override protected void onPause() {posterSound.pause();super.onPause();}
    @Override protected void onStop() {
        captureGrid();stopped=true;resumeReload=true;generation++;observationEpoch++;clearPendingCatalogs();
        if(catalogObservation!=null){try{catalogObservation.close();}catch(Exception ignored){}catalogObservation=null;}
        updatePanel.cancel();if(dialog!=null)dialog.dismiss();super.onStop();
    }
    @Override protected void onDestroy() { destroyed=true; generation++;if(posterSound!=null)posterSound.close();if(artwork!=null)artwork.close();if(updatePanel!=null)updatePanel.close();super.onDestroy(); }
    @Override protected void onSaveInstanceState(Bundle out) {
        captureGrid(); out.putString("section",page.section.name()); out.putString("query",page.query); out.putString("category",page.category);
        out.putString("categoryTitle",page.categoryTitle); out.putString("focusKey",page.focusKey); out.putInt("scroll",page.scroll);
        out.putString("controlFocus",focusIdentity(getCurrentFocus()));
        super.onSaveInstanceState(out);
    }
    private boolean isPosterCard(View view) {
        return view!=null && view.getTag() instanceof String && view.getParent() instanceof RecyclerView;
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int direction;
        switch(event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT:direction=View.FOCUS_LEFT;break;
            case KeyEvent.KEYCODE_DPAD_RIGHT:direction=View.FOCUS_RIGHT;break;
            case KeyEvent.KEYCODE_DPAD_UP:direction=View.FOCUS_UP;break;
            case KeyEvent.KEYCODE_DPAD_DOWN:direction=View.FOCUS_DOWN;break;
            default:return super.dispatchKeyEvent(event);
        }
        if(event.getAction()==KeyEvent.ACTION_DOWN && hasWindowFocus()
                && grid!=null && (dialog==null || !dialog.isShowing())) {
            View focused=getCurrentFocus();
            View destination=focused==null?null:focused.focusSearch(direction);
            if(isPosterCard(focused) || isPosterCard(destination)) {
                if(destination==null || destination==focused)return true;
                if(destination.requestFocus(direction)) {
                    if(!isPosterCard(destination)){posterSound.leftPosters();destination.playSoundEffect(
                            direction==View.FOCUS_LEFT?SoundEffectConstants.NAVIGATION_LEFT:
                            direction==View.FOCUS_RIGHT?SoundEffectConstants.NAVIGATION_RIGHT:
                            direction==View.FOCUS_UP?SoundEffectConstants.NAVIGATION_UP:SoundEffectConstants.NAVIGATION_DOWN);}
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }
    private boolean screenAlive(long ticket) { return !destroyed && !stopped && !isFinishing() && ticket==generation; }
    private boolean valid(long ticket,String scope) {
        // A remembered session bootstraps its first source inside the repository operation.
        // The repository rejects stale auth/source generations before delivering this callback.
        return screenAlive(ticket) && (scope.equals(repository.currentScope()) || (scope.isEmpty() && repository.hasSession()));
    }
    private void invalidateScopedCatalogs() {
        clearPendingCatalogs();
        for(Page p:pages.values()){p.catalog=null;p.catalogScope="";p.focusKey="";p.scroll=0;p.category="";p.categoryTitle="Tümü";p.query="";}
    }
    private void clearPendingCatalogs(){pendingCatalogUpdates.clear();pendingCatalogScopes.clear();}
    private boolean discardPreviousSource() {
        String scope=repository.currentScope();
        for(Page candidate:pages.values())if(candidate.catalog!=null && !candidate.catalogScope.equals(scope)) {
            invalidateScopedCatalogs();return true;
        }
        return false;
    }
    private boolean catalogMatchesCurrentSource(Catalog catalog) {
        String scope=repository.currentScope();
        if(catalog==null || catalog.kind==null || scope.isEmpty())return false;
        for(Item item:catalog.items)if(!scope.equals(item.scope))return false;
        return true;
    }
    private void receiveCatalog(Catalog catalog) {
        if(stopped || destroyed || isFinishing() || !repository.hasSession() || !catalogMatchesCurrentSource(catalog))return;
        pendingCatalogUpdates.put(catalog.kind,catalog);
        pendingCatalogScopes.put(catalog.kind,repository.currentScope());
        if(dialog==null || !dialog.isShowing())applyPendingCatalogs(true);
    }
    private void applyPendingCatalogs(boolean redraw) {
        if(stopped || destroyed || !repository.hasSession() || (dialog!=null && dialog.isShowing()))return;
        if(discardPreviousSource()) {
            if(redraw && page.section!=Section.ACCOUNT)showPage(false,false);
            return;
        }
        boolean visibleChanged=false,posterFocused=isPosterCard(getCurrentFocus());
        for(Catalog catalog:pendingCatalogUpdates.values()) {
            if(!repository.currentScope().equals(pendingCatalogScopes.get(catalog.kind)) || !catalogMatchesCurrentSource(catalog))continue;
            for(Page target:pages.values()) {
                Kind kind=target.section==Section.LIVE?Kind.LIVE:target.section==Section.SERIES?Kind.SERIES:Kind.MOVIE;
                if(target.section==Section.ACCOUNT || target.section==Section.FAVORITES || kind!=catalog.kind)continue;
                if(target==page){visibleChanged=true;captureGrid();if(resizeFocus==null)resizeFocus=focusIdentity(getCurrentFocus());}
                target.catalog=catalog;target.catalogScope=repository.currentScope();
            }
        }
        clearPendingCatalogs();
        if(redraw && visibleChanged)replaceCatalog(posterFocused);
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
    private void sessionEnded(String message) {repository.logout();artwork.clear();updatePanel.cancel();invalidateScopedCatalogs();showLogin(message);}
    private void resizeScreen() {
        // A native IME may resize the Activity behind its dialog. Keep the owning
        // catalogue and the same editor alive until the draft is closed/submitted.
        if(catalogDialog!=null && catalogDialog.isShowing()){resizeAfterCatalog=true;return;}
        if(!repository.hasSession()) {
            // Resize existing views: replacing the editor would detach the IME and invalidate a pending login.
            sizing=TvLayout.measure(this);
            if(loginScroll!=null)loginScroll.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,14),TvUi.dp(this,sizing.inset),TvUi.dp(this,14));
            if(loginForm!=null){ViewGroup.LayoutParams p=loginForm.getLayoutParams();p.width=TvUi.dp(this,Math.min(480,sizing.width-sizing.inset*2-8));loginForm.setLayoutParams(p);}
            return;
        }
        View focus=getCurrentFocus();boolean posterFocus=focus!=null && focus.getTag() instanceof String;
        resizeFocus=focusIdentity(focus);captureGrid();
        if(page.section==Section.ACCOUNT)showAccount();else showPage(page.catalog==null,posterFocus);
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
        if(catalogDialog!=null && catalogDialog.isShowing())catalogDialog.dismiss();
        generation++; body=null; grid=null;resizeFocus=null;sizing=TvLayout.measure(this);measuredWidth=sizing.width;measuredHeight=sizing.height;
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
                loginCode.setText(""); page=pages.get(Section.HOME); showPage(true,false);
            }
            public void onError(Failure failure) {
                if(destroyed || stopped || ticket!=generation)return;
                loginCode.setEnabled(true); loginMessage.setText(safeMessage(failure.message)); loginCode.requestFocus();
            }
        });
    }
    private void shell(String title,String subtitle) {
        if(catalogDialog!=null && catalogDialog.isShowing())catalogDialog.dismiss();
        generation++;grid=null;sizing=TvLayout.measure(this);measuredWidth=sizing.width;measuredHeight=sizing.height;
        LinearLayout root=TvUi.row(this);root.setTag("tv-catalog-shell");root.setGravity(Gravity.TOP);root.setBackgroundColor(TvUi.BACKGROUND);
        root.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,sizing.shortScreen?10:18),TvUi.dp(this,sizing.inset),TvUi.dp(this,sizing.shortScreen?10:16));
        ScrollView railScroll=new ScrollView(this);railScroll.setVerticalScrollBarEnabled(false);railScroll.setFillViewport(false);railScroll.setClipToPadding(false);
        root.addView(railScroll,new LinearLayout.LayoutParams(TvUi.dp(this,sizing.rail),-1));
        LinearLayout navigation=TvUi.column(this);navigation.setPadding(0,0,TvUi.dp(this,8),0);railScroll.addView(navigation,new ScrollView.LayoutParams(-1,-2));
        ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.flixify_logo);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setContentDescription("Flixify");navigation.addView(logo,TvUi.space(this,-1,sizing.shortScreen?36:52));
        rail=new Button[NAV.length];
        for(int n=0;n<NAV.length;n++) {
            final Section target=Section.values()[n];Button b=TvUi.button(this,NAV[n],()->navigate(target));b.setBackground(TvUi.railBackground(this));b.setTextSize(sizing.compact?14:15);b.setPadding(TvUi.dp(this,10),0,TvUi.dp(this,8),0);
            b.setCompoundDrawablesWithIntrinsicBounds(TvUi.railIcon(this,n,sizing.compact?16:19),null,null,null);b.setCompoundDrawablePadding(TvUi.dp(this,6));
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
        resizeFocus=null;captureGrid(); page=pages.get(target);
        if(target==Section.ACCOUNT)showAccount();else showPage(target==Section.FAVORITES,false);
    }
    private Kind pageKind() { return page.section==Section.LIVE?Kind.LIVE:page.section==Section.SERIES?Kind.SERIES:Kind.MOVIE; }
    private String pageTitle() { return page.section==Section.HOME?"Sizin için":NAV[page.section.ordinal()]; }
    private void showPage(boolean reload,boolean contentFocus) {
        discardPreviousSource();
        applyPendingCatalogs(false);
        shell(pageTitle(),page.section==Section.HOME?"Filmler, diziler ve canlı yayınlar tek yerde.":"");
        if(!reload && page.catalog!=null) { renderCatalog(contentFocus); return; }
        TextView loading=TvUi.text(this,"Yükleniyor…",20,TvUi.MUTED); body.addView(loading,TvUi.space(this,-1,64));
        final long ticket=generation; final String scope=repository.currentScope();
        if(page.section==Section.FAVORITES) repository.favorites(callback(ticket,scope,items->{
            page.catalog=new Catalog(Kind.MOVIE,items,new ArrayList<>());page.catalogScope=repository.currentScope();replaceCatalog(contentFocus);
        },()->showPage(true,true)));
        else repository.catalog(pageKind(),reload,callback(ticket,scope,catalog->{page.catalog=catalog;page.catalogScope=repository.currentScope();replaceCatalog(contentFocus);},()->showPage(true,true)));
    }
    private void replaceCatalog(boolean contentFocus) { shell(pageTitle(),page.section==Section.HOME?"Filmler, diziler ve canlı yayınlar tek yerde.":""); renderCatalog(contentFocus); }
    private void captureGrid() {
        if(grid==null || page==null)return;
        RecyclerView.LayoutManager layout=grid.getLayoutManager(); if(layout instanceof GridLayoutManager)page.scroll=Math.max(0,((GridLayoutManager)layout).findFirstVisibleItemPosition());
        View focus=getCurrentFocus(); if(focus!=null && focus.getTag() instanceof String)page.focusKey=(String)focus.getTag();
    }
    private void linkContent(View first) { for(Button b:rail)b.setNextFocusRightId(first.getId()); first.setNextFocusLeftId(rail[page.section.ordinal()].getId()); }
    private void renderCatalog(boolean contentFocus) {
        List<Item> filtered=CatalogFilterData.filtered(page.catalog,page.category,page.query);
        if(page.section==Section.HOME && sizing.hero>0 && !filtered.isEmpty())addHomeHero(filtered.get(0));
        LinearLayout controls=TvUi.row(this);body.addView(controls,TvUi.space(this,-1,50));
        Button search=TvUi.button(this,"Ara",this::search);search.setBackground(TvUi.catalogActionBackground(this,!page.query.isEmpty()));search.setPadding(TvUi.dp(this,10),0,TvUi.dp(this,10),0);search.setCompoundDrawablesWithIntrinsicBounds(TvUi.catalogIcon(this,0,16),null,null,null);search.setCompoundDrawablePadding(TvUi.dp(this,6));markFocus(search,"catalog:search");controls.addView(search,TvUi.space(this,sizing.compact?86:96,42));
        Button category=TvUi.button(this,"Kategori: "+page.categoryTitle,this::categories);category.setBackground(TvUi.catalogActionBackground(this,!page.category.isEmpty()));category.setPadding(TvUi.dp(this,10),0,TvUi.dp(this,10),0);category.setCompoundDrawablesWithIntrinsicBounds(TvUi.catalogIcon(this,1,16),null,null,null);category.setCompoundDrawablePadding(TvUi.dp(this,6));markFocus(category,"catalog:category");category.setSingleLine(true);category.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams categorySpace=TvUi.space(this,0,42);categorySpace.weight=1;controls.addView(category,categorySpace);
        Button refresh=TvUi.button(this,"Yenile",()->showPage(true,true));refresh.setSingleLine(true);refresh.setEllipsize(TextUtils.TruncateAt.END);refresh.setBackground(TvUi.utilityBackground(this));refresh.setPadding(TvUi.dp(this,8),0,TvUi.dp(this,8),0);refresh.setCompoundDrawablesWithIntrinsicBounds(TvUi.catalogIcon(this,2,16),null,null,null);refresh.setCompoundDrawablePadding(TvUi.dp(this,5));markFocus(refresh,"catalog:refresh");controls.addView(refresh,TvUi.space(this,sizing.compact?104:110,42));
        linkContent(search); search.setNextFocusRightId(category.getId()); category.setNextFocusLeftId(search.getId()); category.setNextFocusRightId(refresh.getId()); refresh.setNextFocusLeftId(category.getId());
        if(!page.query.isEmpty())body.addView(TvUi.text(this,"Arama: "+page.query+" · "+filtered.size()+" sonuç",15,TvUi.MUTED),TvUi.space(this,-1,30));
        if(filtered.isEmpty()) {
            body.addView(TvUi.text(this,page.section==Section.FAVORITES?"Henüz favoriniz yok. Bir içeriği açıp favorilere ekleyin.":"İçerik bulunamadı.",18,TvUi.MUTED),TvUi.space(this,-1,72));
            if(contentFocus)search.requestFocus();restoreResizeFocus(true);return;
        }
        grid=new RecyclerView(this); grid.setId(View.generateViewId()); grid.setClipToPadding(false); grid.setPadding(0,TvUi.dp(this,8),0,TvUi.dp(this,12)); grid.setItemAnimator(null);
        grid.setDescendantFocusability(ViewGroup.FOCUS_AFTER_DESCENDANTS); grid.setFocusable(false);
        boolean liveOnly=true;for(Item item:filtered)if(item.kind!=Kind.LIVE){liveOnly=false;break;}
        int columns=liveOnly?sizing.liveColumns():sizing.columns();
        GridLayoutManager layout=new GridLayoutManager(this,columns); grid.setLayoutManager(layout); grid.setHasFixedSize(true); grid.setItemViewCacheSize(columns*2);
        PosterAdapter adapter=new PosterAdapter(filtered,search.getId(),columns,liveOnly);
        GridLayoutManager.SpanSizeLookup spans=new GridLayoutManager.SpanSizeLookup(){@Override public int getSpanSize(int position){return adapter.span(position);}};
        spans.setSpanIndexCacheEnabled(true);spans.setSpanGroupIndexCacheEnabled(true);layout.setSpanSizeLookup(spans);
        grid.setAdapter(adapter); body.addView(grid,new LinearLayout.LayoutParams(-1,0,1)); layout.scrollToPositionWithOffset(Math.min(page.scroll,filtered.size()-1),0);
        final String restoreKey=page.focusKey; if(contentFocus)grid.post(()->{
            if(grid==null)return;
            int position=0; for(int n=0;n<filtered.size();n++)if(filtered.get(n).key().equals(restoreKey)){position=n;break;}
            grid.scrollToPosition(position); final int wanted=position; grid.post(()->{if(grid!=null){RecyclerView.ViewHolder holder=grid.findViewHolderForAdapterPosition(wanted);if(holder!=null)holder.itemView.requestFocus();else search.requestFocus();}});
        });
        restoreResizeFocus(true);
    }
    private void addHomeHero(Item item) {
        FrameLayout hero=new FrameLayout(this);hero.setTag("tv-home-hero");hero.setBackground(TvUi.rounded(this,TvUi.PANEL,0,16,1));hero.setClipToOutline(true);hero.setContentDescription(item.title);
        body.addView(hero,TvUi.space(this,-1,sizing.hero));
        ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);hero.addView(image,new FrameLayout.LayoutParams(-1,-1));loadArtwork(image,item.artwork);
        View shade=new View(this);shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,new int[]{TvUi.BACKGROUND,TvUi.alpha(TvUi.BACKGROUND,210),TvUi.alpha(TvUi.BACKGROUND,16)}));hero.addView(shade,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout story=TvUi.column(this);story.setGravity(Gravity.CENTER_VERTICAL);story.setPadding(TvUi.dp(this,22),TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12));
        int storyWidth=Math.round((sizing.contentWidth()-8)*(sizing.compact?0.76f:0.64f));hero.addView(story,new FrameLayout.LayoutParams(TvUi.dp(this,storyWidth),-1,Gravity.START));
        TextView eyebrow=TvUi.text(this,item.categoryName.isEmpty()?"FLIXIFY":item.categoryName.toUpperCase(Locale.forLanguageTag("tr-TR")),12,TvUi.ACCENT);eyebrow.setSingleLine(true);eyebrow.setEllipsize(TextUtils.TruncateAt.END);story.addView(eyebrow,new LinearLayout.LayoutParams(-1,-2));
        TextView title=TvUi.text(this,item.title,sizing.compact?26:32,TvUi.WHITE);TvUi.heading(title);title.setMaxLines(2);title.setEllipsize(TextUtils.TruncateAt.END);story.addView(title,new LinearLayout.LayoutParams(-1,-2));
        if(!item.description.isEmpty()){TextView description=TvUi.text(this,item.description,14,TvUi.MUTED);description.setMaxLines(1);description.setEllipsize(TextUtils.TruncateAt.END);LinearLayout.LayoutParams descriptionSpace=new LinearLayout.LayoutParams(-1,-2);descriptionSpace.topMargin=TvUi.dp(this,6);story.addView(description,descriptionSpace);}
    }
    private final class PosterAdapter extends RecyclerView.Adapter<PosterHolder> {
        private final List<Item> items; private final int toolbar,columns;private final boolean liveOnly;
        PosterAdapter(List<Item> items,int toolbar,int columns,boolean liveOnly) { this.items=items;this.toolbar=toolbar;this.columns=columns;this.liveOnly=liveOnly; setHasStableIds(true); }
        int span(int position){return !liveOnly && items.get(position).kind==Kind.LIVE?columns:1;}
        @Override public int getItemViewType(int position){return items.get(position).kind==Kind.LIVE?(liveOnly?1:2):0;}
        @Override public long getItemId(int p) { return p; }
        @Override public int getItemCount() { return items.size(); }
        @Override public PosterHolder onCreateViewHolder(ViewGroup parent,int type) {
            LinearLayout card=type==2?TvUi.row(MainActivity.this):TvUi.column(MainActivity.this); card.setId(View.generateViewId()); card.setFocusable(true); card.setFocusableInTouchMode(true);card.setSoundEffectsEnabled(false); card.setBackground(TvUi.artworkBackground(MainActivity.this)); card.setPadding(TvUi.dp(MainActivity.this,3),TvUi.dp(MainActivity.this,3),TvUi.dp(MainActivity.this,3),TvUi.dp(MainActivity.this,2));
            int cardHeight=type==2?(sizing.shortScreen?106:128):type==1?sizing.liveCardHeight(columns,1):sizing.cardHeight(page.section==Section.HOME);
            RecyclerView.LayoutParams p=new RecyclerView.LayoutParams(-1,TvUi.dp(MainActivity.this,cardHeight)); p.setMargins(TvUi.dp(MainActivity.this,4),TvUi.dp(MainActivity.this,4),TvUi.dp(MainActivity.this,4),TvUi.dp(MainActivity.this,4)); card.setLayoutParams(p);
            ImageView image=new ImageView(MainActivity.this); image.setScaleType(ImageView.ScaleType.CENTER_CROP); image.setBackground(TvUi.rounded(MainActivity.this,TvUi.PANEL,0,10,1));image.setClipToOutline(true);
            if(type==2){int width=Math.min(sizing.compact?144:192,Math.max(80,sizing.contentWidth()*2/5));card.setGravity(Gravity.CENTER_VERTICAL);card.addView(image,new LinearLayout.LayoutParams(TvUi.dp(MainActivity.this,width),TvUi.dp(MainActivity.this,width*9f/16f)));}
            else card.addView(image,new LinearLayout.LayoutParams(-1,0,1));
            TextView title=TvUi.text(MainActivity.this,"",type==2?18:15,TvUi.WHITE); title.setMaxLines(2); title.setEllipsize(TextUtils.TruncateAt.END); title.setPadding(TvUi.dp(MainActivity.this,type==2?14:4),TvUi.dp(MainActivity.this,type==2?0:5),TvUi.dp(MainActivity.this,4),0);
            card.addView(title,type==2?new LinearLayout.LayoutParams(0,-1,1):new LinearLayout.LayoutParams(-1,TvUi.dp(MainActivity.this,sizing.shortScreen?42:50)));
            return new PosterHolder(card,image,title);
        }
        @Override public void onBindViewHolder(PosterHolder holder,int position) {
            Item item=items.get(position); holder.title.setText(item.title); holder.itemView.setTag(item.key()); holder.itemView.setContentDescription(item.title);
            GridLayoutManager layout=(GridLayoutManager)grid.getLayoutManager();GridLayoutManager.SpanSizeLookup spans=layout.getSpanSizeLookup();
            holder.itemView.setNextFocusLeftId(spans.getSpanIndex(position,columns)==0?rail[page.section.ordinal()].getId():View.NO_ID); holder.itemView.setNextFocusUpId(spans.getSpanGroupIndex(position,columns)==0?toolbar:View.NO_ID);
            holder.itemView.setElevation(TvUi.dp(MainActivity.this,holder.itemView.hasFocus()?8:0));
            holder.itemView.setOnFocusChangeListener((v,focus)->{v.setElevation(TvUi.dp(MainActivity.this,focus?8:0));if(focus){if(hasWindowFocus() && item.scope.equals(repository.currentScope()))posterSound.focused(item.scope,page.section.name()+":"+item.key());page.focusKey=item.key();int positionNow=holder.getBindingAdapterPosition();if(grid!=null && positionNow!=RecyclerView.NO_POSITION)grid.scrollToPosition(positionNow);}});
            holder.itemView.setOnClickListener(v->{captureGrid();play(item);}); loadArtwork(holder.image,item.artwork);
            if(item.kind==Kind.LIVE){holder.image.setScaleType(ImageView.ScaleType.FIT_CENTER);int pad=TvUi.dp(MainActivity.this,14);holder.image.setPadding(pad,pad,pad,pad);}
        }
        @Override public void onViewRecycled(PosterHolder holder) { artwork.unbind(holder.image); holder.itemView.setOnFocusChangeListener(null);holder.itemView.setElevation(0); }
    }
    private static final class PosterHolder extends RecyclerView.ViewHolder {
        final ImageView image; final TextView title;
        PosterHolder(View view,ImageView image,TextView title) { super(view);this.image=image;this.title=title; }
    }
    private boolean catalogOwner(Page owner,Catalog snapshot,long ticket,String scope) {
        return screenAlive(ticket) && repository.hasSession() && page==owner && owner.catalog==snapshot
                && scope.equals(repository.currentScope());
    }
    private void catalogDismissed(Dialog dismissed,Page owner,Catalog snapshot,long ticket,String scope,String opener,boolean[] committed) {
        if(dialog==dismissed)dialog=null;
        if(catalogDialog!=dismissed)return;
        catalogDialog=null;
        boolean resize=resizeAfterCatalog;resizeAfterCatalog=false;
        if(stopped || destroyed || isFinishing())return;
        findViewById(android.R.id.content).post(()->{
            if(stopped || destroyed || isFinishing())return;
            if(catalogDialog!=null && catalogDialog.isShowing()){if(resize)resizeAfterCatalog=true;return;}
            if(!committed[0] && catalogOwner(owner,snapshot,ticket,scope)) {
                View control=findFocus(findViewById(android.R.id.content),opener);
                if(control!=null)control.requestFocus();
            }
            if(resize)resizeScreen();
            applyPendingCatalogs(true);
        });
    }
    private void search() {
        if(page.catalog==null)return;
        final Page owner=page;final Catalog snapshot=page.catalog;final long ticket=generation;final String scope=repository.currentScope();
        final Dialog[] panel={null};final boolean[] committed={false};
        panel[0]=CatalogDialogs.search(this,pageTitle(),owner.query,owner.categoryTitle,
                text->CatalogFilterData.preview(snapshot,owner.category,text),text->{
                    committed[0]=true;
                    if(!catalogOwner(owner,snapshot,ticket,scope)){panel[0].dismiss();return;}
                    owner.query=text.trim();owner.scroll=0;owner.focusKey="";
                    panel[0].dismiss();showPage(false,true);
                },()->catalogDismissed(panel[0],owner,snapshot,ticket,scope,"catalog:search",committed));
        dialog=catalogDialog=panel[0];panel[0].show();
    }
    private void categories() {
        if(page.catalog==null)return;
        final Page owner=page;final Catalog snapshot=page.catalog;final long ticket=generation;final String scope=repository.currentScope();
        final Dialog[] panel={null};final boolean[] committed={false};
        panel[0]=CatalogDialogs.categories(this,pageTitle(),CatalogFilterData.categories(snapshot,owner.query),owner.category,option->{
            committed[0]=true;
            if(!catalogOwner(owner,snapshot,ticket,scope)){panel[0].dismiss();return;}
            owner.category=option.id;owner.categoryTitle=option.title;owner.focusKey="";owner.scroll=0;
            panel[0].dismiss();showPage(false,true);
        },()->catalogDismissed(panel[0],owner,snapshot,ticket,scope,"catalog:category",committed));
        dialog=catalogDialog=panel[0];panel[0].show();
    }
    private void loadArtwork(ImageView image,String address) {
        artwork.load(image,address,repository.currentScope());
        if(address==null || address.isEmpty()) {image.setImageResource(R.drawable.flixify_logo);image.setScaleType(ImageView.ScaleType.FIT_CENTER);image.setPadding(TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12),TvUi.dp(this,12));image.setImageAlpha(90);}
        else {image.setScaleType(ImageView.ScaleType.CENTER_CROP);image.setPadding(0,0,0,0);image.setImageAlpha(255);}
    }
    private void play(Item item) {
        if(playerLaunching || stopped || destroyed || isFinishing() || !hasWindowFocus())return;
        if(!item.scope.equals(repository.currentScope())) { notice("Kaynak değişti. Listeyi yenileyin.");return; }
        playerLaunching=true;
        Intent intent=new Intent(this,PlayerActivity.class);intent.putExtra(PlayerActivity.EXTRA_ITEM,item);
        try {startActivity(intent);}
        catch(android.content.ActivityNotFoundException | SecurityException unavailable) {
            playerLaunching=false;notice("Oynatıcı açılamadı. Yeniden deneyin.");
        }
    }
    private LinearLayout scrollContent() {
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setClipToPadding(false);
        LinearLayout inner=TvUi.column(this);inner.setPadding(0,TvUi.dp(this,8),0,TvUi.dp(this,16));scroll.addView(inner,new ScrollView.LayoutParams(-1,-2));body.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));return inner;
    }
    private void showAccount() {
        page=pages.get(Section.ACCOUNT);shell("Hesabım","");
        LinearLayout loading=scrollContent();loading.addView(TvUi.text(this,"Hesap yükleniyor…",20,TvUi.MUTED),TvUi.space(this,-1,64));addAccountActions(loading);
        final long ticket=generation;String scope=repository.currentScope();repository.account(true,callback(ticket,scope,account->{
            String accountFocus=focusIdentity(getCurrentFocus());
            shell("Hesabım","");LinearLayout inner=scrollContent();
            TextView packageTitle=TvUi.text(this,account.packageTitle,26,TvUi.WHITE);TvUi.heading(packageTitle);inner.addView(packageTitle,TvUi.space(this,-1,-2));
            inner.addView(TvUi.text(this,"Hesap kodu: •••• "+account.codeSuffix,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            String expiry=account.expiresAtMs>0?DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(new Date(account.expiresAtMs)):"Belirtilmedi";
            inner.addView(TvUi.text(this,"Bitiş: "+expiry,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            TextView message=TvUi.text(this,account.message.isEmpty()?(account.canPlay?"Hesabınız aktif":"İzleme erişimi bulunmuyor."):account.message,18,account.canPlay?TvUi.MUTED:TvUi.ACCENT);inner.addView(message,TvUi.space(this,-1,-2));
            addAccountActions(inner);if(resizeFocus==null)resizeFocus=accountFocus;restoreResizeFocus(true);
        },this::showAccount));
    }
    private void addAccountActions(LinearLayout parent) {
        Button update=updatePanel.addTo(parent,sizing.contentWidth()-8);markFocus(update,"account:update");
        Button logout=addLocalLogout(parent);update.setNextFocusDownId(logout.getId());logout.setNextFocusUpId(update.getId());linkContent(logout);
    }
    private Button addLocalLogout(LinearLayout parent) {
        Button logout=TvUi.button(this,"Oturumu kapat",this::confirmLogout);markFocus(logout,"account:logout");parent.addView(logout,TvUi.space(this,Math.min(230,sizing.contentWidth()-8),48));return logout;
    }
    private void confirmLogout() {
        AlertDialog confirmation=new AlertDialog.Builder(this).setTitle("Oturum kapatılsın mı?").setMessage("Bu cihazda tekrar giriş yapmak için hesap kodunuz gerekir.")
            .setNegativeButton("Vazgeç",null).setPositiveButton("Oturumu kapat",(d,w)->sessionEnded("")).create();
        dialog=confirmation;afterOrdinaryDialog(confirmation);confirmation.setOnShowListener(d->confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());confirmation.show();
    }
    private String safeMessage(String message) { return message==null || message.trim().isEmpty()?"İşlem tamamlanamadı. Lütfen tekrar deneyin.":message; }
    private void showFailure(String message,Runnable retry) {
        while(body.getChildCount()>1)body.removeViewAt(1);
        LinearLayout inner=scrollContent();
        TextView text=TvUi.text(this,safeMessage(message),20,TvUi.MUTED);inner.addView(text,TvUi.space(this,-1,-2));
        if(page.section==Section.ACCOUNT)addAccountActions(inner);
        Button button=TvUi.button(this,"Tekrar dene",retry);markFocus(button,"content:retry");inner.addView(button,TvUi.space(this,Math.min(220,sizing.contentWidth()-8),48));
        if(page.section!=Section.ACCOUNT)linkContent(button);restoreResizeFocus(true);
    }
    private void afterOrdinaryDialog(Dialog shown) {
        shown.setOnDismissListener(d->{
            if(dialog==shown)dialog=null;
            findViewById(android.R.id.content).post(()->{if(!stopped && !destroyed && !isFinishing())applyPendingCatalogs(true);});
        });
    }
    private void notice(String message) { dialog=new AlertDialog.Builder(this).setMessage(message).setPositiveButton("Tamam",null).create();afterOrdinaryDialog(dialog);dialog.show(); }
    @Override public void onBackPressed() {
        if(body==null) { super.onBackPressed();return; }
        if(!page.query.isEmpty() || !page.category.isEmpty()) { page.query="";page.category="";page.categoryTitle="Tümü";page.scroll=0;page.focusKey="";showPage(false,true);return; }
        View focus=getCurrentFocus();boolean inRail=false;for(Button b:rail)if(focus==b)inRail=true;
        if(!inRail) { rail[page.section.ordinal()].requestFocus();return; }
        if(page.section!=Section.HOME) { navigate(Section.HOME);return; }
        AlertDialog confirmation=new AlertDialog.Builder(this).setTitle("Flixify'dan çıkılsın mı?").setNegativeButton("Vazgeç",null).setPositiveButton("Çık",(d,w)->finish()).create();dialog=confirmation;afterOrdinaryDialog(confirmation);confirmation.setOnShowListener(d->confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());confirmation.show();
    }
}
