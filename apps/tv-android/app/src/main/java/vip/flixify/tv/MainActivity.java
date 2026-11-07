package vip.flixify.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextUtils;
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
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Date;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Collections;
import vip.flixify.tv.TvModels.*;

/** Native Android TV navigation. Items carry scoped identifiers; playback URLs stay in the repository. */
public final class MainActivity extends Activity {
    private enum Section { HOME, LIVE, MOVIES, SERIES, FAVORITES, ACCOUNT }
    private static final String[] NAV={"Ana Sayfa","Canlı TV","Filmler","Diziler","Favoriler","Hesabım"};
    private static final class Page {
        final Section section;
        Catalog catalog;
        String query="",category="",categoryTitle="Tümü",focusKey="",catalogScope="",discoveryFocus="",heroKey="";
        int scroll,scrollOffset;
        Page(Section section) { this.section=section; }
    }
    private final EnumMap<Section,Page> pages=new EnumMap<>(Section.class);
    private TvRepository repository;
    private TvAnalytics analytics;
    private String visibleAnalyticsScreen="login";
    private ArtworkLoader artwork;
    private CatalogPresentationPreparer presentations;
    private PosterFocusSound posterSound;
    private TvUpdatePanel updatePanel;
    private StartupScreen startup;
    private AutoCloseable catalogObservation;
    private long observationEpoch;
    private final EnumMap<Kind,Catalog> pendingCatalogUpdates=new EnumMap<>(Kind.class);
    private final EnumMap<Kind,String> pendingCatalogScopes=new EnumMap<>(Kind.class);
    private LinearLayout body;
    private Button[] rail;
    private RecyclerView grid;
    private DiscoveryScreen discovery;
    private final EnumMap<Kind,Catalog> homeSources=new EnumMap<>(Kind.class);
    private long homeLoadSerial;
    private boolean homeRefreshPending;
    private Page page;
    private long generation;
    private long accessSerial,packagesSerial;
    private Account verifiedAccount;
    private TextView trialNavigationClock,trialAccountClock;
    private final android.os.Handler trialHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable trialTick=new Runnable(){public void run(){renderTrialClocks();if(trialIsVisible()&&"active".equals(verifiedAccount.trialCountdown.status)&&verifiedAccount.trialCountdown.remainingMillis(android.os.SystemClock.elapsedRealtime())>0)trialHandler.postDelayed(this,1000);}};
    private final Runnable trialRefresh=new Runnable(){public void run(){if(!trialIsVisible())return;trialHandler.postDelayed(this,60000);resolveVerifiedAccess(false,false,false);}};
    private String verifiedOwner="",accessError="",packagesError="";
    private boolean accessBusy,packagesVisible,packagesBusy,recoveringCatalog;
    private int packageUsers=1;
    private java.util.List<PackagePlan> packagePlans;

    private boolean stopped,destroyed,initialized,resumeReload,playerLaunching,searchPlayerReturn;
    private Dialog dialog,catalogDialog;
    private static final class SearchSelection {
        final Page owner;final Catalog snapshot;final long ticket;final String scope,query;final Item item;
        SearchSelection(Page owner,Catalog snapshot,long ticket,String scope,String query,Item item){this.owner=owner;this.snapshot=snapshot;this.ticket=ticket;this.scope=scope;this.query=query;this.item=item;}
    }
    private SearchSelection searchSelection;
    private Item informationSelection;
    private boolean resizeAfterCatalog;
    private EditText loginCode;
    private LinearLayout loginForm;
    private ScrollView loginScroll;
    private LinearLayout loginColumns,loginPairingPanel;
    private DeviceLoginController deviceLogin;
    private ImageView pairingQr;
    private TextView pairingCode,pairingStatus;
    private android.graphics.Bitmap pairingBitmap;
    private String pairingPng="";
    private String resizeFocus;
    private static final class FocusToken { final String key;FocusToken(String key){this.key=key;} }
    private TextView loginMessage;
    private TvLayout sizing;
    private int measuredWidth,measuredHeight;
    private boolean resizePosted;
    private String preparedScope="";
    private long favoritesRefreshSerial;
    private boolean favoritesRefreshPending,favoritesRefreshAgain;
    private final Map<String,Object> favoriteMutations=new LinkedHashMap<>();
    private boolean welcomeResolved,welcomeBusy;
    private long welcomeSerial;
    private String welcomeAccount="",welcomeError="";
    private WelcomeOffer welcomeOffer;
    private int welcomeUsers=1;

    @Override public void onCreate(Bundle state) {
        setTheme(R.style.TvTheme);
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN);
        startup=new StartupScreen(this,StartupScreen.restoredComplete(state));
        FrameLayout initial=new FrameLayout(this);initial.setBackgroundColor(TvUi.BACKGROUND);startup.show(initial);
        repository=TvApplication.repository(this); analytics=TvAnalytics.get(this);artwork=new ArtworkLoader(this);posterSound=PosterFocusSound.create(this);updatePanel=new TvUpdatePanel(this);
        android.os.Handler presentationMain=new android.os.Handler(android.os.Looper.getMainLooper());presentations=new CatalogPresentationPreparer(presentationMain::post);
        for(Section section:Section.values())pages.put(section,new Page(section));
        page=pages.get(Section.HOME);
        if(state!=null) {
            try { page=pages.get(Section.valueOf(state.getString("section","HOME"))); } catch(IllegalArgumentException ignored) {}
            page.query=state.getString("query",""); page.category=state.getString("category",""); page.categoryTitle=state.getString("categoryTitle","Tümü");
            page.focusKey=state.getString("focusKey",""); page.scroll=state.getInt("scroll",0);
            page.discoveryFocus=state.getString("discoveryFocus","");page.heroKey=state.getString("heroKey","");page.scrollOffset=state.getInt("scrollOffset",0);
            resizeFocus=state.getString("controlFocus");
            welcomeUsers=state.getInt("welcomeUsers",1)==2?2:1;
        }
        if(!repository.hasSession())showLogin("");
        else loadWelcome();
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
        boolean returning=resumeReload || searchPlayerReturn; resumeReload=false;if(searchPlayerReturn)resizeAfterCatalog=false;searchPlayerReturn=false;
        if(!repository.hasSession()) { if(returning)showLogin("",false); return; }
        if(welcomeBlocked()){loadWelcome();return;}
        refreshVerifiedAccess(returning);bindTrialClocks();

    }
    @Override protected void onPause() {if(deviceLogin!=null)deviceLogin.pause();posterSound.pause();super.onPause();}
    @Override protected void onStop() {
        stopTrialClocks();
        if(deviceLogin!=null)deviceLogin.pause();
        startup.cancelPendingFrame();
        presentations.cancel();
        artwork.retireScreen();
        preparedScope="";
        favoritesRefreshSerial++;favoritesRefreshPending=false;favoritesRefreshAgain=false;
        accessSerial++;accessBusy=false;packagesSerial++;packagesBusy=false;
        welcomeSerial++;welcomeBusy=false;
        if(!searchPlayerReturn)captureGrid();stopped=true;resumeReload=true;generation++;homeLoadSerial++;observationEpoch++;clearPendingCatalogs();searchSelection=null;informationSelection=null;
        if(catalogObservation!=null){try{catalogObservation.close();}catch(Exception ignored){}catalogObservation=null;}
        updatePanel.cancel();if(dialog!=null)dialog.dismiss();super.onStop();
    }
    @Override protected void onDestroy() { stopTrialClocks();if(deviceLogin!=null)deviceLogin.cancel();clearPairingBitmap();destroyed=true; generation++;if(presentations!=null)presentations.close();if(startup!=null)startup.close();if(posterSound!=null)posterSound.close();if(artwork!=null)artwork.close();if(updatePanel!=null)updatePanel.close();super.onDestroy(); }
    @Override public void onTrimMemory(int level){super.onTrimMemory(level);if(artwork!=null)artwork.trimMemory(level);trimMetadataMemory(level);}
    @Override public void onLowMemory(){super.onLowMemory();if(artwork!=null)artwork.trimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_COMPLETE);trimMetadataMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_COMPLETE);}
    private void trimMetadataMemory(int level){
        if(repository==null || page==null || level<android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)return;
        presentations.clear();
        Kind keep=!stopped && page.section!=Section.FAVORITES && page.section!=Section.ACCOUNT?pageKind():null;
        clearPendingCatalogs();preparedScope="";
        for(Page target:pages.values())if(stopped || target!=page){target.catalog=null;target.catalogScope="";}
        if(stopped){if(grid!=null)grid.setAdapter(null);grid=null;if(body!=null)body.removeAllViews();}
        if(stopped || page.section!=Section.HOME){homeLoadSerial++;homeSources.clear();homeRefreshPending=false;}
        if(stopped)discovery=null;
        repository.trimMemory(keep);
        if(!stopped && grid==null && page.catalog!=null && body!=null && page.section!=Section.ACCOUNT){
            final Page owner=page;final long ticket=generation;
            body.post(()->{if(screenAlive(ticket) && !stopped && page==owner && grid==null)showPage(false,false);});
        }
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if(!searchPlayerReturn)captureGrid(); out.putString("section",page.section.name()); out.putString("query",page.query); out.putString("category",page.category);
        out.putString("categoryTitle",page.categoryTitle); out.putString("focusKey",page.focusKey); out.putInt("scroll",page.scroll);
        out.putString("discoveryFocus",page.discoveryFocus);out.putString("heroKey",page.heroKey);out.putInt("scrollOffset",page.scrollOffset);
        out.putString("controlFocus",searchPlayerReturn?"poster:"+page.focusKey:focusIdentity(getCurrentFocus()));
        startup.saveInstanceState(out);
        out.putInt("welcomeUsers",welcomeUsers);
        super.onSaveInstanceState(out);
    }
    private boolean isPosterCard(View view) {
        return view!=null && view.getTag() instanceof String && view.getParent() instanceof RecyclerView;
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if(startup!=null && startup.isShowing())switch(event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_LEFT:case KeyEvent.KEYCODE_DPAD_RIGHT:case KeyEvent.KEYCODE_DPAD_UP:case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_CENTER:case KeyEvent.KEYCODE_ENTER:case KeyEvent.KEYCODE_NUMPAD_ENTER:case KeyEvent.KEYCODE_SPACE:case KeyEvent.KEYCODE_TAB:return true;
        }
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
            String focus=focusIdentity(focused);
            if(discovery!=null && direction==View.FOCUS_DOWN && focus!=null && focus.startsWith("catalog:")){discovery.focusFirst();return true;}
            if(discovery!=null && discovery.moveFocus(focused,direction))return true;
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
    private boolean welcomeBlocked(){
        String account=repository.currentAccountId();
        if(welcomeResolved && !welcomeAccount.isEmpty() && !account.isEmpty() && !welcomeAccount.equals(account)){welcomeResolved=false;welcomeOffer=null;welcomeBusy=false;welcomeSerial++;}
        return !welcomeResolved;
    }
    private boolean welcomeCurrent(long serial,String account){
        return !destroyed && !stopped && !isFinishing() && serial==welcomeSerial && repository.hasSession() && (account.isEmpty() || account.equals(repository.currentAccountId()));
    }
    private void loadWelcome(){
        if(!repository.hasSession()){showLogin("");return;}
        String account=repository.currentAccountId();
        if(welcomeBusy && account.equals(welcomeAccount))return;
        welcomeAccount=account;welcomeResolved=false;welcomeBusy=true;welcomeError="";welcomeOffer=null;
        generation++;homeLoadSerial++;clearPendingCatalogs();body=null;grid=null;discovery=null;artwork.retireScreen();
        final long serial=++welcomeSerial;final String owner=welcomeAccount;
        renderWelcome();
        repository.welcomeOffer(new TvRepository.Callback<WelcomeOffer>(){
            public void onResult(WelcomeOffer value){
                if(!welcomeCurrent(serial,owner)){retryChangedWelcome(serial);return;}
                welcomeBusy=false;
                if(value==null){welcomeError="Seçenekler doğrulanamadı. Tekrar dene.";renderWelcome();return;}
                welcomeOffer=value;if(value.showPrompt())renderWelcome("welcome-trial");else enterAfterWelcome();
            }
            public void onError(Failure failure){
                if(!welcomeCurrent(serial,owner)){retryChangedWelcome(serial);return;}
                welcomeBusy=false;if(failure.code==Failure.Code.AUTH){sessionEnded(failure.message);return;}
                welcomeError="Seçenekler yüklenemedi. Bağlantını kontrol edip tekrar dene.";renderWelcome();
            }
        });
    }
    private void retryChangedWelcome(long serial){if(!destroyed && !stopped && !isFinishing() && serial==welcomeSerial && repository.hasSession()){welcomeBusy=false;loadWelcome();}}
    private void renderWelcome(){renderWelcome(null);}
    private void renderWelcome(String requestedFocus){
        if(destroyed || stopped || !repository.hasSession() || welcomeResolved)return;
        visibleAnalyticsScreen="welcome";analytics.screen(visibleAnalyticsScreen);
        View current=getCurrentFocus();Object tag=current==null?null:current.getTag();String focus=requestedFocus!=null?requestedFocus:tag instanceof String && ((String)tag).startsWith("welcome-")?(String)tag:null;
        if(!welcomeError.isEmpty())focus="welcome-retry";
        WelcomeOfferScreen screen=new WelcomeOfferScreen(this,welcomeOffer,welcomeUsers,welcomeBusy,welcomeError,focus,new WelcomeOfferScreen.Actions(){
            public void trial(){chooseWelcome("trial");}
            public void monthly(){chooseWelcome("monthly");}
            public void users(int value){if(!welcomeBusy){welcomeUsers=value==2?2:1;renderWelcome();}}
            public void retry(){if(!welcomeBusy)loadWelcome();}
            public void logout(){sessionEnded("");}
        });
        startup.show(screen);startup.ready();
    }
    private void chooseWelcome(String choice){
        if(welcomeResolved || welcomeBusy || welcomeOffer==null || !welcomeOffer.showPrompt())return;
        if(!welcomeCurrent(welcomeSerial,welcomeAccount)){loadWelcome();return;}
        final int users=welcomeUsers;final String owner=welcomeAccount;final long serial=++welcomeSerial,analyticsTicket=analytics.epoch();
        welcomeBusy=true;welcomeError="";renderWelcome();
        repository.chooseWelcomeOffer(choice,new TvRepository.Callback<WelcomeOffer>(){
            public void onResult(WelcomeOffer value){
                if(!welcomeCurrent(serial,owner)){retryChangedWelcome(serial);return;}
                welcomeBusy=false;
                if(value==null || value.showPrompt()){welcomeError="Seçimin kaydedilemedi. Tekrar dene.";renderWelcome();return;}
                analytics.event(analyticsTicket,"monthly".equals(choice)?"welcome_offer_select":"trial_select","monthly".equals(choice)?TvAnalytics.values("offer_id","welcome-monthly-50-v1"):Collections.emptyMap());
                enterAfterWelcome();
                if("monthly".equals(choice))openPackages(users);
            }
            public void onError(Failure failure){
                if(!welcomeCurrent(serial,owner)){retryChangedWelcome(serial);return;}
                welcomeBusy=false;if(failure.code==Failure.Code.AUTH){sessionEnded(failure.message);return;}
                welcomeError="Seçimin kaydedilemedi. Tekrar deneyebilirsin.";renderWelcome();
            }
        });
    }
    private void enterAfterWelcome(){
        welcomeResolved=true;welcomeBusy=false;welcomeError="";welcomeAccount=repository.currentAccountId();welcomeSerial++;
        refreshVerifiedAccess(false);
    }

    private boolean accessCurrent(long serial,String owner){return !destroyed&&!stopped&&!isFinishing()&&serial==accessSerial&&repository.hasSession()&&owner.equals(repository.currentAccountId());}
    private void refreshVerifiedAccess(boolean redraw){recoveringCatalog=false;resolveVerifiedAccess(redraw,false);}
    private void resolveVerifiedAccess(boolean redraw,boolean accountScreen){
        resolveVerifiedAccess(redraw,accountScreen,true);
    }
    private void resolveVerifiedAccess(boolean redraw,boolean accountScreen,boolean force){
        String owner=repository.currentAccountId();
        if(!owner.equals(verifiedOwner)){accessBusy=false;accessSerial++;verifiedAccount=null;verifiedOwner=owner;packagePlans=null;packagesSerial++;}
        if(accessBusy)return;
        final boolean first=verifiedAccount==null;
        accessBusy=true;accessError="";final long serial=++accessSerial;
        if(verifiedAccount==null&&!accountScreen){shell("Hesabın kontrol ediliyor…","");LinearLayout inner=scrollContent();inner.addView(TvUi.text(this,"İzleme erişimin doğrulanıyor…",20,TvUi.MUTED));startup.ready();}
        TvRepository.Callback<Account> authority=new TvRepository.Callback<Account>(){
            public void onResult(Account account){
                if(!accessCurrent(serial,owner))return;boolean displayChanged=!sameAccountDisplay(verifiedAccount,account);accessBusy=false;verifiedAccount=account;verifiedOwner=owner;accessError="";bindTrialClocks();
                boolean recovery=recoveringCatalog;recoveringCatalog=false;
                if(!account.canPlay)invalidateScopedCatalogs();
                if(page.section==Section.ACCOUNT&&!packagesVisible){if(force||displayChanged||body==null)renderAccount(account);return;}
                if(!account.canPlay){if(account.access==Account.Access.EXPIRED)showPackages();else showAccessStatus();}
                else if(recovery){showCatalogUnavailable();}
                else {
                    boolean changed=discardPreviousSource();
                    if(first||packagesVisible||redraw||changed||body==null){packagesVisible=false;if(page.section==Section.ACCOUNT)showAccount();else showPage(redraw&&page.section==Section.FAVORITES,redraw);}
                }
            }
            public void onError(Failure failure){
                if(destroyed||stopped||isFinishing()||serial!=accessSerial)return;
                if(failure.code==Failure.Code.AUTH&&(!repository.hasSession()||owner.equals(repository.currentAccountId()))){accessBusy=false;sessionEnded(failure.message);return;}
                if(!accessCurrent(serial,owner))return;accessBusy=false;
                accessError=accountScreen?safeMessage(failure.message):"Erişimin doğrulanamadı. Lütfen tekrar dene.";
                if(page.section==Section.ACCOUNT&&!packagesVisible)showFailure(accessError,MainActivity.this::showAccount);
                else if(recoveringCatalog||verifiedAccount==null||!verifiedAccount.canPlay)showAccessStatus();
            }
        };
        if(!force)repository.account(false,authority);else if(accountScreen)repository.account(true,authority);else repository.refreshAccess(authority);
    }
    private static boolean sameAccountDisplay(Account previous,Account current){
        return previous!=null&&current!=null&&previous.id.equals(current.id)&&previous.codeSuffix.equals(current.codeSuffix)
                &&previous.packageTitle.equals(current.packageTitle)&&previous.expiresAtMs==current.expiresAtMs
                &&previous.canPlay==current.canPlay&&previous.trial==current.trial&&previous.message.equals(current.message)&&previous.access==current.access;
    }
    private boolean accessGate(){
        if(!repository.currentAccountId().equals(verifiedOwner)){verifiedAccount=null;accessBusy=false;accessSerial++;}
        if(verifiedAccount==null){refreshVerifiedAccess(false);return true;}
        if(!verifiedAccount.canPlay){if(verifiedAccount.access==Account.Access.EXPIRED)showPackages();else showAccessStatus();return true;}
        return false;
    }
    private Button recoveryButton(LinearLayout inner,String label,String key,Runnable action){Button button=TvUi.button(this,label,action);markFocus(button,key);inner.addView(button,TvUi.space(this,Math.min(330,sizing.contentWidth()-8),48));return button;}
    private boolean recoverCatalogDenial(String owner,String source,Failure failure){
        if(!AccessRecoveryPolicy.shouldResolve(failure.code,repository.hasSession(),owner,repository.currentAccountId(),source,repository.currentScope()))return false;
        invalidateScopedCatalogs();if(page.section!=Section.ACCOUNT||packagesVisible)showCatalogUnavailable();recoveringCatalog=true;resolveVerifiedAccess(false,false);return true;
    }
    private void showCatalogUnavailable(){accessError="İçerik hizmetine şu anda ulaşılamıyor. Erişimini tekrar kontrol et.";showAccessStatus();}
    private void showAccessStatus(){
        packagesVisible=false;shell("İzleme erişimi","");LinearLayout inner=scrollContent();
        String message=!accessError.isEmpty()?accessError:verifiedAccount==null?"Hesabın doğrulanamadı.":verifiedAccount.message;
        inner.addView(TvUi.text(this,message,20,TvUi.MUTED),TvUi.space(this,-1,-2));
        linkContent(recoveryButton(inner,"Tekrar dene","access:retry",()->refreshVerifiedAccess(true)));
        recoveryButton(inner,"Paketleri gör","access:packages",this::showPackages);
        recoveryButton(inner,"Hesabım","access:account",this::showAccount);restoreResizeFocus(true);startup.ready();
    }
    private void showPackages(){
        packagesVisible=true;String focus=focusIdentity(getCurrentFocus());shell("Paketler","");LinearLayout inner=scrollContent();
        if(verifiedAccount!=null&&!verifiedAccount.canPlay)inner.addView(TvUi.text(this,verifiedAccount.message,18,TvUi.MUTED),TvUi.space(this,-1,-2));
        for(int users:new int[]{1,2}){Button select=recoveryButton(inner,(users==1?"1 Kullanıcı":"2 Kullanıcı")+(packageUsers==users?" • Seçili":""),"packages:users:"+users,()->{packageUsers=users;showPackages();});if(users==1)linkContent(select);}
        boolean wide=sizing.contentWidth()>=600;
        LinearLayout terms=wide?TvUi.row(this):inner;if(wide)inner.addView(terms,TvUi.space(this,-1,-2));
        for(int months:new int[]{1,6,12}){
            LinearLayout card=TvUi.column(this);card.setPadding(TvUi.dp(this,8),TvUi.dp(this,10),TvUi.dp(this,8),TvUi.dp(this,10));
            if(wide)terms.addView(card,new LinearLayout.LayoutParams(0,-2,1));else inner.addView(card,TvUi.space(this,-1,-2));
            PackagePlan chosen=null;if(packagePlans!=null)for(PackagePlan plan:packagePlans)if(plan.users==packageUsers&&plan.months==months)chosen=plan;
            card.addView(TvUi.text(this,months+" Aylık",22,TvUi.WHITE),TvUi.space(this,-1,-2));final PackagePlan plan=chosen;
            card.addView(TvUi.text(this,plan==null?packagesBusy?"Yükleniyor…":"Şu anda kullanılamıyor":plan.priceLabel,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            Button buy=TvUi.button(this,"Web sitesinde devam et",()->openRegularPackage(plan));markFocus(buy,"packages:buy:"+months);buy.setEnabled(plan!=null);card.addView(buy,TvUi.space(this,-1,64));
        }
        if(!packagesError.isEmpty())inner.addView(TvUi.text(this,packagesError,18,TvUi.MUTED),TvUi.space(this,-1,-2));
        recoveryButton(inner,"Paketleri yenile","packages:reload",()->{packagePlans=null;loadPackages();});
        recoveryButton(inner,"Erişimi kontrol et","packages:access",()->refreshVerifiedAccess(true));
        recoveryButton(inner,"Hesabım","packages:account",this::showAccount);
        if(resizeFocus==null)resizeFocus=focus;restoreResizeFocus(true);startup.ready();
        if(packagePlans==null&&!packagesBusy)loadPackages();
    }
    private void loadPackages(){
        packagesBusy=true;packagesError="";final long serial=++packagesSerial;final String owner=repository.currentAccountId();showPackages();
        repository.packages(new TvRepository.Callback<java.util.List<PackagePlan>>(){
            private boolean current(){return !destroyed&&!stopped&&serial==packagesSerial&&repository.hasSession()&&owner.equals(repository.currentAccountId());}
            public void onResult(java.util.List<PackagePlan> plans){if(!current())return;packagesBusy=false;packagePlans=plans;if(packagesVisible)showPackages();}
            public void onError(Failure failure){if(!current())return;packagesBusy=false;packagePlans=java.util.Collections.emptyList();packagesError="Paketler yüklenemedi. Paketleri yenileyerek tekrar dene.";if(packagesVisible)showPackages();}
        });
    }
    private void openRegularPackage(PackagePlan plan){
        if(plan==null)return;String url=plan.url();
        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));analytics.event("package_open",TvAnalytics.values("package_users",plan.users));}
        catch(ActivityNotFoundException|SecurityException unavailable){notice("TV’de tarayıcı bulunamadı. Telefonunda "+url+" adresini aç ve aynı hesap kodunla giriş yap. Ardından Erişimi kontrol et seçeneğini kullan.");}
    }
    private void openPackages(int users){
        String url=Uri.parse(WelcomeOffer.notEligible().paymentUrl(users)).buildUpon().appendQueryParameter("from","android_tv").build().toString();
        try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));analytics.event("package_open",TvAnalytics.values("package_users",users));}
        catch(ActivityNotFoundException|SecurityException unavailable){notice("TV’de tarayıcı bulunamadı. Telefonunda "+url+" adresini aç ve aynı 16 karakterli hesap kodunla giriş yap. Ödeme tamamlandığında erişimin bu hesabına otomatik tanımlanır.");}
    }
    @Override public void onWindowFocusChanged(boolean focused) {super.onWindowFocusChanged(focused);if(focused){openSearchSelection();if(informationSelection!=null && (dialog==null || !dialog.isShowing())){Item item=informationSelection;informationSelection=null;play(item);}}}
    private boolean valid(long ticket,String scope) {
        // A remembered session bootstraps its first source inside the repository operation.
        // The repository rejects stale auth/source generations before delivering this callback.
        return screenAlive(ticket) && (scope.equals(repository.currentScope()) || (scope.isEmpty() && repository.hasSession()));
    }
    private void invalidateScopedCatalogs() {
        presentations.clear();
        preparedScope="";favoritesRefreshSerial++;favoritesRefreshPending=false;favoritesRefreshAgain=false;
        favoriteMutations.clear();
        homeLoadSerial++;homeSources.clear();homeRefreshPending=false;
        clearPendingCatalogs();
        for(Page p:pages.values()){p.catalog=null;p.catalogScope="";p.focusKey="";p.discoveryFocus="";p.heroKey="";p.scroll=0;p.scrollOffset=0;p.category="";p.categoryTitle="Tümü";p.query="";}
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
        if(stopped || destroyed || isFinishing() || !repository.hasSession() || welcomeBlocked() || verifiedAccount==null || !verifiedAccount.canPlay || packagesVisible || !catalogMatchesCurrentSource(catalog))return;
        pendingCatalogUpdates.put(catalog.kind,catalog);
        pendingCatalogScopes.put(catalog.kind,repository.currentScope());
        if(!searchHandoffPending() && !searchPlayerReturn && !playerLaunching && (dialog==null || !dialog.isShowing()))applyPendingCatalogs(true);
    }
    private void applyPendingCatalogs(boolean redraw) {
        if(stopped || destroyed || !repository.hasSession() || welcomeBlocked() || verifiedAccount==null || !verifiedAccount.canPlay || packagesVisible || (dialog!=null && dialog.isShowing()))return;
        if(discardPreviousSource()) {
            if(redraw && page.section!=Section.ACCOUNT)showPage(false,false);
            return;
        }
        boolean visibleChanged=false,favoritesChanged=false,posterFocused=isPosterCard(getCurrentFocus());
        for(Catalog catalog:pendingCatalogUpdates.values()) {
            if(!repository.currentScope().equals(pendingCatalogScopes.get(catalog.kind)) || !catalogMatchesCurrentSource(catalog))continue;
            if(pages.get(Section.HOME).catalog!=null || page.section==Section.HOME){homeSources.put(catalog.kind,catalog);homeRefreshPending=true;}
            for(Page target:pages.values()) {
                Kind kind=target.section==Section.LIVE?Kind.LIVE:target.section==Section.SERIES?Kind.SERIES:Kind.MOVIE;
                if(target.section==Section.FAVORITES) {
                    if(target.catalog==null || !repository.currentScope().equals(target.catalogScope))continue;
                    if(target==page)favoritesChanged=true;
                    else {target.catalog=null;target.catalogScope="";}
                    continue;
                }
                if(target.section==Section.ACCOUNT || target.section==Section.HOME || kind!=catalog.kind)continue;
                if(target==page){visibleChanged=true;captureGrid();if(resizeFocus==null)resizeFocus=focusIdentity(getCurrentFocus());}
                target.catalog=catalog;target.catalogScope=repository.currentScope();
            }
        }
        clearPendingCatalogs();
        if(homeRefreshPending){
            if(page.section==Section.HOME){captureGrid();if(resizeFocus==null)resizeFocus=focusIdentity(getCurrentFocus());visibleChanged=true;}
            rebuildHomeCatalog();
        }
        if(favoritesChanged)favoritesRefreshAgain=true;
        if(redraw && page.section==Section.FAVORITES && favoritesRefreshAgain){
            favoritesRefreshAgain=false;refreshFavoritesInPlace(posterFocused);
        }else if(redraw && visibleChanged)replaceCatalog(posterFocused);
    }
    private void refreshFavoritesInPlace(boolean contentFocus){
        if(favoritesRefreshPending){favoritesRefreshAgain=true;return;}
        final Page owner=page;final long ticket=generation,id=++favoritesRefreshSerial;final String scope=repository.currentScope();
        favoritesRefreshPending=true;captureGrid();
        repository.favorites(new TvRepository.Callback<List<Item>>(){
            public void onResult(List<Item> items){
                if(id!=favoritesRefreshSerial)return;favoritesRefreshPending=false;
                if(page!=owner || owner.section!=Section.FAVORITES || stopped || destroyed || !repository.hasSession() || !scope.equals(repository.currentScope()))return;
                if(!valid(ticket,scope)){favoritesRefreshAgain=true;findViewById(android.R.id.content).post(MainActivity.this::flushFavoriteRefresh);return;}
                if(searchHandoffPending() || searchPlayerReturn || playerLaunching || catalogDialog!=null || dialog!=null && dialog.isShowing()){favoritesRefreshAgain=true;return;}
                owner.catalog=new Catalog(Kind.MOVIE,items,new ArrayList<>());owner.catalogScope=repository.currentScope();
                replaceCatalog(contentFocus);
            }
            public void onError(Failure failure){if(id==favoritesRefreshSerial){favoritesRefreshPending=false;favoritesRefreshAgain=false;}}
        });
    }
    private <T> TvRepository.Callback<T> callback(long ticket,String scope,Result<T> result,Runnable retry) {
        final String owner=repository.currentAccountId();
        return new TvRepository.Callback<T>() {
            public void onResult(T value) { if(valid(ticket,scope))result.accept(value); }
            public void onError(Failure failure) {
                if(!screenAlive(ticket))return;
                if(recoverCatalogDenial(owner,scope,failure))return;
                if(failure.code==Failure.Code.STALE)return;
                if(failure.code==Failure.Code.AUTH && (scope.equals(repository.currentScope()) || !repository.hasSession()))sessionEnded(failure.message);
                else if(failure.code!=Failure.Code.AUTH && valid(ticket,scope)){showFailure(failure.message,retry);}
            }
        };
    }
    private interface Result<T> { void accept(T value); }
    private void sessionEnded(String message) {verifiedAccount=null;verifiedOwner="";accessSerial++;accessBusy=false;packagesSerial++;packagesBusy=false;packagePlans=null;packagesVisible=false;welcomeSerial++;welcomeResolved=false;welcomeBusy=false;welcomeOffer=null;welcomeAccount="";repository.logout();artwork.clear();updatePanel.cancel();invalidateScopedCatalogs();showLogin(message);}
    private void resizeScreen() {
        if(packagesVisible){resizeFocus=focusIdentity(getCurrentFocus());showPackages();return;}
        if(repository.hasSession() && welcomeBlocked()){renderWelcome();return;}
        // A native IME may resize the Activity behind its dialog. Keep the owning
        // catalogue and the same editor alive until the draft is closed/submitted.
        if(searchHandoffPending() || searchPlayerReturn || (catalogDialog!=null && catalogDialog.isShowing())){resizeAfterCatalog=true;return;}
        if(!repository.hasSession()) {
            // Resize existing views: replacing the editor would detach the IME and invalidate a pending login.
            sizing=TvLayout.measure(this);
            if(loginScroll!=null)loginScroll.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,14),TvUi.dp(this,sizing.inset),TvUi.dp(this,14));
            resizeLoginColumns();
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
        if(discovery!=null && discovery.isDescendant(view))return "discovery:"+discovery.focusPath(view);
        if(tag instanceof FocusToken)return ((FocusToken)tag).key;
        return tag instanceof String?"poster:"+tag:null;
    }
    private View findFocus(View root,String key) {
        if(key.equals(focusIdentity(root)) && root.isFocusable() && root.getVisibility()==View.VISIBLE)return root;
        if(key.startsWith("poster:") && root.getTag() instanceof String && key.substring(7).equals(root.getTag()) && root.isFocusable() && root.getVisibility()==View.VISIBLE)return root;
        if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){View found=findFocus(((ViewGroup)root).getChildAt(n),key);if(found!=null)return found;}
        return null;
    }
    private void restoreResizeFocus(){restoreResizeFocus(false);}
    private void restoreResizeFocus(boolean completeSurface) {
        final String wanted=resizeFocus;if(wanted==null)return;
        View content=findViewById(android.R.id.content);
        content.post(()->{
            if(destroyed || !wanted.equals(resizeFocus))return;
            if(discovery!=null && wanted.startsWith("discovery:")){discovery.restore(page.scroll,page.scrollOffset,wanted.substring(10),true);resizeFocus=null;return;}
            View target=findFocus(content,wanted);
            if(target!=null){target.requestFocus();resizeFocus=null;}else if(completeSurface)resizeFocus=null;
        });
    }
    private void showLogin(String message){showLogin(message,true);}
    private void showLogin(String message,boolean beginPairing) {
        stopTrialClocks();trialNavigationClock=null;trialAccountClock=null;
        if(deviceLogin!=null)deviceLogin.cancel();clearPairingBitmap();
        presentations.clear();
        visibleAnalyticsScreen="login";analytics.screen(visibleAnalyticsScreen);
        artwork.retireScreen();
        if(catalogDialog!=null && catalogDialog.isShowing())catalogDialog.dismiss();
        generation++;homeLoadSerial++;body=null;grid=null;discovery=null;resizeFocus=null;sizing=TvLayout.measure(this);measuredWidth=sizing.width;measuredHeight=sizing.height;
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        ScrollView background=new ScrollView(this);loginScroll=background;background.setTag("tv-login");background.setFillViewport(true);background.setBackgroundColor(TvUi.BACKGROUND);
        background.setClipToPadding(false);background.setPadding(TvUi.dp(this,sizing.inset),TvUi.dp(this,14),TvUi.dp(this,sizing.inset),TvUi.dp(this,14));
        LinearLayout center=TvUi.column(this);center.setGravity(Gravity.CENTER);background.addView(center,new ScrollView.LayoutParams(-1,-2));
        loginColumns=TvUi.row(this);loginColumns.setGravity(Gravity.CENTER);center.addView(loginColumns,new LinearLayout.LayoutParams(-1,-2));
        loginColumns.addOnLayoutChangeListener((v,l,t,r,b,oldL,oldT,oldR,oldB)->{
            if(l!=oldL || t!=oldT || r!=oldR || b!=oldB)revealLoginControl(false);
        });
        loginPairingPanel=TvUi.column(this);loginPairingPanel.setGravity(Gravity.CENTER_HORIZONTAL);loginColumns.addView(loginPairingPanel,new LinearLayout.LayoutParams(TvUi.dp(this,240),-2));
        TextView phoneTitle=TvUi.text(this,"Telefonla giriş",23,TvUi.WHITE);TvUi.heading(phoneTitle);loginPairingPanel.addView(phoneTitle,TvUi.space(this,-1,-2));
        TextView phoneHint=TvUi.text(this,"Telefonunuzun kamerasıyla tarayın ve eşleşen kodu onaylayın.",15,TvUi.MUTED);phoneHint.setGravity(Gravity.CENTER);loginPairingPanel.addView(phoneHint,TvUi.space(this,-1,-2));
        pairingQr=new ImageView(this);pairingQr.setContentDescription("Telefonla giriş için QR kodu");pairingQr.setScaleType(ImageView.ScaleType.FIT_CENTER);pairingQr.setBackgroundColor(android.graphics.Color.WHITE);loginPairingPanel.addView(pairingQr,TvUi.space(this,188,188));
        pairingCode=TvUi.text(this,"",24,TvUi.WHITE);pairingCode.setGravity(Gravity.CENTER);loginPairingPanel.addView(pairingCode,TvUi.space(this,-1,-2));
        TextView pairingUrl=TvUi.text(this,"flixify.vip/cihaz",15,TvUi.MUTED);pairingUrl.setGravity(Gravity.CENTER);loginPairingPanel.addView(pairingUrl,TvUi.space(this,-1,-2));
        pairingStatus=TvUi.text(this,"QR kodu hazırlanıyor…",14,TvUi.MUTED);pairingStatus.setGravity(Gravity.CENTER);pairingStatus.setMinHeight(TvUi.dp(this,44));loginPairingPanel.addView(pairingStatus,TvUi.space(this,-1,-2));
        Button renew=TvUi.button(this,"QR kodunu yenile",()->{if(deviceLogin!=null)deviceLogin.start();});loginPairingPanel.addView(renew,TvUi.space(this,-1,48));
        Button cancelPairing=TvUi.button(this,"Telefonla girişi durdur",()->{if(deviceLogin!=null)deviceLogin.pause();loginCode.requestFocus();});loginPairingPanel.addView(cancelPairing,TvUi.space(this,-1,48));renew.setNextFocusDownId(cancelPairing.getId());cancelPairing.setNextFocusUpId(renew.getId());
        LinearLayout form=TvUi.column(this);loginForm=form;form.setGravity(Gravity.CENTER_HORIZONTAL);
        loginColumns.addView(form,new LinearLayout.LayoutParams(TvUi.dp(this,480),-2));resizeLoginColumns();
        ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.flixify_logo);logo.setContentDescription("Flixify");logo.setScaleType(ImageView.ScaleType.FIT_CENTER);form.addView(logo,TvUi.space(this,220,sizing.shortScreen?44:66));
        TextView title=TvUi.text(this,"TV'de izlemeye başlayın",sizing.compact?23:28,TvUi.WHITE);TvUi.heading(title);form.addView(title,TvUi.space(this,-1,-2));
        TextView hint=TvUi.text(this,"16 karakterli hesap kodunuzla giriş yapın.",16,TvUi.MUTED);form.addView(hint,TvUi.space(this,-1,-2));
        loginCode=new RemoteEditText(this){
            @Override public boolean onKeyPreIme(int key,KeyEvent event){if(key==KeyEvent.KEYCODE_DPAD_LEFT && event.getAction()==KeyEvent.ACTION_DOWN && imeHidden()){renew.requestFocus();return true;}return super.onKeyPreIme(key,event);}
        };loginCode.setId(View.generateViewId());loginCode.setTextColor(TvUi.WHITE);loginCode.setTextSize(22);loginCode.setSingleLine(true);
        loginCode.setHint("Giriş kodu");loginCode.setHintTextColor(TvUi.MUTED);loginCode.setContentDescription("16 karakterli giriş kodu");
        loginCode.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);loginCode.setFilters(new InputFilter[]{new InputFilter.LengthFilter(16)});
        loginCode.setImeOptions(EditorInfo.IME_ACTION_GO);loginCode.setPadding(TvUi.dp(this,16),TvUi.dp(this,8),TvUi.dp(this,16),TvUi.dp(this,8));loginCode.setBackground(TvUi.focusBackground(this));form.addView(loginCode,TvUi.space(this,-1,54));
        Button submit=TvUi.button(this,"Giriş yap",this::login);form.addView(submit,TvUi.space(this,-1,48));loginCode.setNextFocusDownId(submit.getId());submit.setNextFocusUpId(loginCode.getId());
        renew.setNextFocusRightId(loginCode.getId());cancelPairing.setNextFocusRightId(loginCode.getId());loginCode.setNextFocusLeftId(renew.getId());submit.setNextFocusLeftId(renew.getId());
        loginCode.setOnKeyListener((v,key,event)->{if(key==KeyEvent.KEYCODE_DPAD_LEFT && event.getAction()==KeyEvent.ACTION_DOWN){renew.requestFocus();return true;}if(key==KeyEvent.KEYCODE_DPAD_DOWN && event.getAction()==KeyEvent.ACTION_DOWN){submit.requestFocus();return true;}return false;});
        loginCode.setOnEditorActionListener((v,action,event)->{if(action==EditorInfo.IME_ACTION_GO){login();return true;}return false;});
        loginMessage=TvUi.text(this,message,15,TvUi.ACCENT);loginMessage.setMinHeight(TvUi.dp(this,26));form.addView(loginMessage,TvUi.space(this,-1,-2));
        TextView remember=TvUi.text(this,"Oturumunuz bu cihazda güvenle hatırlanır.",14,TvUi.MUTED);form.addView(remember,TvUi.space(this,-1,-2));
        startup.show(background);loginCode.requestFocus();startup.ready();
        android.os.Handler pairingMain=new android.os.Handler(android.os.Looper.getMainLooper());
        DeviceLoginController.Scheduler scheduler=new DeviceLoginController.Scheduler(){
            public long now(){return android.os.SystemClock.elapsedRealtime();}
            public void schedule(Runnable task,long delay){pairingMain.removeCallbacksAndMessages(null);pairingMain.postDelayed(task,delay);}
            public void clear(){pairingMain.removeCallbacksAndMessages(null);}
        };
        deviceLogin=new DeviceLoginController(repository::startDeviceLogin,scheduler,new DeviceLoginController.Listener(){
            public void changed(DeviceLogin.ViewState state){renderPairing(state);}
            public void adopted(){if(destroyed || stopped || isFinishing())return;loginCode.setText("");page=pages.get(Section.HOME);welcomeResolved=false;loadWelcome();}
        });
        if(beginPairing)deviceLogin.start();else deviceLogin.pause();
    }
    private void resizeLoginColumns(){
        if(loginColumns==null || loginForm==null || loginPairingPanel==null)return;
        int available=sizing.width-sizing.inset*2-8;boolean sideBySide=available>=700;
        loginColumns.setOrientation(sideBySide?LinearLayout.HORIZONTAL:LinearLayout.VERTICAL);
        LinearLayout.LayoutParams manual=new LinearLayout.LayoutParams(TvUi.dp(this,Math.min(440,sideBySide?available-272:available)),-2);
        if(sideBySide)manual.leftMargin=TvUi.dp(this,32);else manual.topMargin=TvUi.dp(this,24);loginForm.setLayoutParams(manual);
    }
    private void revealLoginControl(boolean message){
        final ScrollView scroll=loginScroll;
        if(scroll==null)return;
        scroll.post(()->{
            if(destroyed || stopped || repository.hasSession() || scroll!=loginScroll)return;
            View target=(message || loginCode!=null && !loginCode.isEnabled())?loginMessage:getCurrentFocus();
            if(target!=null && target.isAttachedToWindow() && target.getWidth()>0 && target.getHeight()>0)
                target.requestRectangleOnScreen(new android.graphics.Rect(0,0,target.getWidth(),target.getHeight()),true);
        });
    }
    private void clearPairingBitmap(){if(pairingQr!=null)pairingQr.setImageDrawable(null);if(pairingBitmap!=null){pairingBitmap.recycle();pairingBitmap=null;}pairingPng="";}
    private void renderPairing(DeviceLogin.ViewState state){
        boolean show=state.display!=null && state.remainingSeconds>0 && ("pending".equals(state.status) || "slow_down".equals(state.status) || "network".equals(state.status));
        if(show){
            if(!state.display.qrPngBase64.equals(pairingPng)){clearPairingBitmap();pairingBitmap=DeviceLoginQr.decode(state.display.qrPngBase64);pairingPng=state.display.qrPngBase64;if(pairingBitmap!=null){android.graphics.drawable.BitmapDrawable drawable=new android.graphics.drawable.BitmapDrawable(getResources(),pairingBitmap);drawable.setFilterBitmap(false);drawable.setAntiAlias(false);pairingQr.setImageDrawable(drawable);}}
            pairingCode.setText(state.display.userCode);pairingQr.setVisibility(View.VISIBLE);
        }else{clearPairingBitmap();pairingCode.setText("");pairingQr.setVisibility(View.GONE);}
        String message;
        switch(state.status){
            case "pending":case "slow_down":message=state.remainingSeconds>0?"Telefonunuzdan onay bekleniyor · "+state.remainingSeconds+" sn":"Onay sonucu kontrol ediliyor…";break;
            case "network":message=state.remainingSeconds>0?"Bağlantı tekrar deneniyor · "+state.remainingSeconds+" sn":"Onay sonucu tekrar kontrol ediliyor…";break;
            case "starting":message="QR kodu hazırlanıyor…";break;
            case "denied":message="Giriş onaylanmadı. Yeni bir QR kodu oluşturabilirsiniz.";break;
            case "expired":message="QR kodunun süresi doldu. Yenile düğmesini kullanın.";break;
            case "paused":case "cancelled":message="Telefonla giriş durduruldu. Yenileyerek tekrar başlayın.";break;
            case "complete":message="Giriş tamamlandı.";break;
            case "storage":message="Bu cihazda giriş güvenle kaydedilemedi"+(state.storageCode.isEmpty()?"":" ("+state.storageCode+")")+". Tekrar deneyin.";break;
            default:message="Telefonla giriş şu anda kullanılamıyor. Kodunuzla giriş yapabilir veya QR kodunu yenileyebilirsiniz.";
        }
        pairingStatus.setText(message);
    }
    private void login() {
        String code=loginCode.getText().toString().trim();
        if(code.length()!=16) {
            loginMessage.setText("16 karakterli giriş kodunuzu yazın.");
            loginMessage.post(()->loginMessage.requestRectangleOnScreen(new android.graphics.Rect(0,0,loginMessage.getWidth(),loginMessage.getHeight()),true));return;
        }
        if(deviceLogin!=null)deviceLogin.pause();
        ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(loginCode.getWindowToken(),0);
        final long ticket=++generation,analyticsTicket=analytics.epoch(); loginMessage.setText("Giriş yapılıyor…"); loginCode.setEnabled(false);revealLoginControl(true);
        repository.login(code,new TvRepository.Callback<Account>() {
            public void onResult(Account account) {
                if(destroyed || stopped || ticket!=generation)return;
                analytics.event(analyticsTicket,"login",Collections.emptyMap());
                loginCode.setText(""); page=pages.get(Section.HOME);welcomeResolved=false;loadWelcome();
            }
            public void onError(Failure failure) {
                if(destroyed || stopped || ticket!=generation)return;
                loginCode.setEnabled(true); loginMessage.setText(safeMessage(failure.message)); loginCode.requestFocus();
            }
        });
    }
    private void shell(String title,String subtitle) {
        stopTrialClocks();trialNavigationClock=null;trialAccountClock=null;
        presentations.cancel();
        artwork.retireScreen();
        if(catalogDialog!=null && catalogDialog.isShowing())catalogDialog.dismiss();
        generation++;grid=null;discovery=null;sizing=TvLayout.measure(this);measuredWidth=sizing.width;measuredHeight=sizing.height;
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
        trialNavigationClock=TvUi.text(this,"",sizing.compact?12:14,TvUi.WHITE);trialNavigationClock.setTag("tv-trial-countdown");
        trialNavigationClock.setPadding(TvUi.dp(this,10),TvUi.dp(this,12),TvUi.dp(this,4),0);navigation.addView(trialNavigationClock,TvUi.space(this,-1,-2));bindTrialClocks();
        body=TvUi.column(this);body.setPadding(TvUi.dp(this,sizing.gap),0,0,0);root.addView(body,new LinearLayout.LayoutParams(0,-1,1));
        if(page.section!=Section.HOME){
            TextView heading=TvUi.text(this,title,sizing.shortScreen?22:28,TvUi.WHITE);TvUi.heading(heading);heading.setSingleLine(true);heading.setEllipsize(TextUtils.TruncateAt.END);body.addView(heading,TvUi.space(this,-1,sizing.heading));
            if(subtitle!=null && !subtitle.isEmpty() && !sizing.shortScreen){TextView sub=TvUi.text(this,subtitle,14,TvUi.MUTED);sub.setSingleLine(true);sub.setEllipsize(TextUtils.TruncateAt.END);body.addView(sub,TvUi.space(this,-1,24));}
        }
        startup.show(root);rail[page.section.ordinal()].requestFocus();restoreResizeFocus();
    }
    private void navigate(Section target) {
        resizeFocus=null;captureGrid(); page=pages.get(target);
        if(target==Section.ACCOUNT)showAccount();else showPage(target==Section.FAVORITES,false);
    }
    private Kind pageKind() { return page.section==Section.LIVE?Kind.LIVE:page.section==Section.SERIES?Kind.SERIES:Kind.MOVIE; }
    private String pageTitle() { return page.section==Section.HOME?"Sizin için":NAV[page.section.ordinal()]; }
    private void showPage(boolean reload,boolean contentFocus) {
        if(welcomeBlocked()){loadWelcome();return;}
        if(accessGate())return;packagesVisible=false;
        visibleAnalyticsScreen=page.section.name().toLowerCase(Locale.ROOT);analytics.screen(visibleAnalyticsScreen);
        discardPreviousSource();
        applyPendingCatalogs(false);
        shell(pageTitle(),page.section==Section.HOME?"Filmler, diziler ve canlı yayınlar tek yerde.":"");
        if(!reload && page.catalog!=null) {
            renderCatalog(contentFocus);
            if(page.section==Section.HOME && homeSources.size()<3)loadHomeCatalogs(false,contentFocus);
            return;
        }
        TextView loading=TvUi.text(this,"Yükleniyor…",20,TvUi.MUTED); body.addView(loading,TvUi.space(this,-1,64));
        final long ticket=generation; final String scope=repository.currentScope();
        if(page.section==Section.FAVORITES) repository.favorites(callback(ticket,scope,items->{
            page.catalog=new Catalog(Kind.MOVIE,items,new ArrayList<>());page.catalogScope=repository.currentScope();replaceCatalog(contentFocus);
        },()->showPage(true,true)));
        else if(page.section==Section.HOME)loadHomeCatalogs(reload,contentFocus);
        else {final long analyticsTicket=analytics.epoch();repository.catalog(pageKind(),reload,callback(ticket,scope,catalog->{page.catalog=catalog;page.catalogScope=repository.currentScope();analytics.event(analyticsTicket,"catalog_page_loaded",TvAnalytics.values("result_count",catalog.items.size()));replaceCatalog(contentFocus);},()->showPage(true,true)));}
    }
    private void loadHomeCatalogs(boolean force,boolean contentFocus){
        final Page owner=pages.get(Section.HOME);final long serial=++homeLoadSerial;final String account=repository.currentAccountId(),source=repository.currentScope();
        if(force){homeSources.clear();owner.catalog=null;owner.catalogScope="";}
        List<Kind> missing=new ArrayList<>();for(Kind kind:new Kind[]{Kind.MOVIE,Kind.SERIES,Kind.LIVE})if(!homeSources.containsKey(kind))missing.add(kind);
        final int[] remaining={missing.size()};final boolean[] ready={owner.catalog!=null};
        for(Kind kind:missing)repository.homeCatalog(kind,force,new TvRepository.Callback<Catalog>(){
            private boolean current(){return serial==homeLoadSerial && !stopped && !destroyed && !isFinishing() && repository.hasSession() && (account.isEmpty() || account.equals(repository.currentAccountId())) && !welcomeBlocked();}
            public void onResult(Catalog catalog){
                if(!current() || !catalogMatchesCurrentSource(catalog))return;
                homeSources.put(catalog.kind,catalog);homeRefreshPending=true;remaining[0]--;
                if(page!=owner){rebuildHomeCatalog();ready[0]=true;}
                else if(!searchHandoffPending() && !searchPlayerReturn && !playerLaunching && (dialog==null || !dialog.isShowing())){
                    boolean restore=contentFocus || discovery!=null && discovery.isDescendant(getCurrentFocus());captureGrid();
                    rebuildHomeCatalog();replaceCatalog(restore);ready[0]=true;
                }
            }
            public void onError(Failure failure){
                if(!current())return;if(recoverCatalogDenial(account,source,failure))return;if(failure.code==Failure.Code.STALE)return;remaining[0]--;
                if(failure.code==Failure.Code.AUTH){sessionEnded(failure.message);return;}
                if(remaining[0]==0 && !ready[0] && homeSources.isEmpty() && page==owner){showFailure(failure.message,()->showPage(true,true));}
            }
        });
    }
    private void rebuildHomeCatalog(){
        List<Item> items=new ArrayList<>();Map<String,Category> categories=new LinkedHashMap<>();
        for(Kind kind:new Kind[]{Kind.MOVIE,Kind.SERIES,Kind.LIVE}){
            Catalog source=homeSources.get(kind);if(source==null || !catalogMatchesCurrentSource(source))continue;
            items.addAll(source.items);for(Category category:source.categories)if(!categories.containsKey(category.id))categories.put(category.id,category);
        }
        Page home=pages.get(Section.HOME);home.catalog=new Catalog(Kind.MOVIE,items,new ArrayList<>(categories.values()));home.catalogScope=repository.currentScope();homeRefreshPending=false;
    }
    private void replaceCatalog(boolean contentFocus) { shell(pageTitle(),page.section==Section.HOME?"Filmler, diziler ve canlı yayınlar tek yerde.":""); renderCatalog(contentFocus); }
    private void captureGrid() {
        if(grid==null || page==null)return;
        RecyclerView.LayoutManager layout=grid.getLayoutManager(); if(layout instanceof GridLayoutManager)page.scroll=Math.max(0,((GridLayoutManager)layout).findFirstVisibleItemPosition());
        View focus=getCurrentFocus(); if(focus!=null && focus.getTag() instanceof String)page.focusKey=(String)focus.getTag();
        if(discovery!=null){page.scrollOffset=discovery.scrollOffset();page.discoveryFocus=discovery.focusPath(focus);page.heroKey=discovery.selectedHero();}
    }
    private void linkContent(View first) { for(Button b:rail)b.setNextFocusRightId(first.getId()); first.setNextFocusLeftId(rail[page.section.ordinal()].getId()); }
    private void renderCatalog(boolean contentFocus) {
        final Page owner=page;final Catalog snapshot=page.catalog;final long ticket=generation;
        final CatalogPresentation.Key key=new CatalogPresentation.Key(snapshot,page.section.name(),repository.currentAccountId(),repository.currentScope(),CatalogShowcase.dayKey(),page.category,page.query);
        CatalogPresentation ready=presentations.cached(key);
        // The measured 12k movie pass took 5 seconds; cap inline work at 64 rows (about 27 ms at that slope).
        if(ready==null && snapshot.items.size()<=64){ready=CatalogPresentation.prepare(key);presentations.remember(key,ready);}
        if(ready!=null){renderCatalog(contentFocus,ready);return;}
        TextView loading=TvUi.text(this,"Yükleniyor…",20,TvUi.MUTED);body.addView(loading,TvUi.space(this,-1,64));
        presentations.request(key,result->{
            if(!screenAlive(ticket) || stopped || page!=owner || owner.catalog!=snapshot || !repository.hasSession() || !key.account.equals(repository.currentAccountId()) || !key.scope.equals(repository.currentScope()) || !key.category.equals(owner.category) || !key.query.equals(owner.query))return;
            if(!key.day.equals(CatalogShowcase.dayKey())){replaceCatalog(contentFocus);return;}
            body.removeView(loading);renderCatalog(contentFocus,result);
        });
    }
    private void renderCatalog(boolean contentFocus,CatalogPresentation prepared) {
        String effectiveCategory=prepared.category;
        if(!effectiveCategory.equals(page.category)){page.category=effectiveCategory;page.categoryTitle="Tümü";page.scroll=0;page.focusKey="";}
        List<Item> filtered=prepared.items;
        LinearLayout controls=TvUi.row(this);body.addView(controls,TvUi.space(this,-1,50));
        Button search=TvUi.button(this,"Ara",this::search);search.setBackground(TvUi.catalogActionBackground(this,!page.query.isEmpty()));search.setPadding(TvUi.dp(this,10),0,TvUi.dp(this,10),0);search.setCompoundDrawablesWithIntrinsicBounds(TvUi.catalogIcon(this,0,16),null,null,null);search.setCompoundDrawablePadding(TvUi.dp(this,6));markFocus(search,"catalog:search");controls.addView(search,TvUi.space(this,sizing.compact?86:96,42));
        Button category=TvUi.button(this,"Kategori: "+page.categoryTitle,this::categories);category.setBackground(TvUi.catalogActionBackground(this,!page.category.isEmpty()));category.setPadding(TvUi.dp(this,10),0,TvUi.dp(this,10),0);category.setCompoundDrawablesWithIntrinsicBounds(TvUi.catalogIcon(this,1,16),null,null,null);category.setCompoundDrawablePadding(TvUi.dp(this,6));markFocus(category,"catalog:category");category.setSingleLine(true);category.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams categorySpace=TvUi.space(this,0,42);categorySpace.weight=1;controls.addView(category,categorySpace);
        Button refresh=TvUi.button(this,"Yenile",()->showPage(true,true));refresh.setSingleLine(true);refresh.setEllipsize(TextUtils.TruncateAt.END);refresh.setBackground(TvUi.utilityBackground(this));refresh.setPadding(TvUi.dp(this,8),0,TvUi.dp(this,8),0);refresh.setCompoundDrawablesWithIntrinsicBounds(TvUi.catalogIcon(this,2,16),null,null,null);refresh.setCompoundDrawablePadding(TvUi.dp(this,5));markFocus(refresh,"catalog:refresh");controls.addView(refresh,TvUi.space(this,sizing.compact?104:110,42));
        linkContent(search); search.setNextFocusRightId(category.getId()); category.setNextFocusLeftId(search.getId()); category.setNextFocusRightId(refresh.getId()); refresh.setNextFocusLeftId(category.getId());
        if(!page.query.isEmpty())body.addView(TvUi.text(this,"Arama: "+page.query+" · "+filtered.size()+" sonuç",15,TvUi.MUTED),TvUi.space(this,-1,30));
        if(filtered.isEmpty()) {
            body.addView(TvUi.text(this,page.section==Section.FAVORITES?"Henüz favoriniz yok. Bir içeriği açıp favorilere ekleyin.":"İçerik bulunamadı.",18,TvUi.MUTED),TvUi.space(this,-1,72));
            if(contentFocus)search.requestFocus();restoreResizeFocus(true);startup.ready();prepareOfflineData();return;
        }
        if(page.query.isEmpty() && page.category.isEmpty() && (page.section==Section.HOME || page.section==Section.MOVIES || page.section==Section.SERIES || page.section==Section.FAVORITES)){
            renderDiscovery(prepared,search,contentFocus);restoreResizeFocus(true);startup.ready();prepareOfflineData();return;
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
        startup.ready();
        prepareOfflineData();
    }
    private void flushFavoriteRefresh(){
        if(!stopped && !destroyed && !isFinishing() && page.section==Section.FAVORITES && favoritesRefreshAgain && !favoritesRefreshPending && !searchHandoffPending() && !searchPlayerReturn && !playerLaunching && catalogDialog==null && (dialog==null || !dialog.isShowing())){favoritesRefreshAgain=false;refreshFavoritesInPlace(isPosterCard(getCurrentFocus()));}
    }
    private void prepareOfflineData(){
        flushFavoriteRefresh();
        String scope=repository.currentScope();
        if(!scope.isEmpty() && !scope.equals(preparedScope)){preparedScope=scope;repository.prepareOfflineData();}
    }
    private void renderDiscovery(CatalogPresentation prepared,Button search,boolean contentFocus){
        List<Item> items=prepared.items,archive=prepared.archive;String archiveTitle=prepared.archiveTitle;boolean emptyHero=prepared.emptyHero;
        CatalogShowcase.Result selected=prepared.showcase;
        if(page.section==Section.HOME)selected=retainFocusedHomeHero(selected,items);
        final Page owner=page;final String scope=repository.currentScope();final long ticket=generation;
        int viewportHeight=Math.max(80,sizing.height-(sizing.shortScreen?20:34)-(page.section==Section.HOME?0:sizing.heading+8)-58);
        discovery=new DiscoveryScreen(this,sizing,viewportHeight,selected,archive,archiveTitle,emptyHero,page.heroKey,new DiscoveryScreen.Actions(){
            private boolean current(Item item){return page==owner && screenAlive(ticket) && scope.equals(repository.currentScope()) && item!=null && scope.equals(item.scope);}
            public void play(Item item){if(current(item)){captureGrid();MainActivity.this.play(item);}}
            public void information(Item item){if(current(item)){captureGrid();showInformation(item);}}
            public boolean isFavorite(Item item){return repository.isFavorite(item);}
            public void favorite(Item item,Button button){
                String key=scope+"\0"+item.key();if(!current(item) || favoriteMutations.containsKey(key))return;
                final long analyticsTicket=analytics.epoch();Object operation=new Object();favoriteMutations.put(key,operation);button.setClickable(false);button.setContentDescription("Favori kaydediliyor");
                repository.toggleFavorite(item,new TvRepository.Callback<Boolean>(){
                    private boolean release(){
                        if(favoriteMutations.get(key)!=operation)return false;favoriteMutations.remove(key);
                        if(discovery!=null && discovery.isDescendant(button) && discovery.selectedHero().equals(item.key()))button.setClickable(true);
                        return true;
                    }
                    public void onResult(Boolean saved){if(!release() || !current(item))return;analytics.event(analyticsTicket,Boolean.TRUE.equals(saved)?"add_to_wishlist":"remove_from_wishlist",TvAnalytics.item(item));pages.get(Section.FAVORITES).catalog=null;if(discovery!=null && discovery.selectedHero().equals(item.key())){button.setText(Boolean.TRUE.equals(saved)?"♥":"♡");button.setContentDescription(Boolean.TRUE.equals(saved)?"Favorilerden çıkar":"Favorilere ekle");}}
                    public void onError(Failure failure){if(!release() || !current(item))return;if(discovery!=null && discovery.selectedHero().equals(item.key()))button.setContentDescription(repository.isFavorite(item)?"Favorilerden çıkar":"Favorilere ekle");if(failure.code==Failure.Code.STALE)return;if(failure.code==Failure.Code.AUTH)sessionEnded(failure.message);else notice("Favori kaydedilemedi. Tekrar deneyebilirsin.");}
                });
            }
            public void focused(Item item){if(current(item)){owner.focusKey=item.key();if(hasWindowFocus())posterSound.focused(scope,owner.section.name()+":"+item.key());}}
            public void sidebar(){rail[owner.section.ordinal()].requestFocus();posterSound.leftPosters();}
            public void toolbar(){search.requestFocus();posterSound.leftPosters();}
            public void bind(ImageView image,Item item){loadArtwork(image,item.artwork);}
            public void unbind(ImageView image){artwork.unbind(image);}
        });
        grid=discovery;body.addView(discovery,new LinearLayout.LayoutParams(-1,0,1));search.setNextFocusDownId(discovery.getId());
        String wanted=page.discoveryFocus;
        if(contentFocus && wanted.isEmpty() && !page.focusKey.isEmpty()){discovery.restore(page.scroll,page.scrollOffset,"",false);if(!discovery.focusItem(page.focusKey))discovery.restore(page.scroll,page.scrollOffset,"",true);}
        else discovery.restore(page.scroll,page.scrollOffset,wanted,contentFocus);
    }
    private CatalogShowcase.Result retainFocusedHomeHero(CatalogShowcase.Result selected,List<Item> items){
        if(!page.discoveryFocus.startsWith("hero/") || page.heroKey.isEmpty())return selected;
        for(Item item:selected.hero)if(item.key().equals(page.heroKey))return selected;
        Item retained=null;for(Item item:items)if(item.key().equals(page.heroKey) && item.kind!=Kind.LIVE && item.releaseYear==2026 && !item.artwork.trim().isEmpty()){retained=item;break;}
        if(retained==null)return selected;
        int limit=Math.max(1,selected.hero.size());List<Item> hero=new ArrayList<>();hero.add(retained);for(Item item:selected.hero)if(hero.size()<limit)hero.add(item);
        java.util.Set<String> heroKeys=new java.util.HashSet<>(),heroTitles=new java.util.HashSet<>();for(Item item:hero){heroKeys.add(item.key());heroTitles.add(showcaseTitle(item));}
        List<CatalogShowcase.Rail> rows=new ArrayList<>();
        for(CatalogShowcase.Rail row:selected.rails){
            List<Item> candidates=new ArrayList<>();
            for(Item item:selected.hero)if(!heroKeys.contains(item.key()) && (item.kind==Kind.MOVIE && row.id.equals("home-movies") || item.kind==Kind.SERIES && row.id.equals("home-series")))candidates.add(item);
            candidates.addAll(row.items);List<Item> entries=new ArrayList<>();java.util.Set<String> ids=new java.util.HashSet<>(),titles=new java.util.HashSet<>();
            for(Item item:candidates)if(entries.size()<18 && !heroKeys.contains(item.key()) && !heroTitles.contains(showcaseTitle(item)) && ids.add(item.key()) && titles.add(showcaseTitle(item)))entries.add(item);
            rows.add(new CatalogShowcase.Rail(row.id,row.title,entries));
        }
        return new CatalogShowcase.Result(hero,rows);
    }
    private static String showcaseTitle(Item item){return item.kind.name()+":"+java.text.Normalizer.normalize(item.title,java.text.Normalizer.Form.NFKC).trim().replaceAll("\\s+"," ").toLowerCase(Locale.ROOT);}
    private void showInformation(Item item){
        String metadata=(item.releaseYear>0?item.releaseYear+" · ":"")+(item.kind==Kind.SERIES?"Dizi":"Film")+(item.categoryName.isEmpty()?"":" · "+item.categoryName);
        String message=metadata+(item.description.isEmpty()?"":"\n\n"+item.description);
        AlertDialog detail=new AlertDialog.Builder(this).setTitle(item.title).setMessage(message).setNegativeButton("Kapat",null).setPositiveButton("İzle",(d,w)->informationSelection=item).create();
        dialog=detail;afterOrdinaryDialog(detail);detail.setOnShowListener(d->detail.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());detail.show();
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
            if(item.kind==Kind.LIVE){holder.image.setBackground(TvUi.rounded(MainActivity.this,android.graphics.Color.WHITE,0,10,1));holder.image.setScaleType(ImageView.ScaleType.FIT_CENTER);int pad=TvUi.dp(MainActivity.this,14);holder.image.setPadding(pad,pad,pad,pad);}
            else holder.image.setBackground(TvUi.rounded(MainActivity.this,TvUi.PANEL,0,10,1));
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
    private boolean searchHandoffPending(){return searchSelection!=null && searchSelection.scope.equals(repository.currentScope());}
    private void catalogDismissed(Dialog dismissed,Page owner,Catalog snapshot,long ticket,String scope,String opener,boolean[] committed) {
        if(dialog==dismissed)dialog=null;
        if(catalogDialog!=dismissed)return;
        catalogDialog=null;
        boolean resize=resizeAfterCatalog;resizeAfterCatalog=false;
        if(stopped || destroyed || isFinishing())return;
        findViewById(android.R.id.content).post(()->{
            if(stopped || destroyed || isFinishing())return;
            if(searchSelection!=null || playerLaunching){openSearchSelection();if(searchSelection!=null || playerLaunching)return;}
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
                    owner.query=text.trim();recordSearch(snapshot,owner.category,text);owner.scroll=0;owner.focusKey="";
                    panel[0].dismiss();showPage(false,true);
                },(item,text)->{
                    committed[0]=true;
                    if(catalogOwner(owner,snapshot,ticket,scope)){recordSearch(snapshot,owner.category,text);searchSelection=new SearchSelection(owner,snapshot,ticket,scope,text.trim(),item);}
                    panel[0].dismiss();
                },()->catalogDismissed(panel[0],owner,snapshot,ticket,scope,"catalog:search",committed));
        dialog=catalogDialog=panel[0];panel[0].show();
    }
    private void openSearchSelection() {
        SearchSelection selection=searchSelection;
        // The dialog owns focus until dismissal; keep the normal player launch guard intact.
        if(selection==null || !hasWindowFocus() || dialog!=null || catalogDialog!=null)return;
        searchSelection=null;resizeAfterCatalog=false;
        if(!catalogOwner(selection.owner,selection.snapshot,selection.ticket,selection.scope)){applyPendingCatalogs(true);return;}
        applyPendingCatalogs(false);
        if(!screenAlive(selection.ticket) || page!=selection.owner || !selection.scope.equals(repository.currentScope()) || page.catalog==null)return;
        Item selected=null;
        for(Item item:page.catalog.items)if(item.key().equals(selection.item.key()) && item.scope.equals(selection.scope) && CatalogFilterData.matches(item,page.category,selection.query)){selected=item;break;}
        if(selected==null){showPage(false,true);return;}
        page.query=selection.query;page.scroll=0;page.focusKey=selected.key();
        searchPlayerReturn=true;
        play(selected);
        if(!playerLaunching)searchPlayerReturn=false;
    }
    private void categories() {
        if(page.catalog==null)return;
        final Page owner=page;final Catalog snapshot=page.catalog;final long ticket=generation;final String scope=repository.currentScope();
        final Dialog[] panel={null};final boolean[] committed={false};
        panel[0]=CatalogDialogs.categories(this,pageTitle(),owner.section==Section.FAVORITES?CatalogFilterData.favoriteCategories(snapshot,owner.query):CatalogFilterData.categories(snapshot,owner.query),owner.category,option->{
            committed[0]=true;
            if(!catalogOwner(owner,snapshot,ticket,scope)){panel[0].dismiss();return;}
            owner.category=option.id;Map<String,Object> categoryMeasurement=TvAnalytics.values("category_id",TvAnalytics.opaque(option.id));String categoryLabel=AnalyticsPolicy.catalogLabel(option.title,80);if(!categoryLabel.isEmpty())categoryMeasurement.put("category_name",categoryLabel);analytics.event("category_select",categoryMeasurement);owner.categoryTitle=option.title;owner.focusKey="";owner.scroll=0;
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
        if(accessGate())return;
        if(playerLaunching || stopped || destroyed || isFinishing() || !hasWindowFocus())return;
        if(!item.scope.equals(repository.currentScope())) { notice("Kaynak değişti. Listeyi yenileyin.");return; }
        playerLaunching=true;
        Intent intent=new Intent(this,PlayerActivity.class);intent.putExtra(PlayerActivity.EXTRA_ITEM,item);
        try {startActivity(intent);analytics.event("select_content",TvAnalytics.item(item));}
        catch(android.content.ActivityNotFoundException | SecurityException unavailable) {
            playerLaunching=false;notice("Oynatıcı açılamadı. Yeniden deneyin.");
        }
    }
    private LinearLayout scrollContent() {
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setClipToPadding(false);
        LinearLayout inner=TvUi.column(this);inner.setPadding(0,TvUi.dp(this,8),0,TvUi.dp(this,16));scroll.addView(inner,new ScrollView.LayoutParams(-1,-2));body.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));return inner;
    }
    private void showAccount() {
        packagesVisible=false;
        if(welcomeBlocked()){loadWelcome();return;}
        visibleAnalyticsScreen="account";analytics.screen(visibleAnalyticsScreen);
        page=pages.get(Section.ACCOUNT);
        if(verifiedAccount!=null&&verifiedOwner.equals(repository.currentAccountId()))renderAccount(verifiedAccount);
        else{
            shell("Hesabım","");
            LinearLayout loading=scrollContent();loading.addView(TvUi.text(this,"Hesap yükleniyor…",20,TvUi.MUTED),TvUi.space(this,-1,64));addAccountActions(loading);
        }
        recoveringCatalog=false;resolveVerifiedAccess(false,true);
    }
    private void renderAccount(Account account){
            String accountFocus=focusIdentity(getCurrentFocus());
            shell("Hesabım","");LinearLayout inner=scrollContent();
            TextView packageTitle=TvUi.text(this,account.packageTitle,26,TvUi.WHITE);TvUi.heading(packageTitle);inner.addView(packageTitle,TvUi.space(this,-1,-2));
            inner.addView(TvUi.text(this,"Hesap kodu: •••• "+account.codeSuffix,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            String expiry=account.expiresAtMs>0?DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT).format(new Date(account.expiresAtMs)):"Belirtilmedi";
            inner.addView(TvUi.text(this,"Bitiş: "+expiry,18,TvUi.MUTED),TvUi.space(this,-1,-2));
            trialAccountClock=TvUi.text(this,"",26,TvUi.WHITE);trialAccountClock.setTag("tv-account-trial-countdown");inner.addView(trialAccountClock,TvUi.space(this,-1,-2));bindTrialClocks();
            TextView message=TvUi.text(this,account.message.isEmpty()?(account.canPlay?"Hesabınız aktif":"İzleme erişimi bulunmuyor."):account.message,18,account.canPlay?TvUi.MUTED:TvUi.ACCENT);inner.addView(message,TvUi.space(this,-1,-2));
            addAccountActions(inner);if(resizeFocus==null)resizeFocus=accountFocus;restoreResizeFocus(true);startup.ready();
    }

    private boolean trialIsVisible(){return !stopped&&!destroyed&&repository!=null&&repository.hasSession()&&verifiedAccount!=null&&verifiedOwner.equals(repository.currentAccountId())&&verifiedAccount.trialCountdown.visible();}
    private void stopTrialClocks(){trialHandler.removeCallbacks(trialTick);trialHandler.removeCallbacks(trialRefresh);}
    private void renderTrialClocks(){
        boolean visible=trialIsVisible();String label=visible?verifiedAccount.trialCountdown.label(android.os.SystemClock.elapsedRealtime()):"";
        for(TextView clock:new TextView[]{trialNavigationClock,trialAccountClock})if(clock!=null){clock.setVisibility(visible?View.VISIBLE:View.GONE);if(visible&&!label.contentEquals(clock.getText()))clock.setText(label);}
    }
    private void bindTrialClocks(){
        stopTrialClocks();renderTrialClocks();
        if(!trialIsVisible())return;
        if("active".equals(verifiedAccount.trialCountdown.status)&&verifiedAccount.trialCountdown.remainingMillis(android.os.SystemClock.elapsedRealtime())>0)trialHandler.postDelayed(trialTick,1000);
        trialHandler.postDelayed(trialRefresh,60000);
    }

    private void addAccountActions(LinearLayout parent) {
        Button update=updatePanel.addTo(parent,sizing.contentWidth()-8);markFocus(update,"account:update");
        Button logout=addLocalLogout(parent);update.setNextFocusDownId(logout.getId());logout.setNextFocusUpId(update.getId());linkContent(logout);
        Button packages=TvUi.button(this,"Paketleri gör",this::showPackages);markFocus(packages,"account:packages");parent.addView(packages,TvUi.space(this,Math.min(230,sizing.contentWidth()-8),48));logout.setNextFocusDownId(packages.getId());packages.setNextFocusUpId(logout.getId());
    }
    private Button addLocalLogout(LinearLayout parent) {
        Button logout=TvUi.button(this,"Oturumu kapat",this::confirmLogout);markFocus(logout,"account:logout");parent.addView(logout,TvUi.space(this,Math.min(230,sizing.contentWidth()-8),48));return logout;
    }
    private void confirmLogout() {
        AlertDialog confirmation=new AlertDialog.Builder(this).setTitle("Oturum kapatılsın mı?").setMessage("Bu cihazda tekrar giriş yapmak için hesap kodunuz gerekir.")
            .setNegativeButton("Vazgeç",null).setPositiveButton("Oturumu kapat",(d,w)->{analytics.event("logout");sessionEnded("");}).create();
        dialog=confirmation;afterOrdinaryDialog(confirmation);confirmation.setOnShowListener(d->confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());confirmation.show();
    }
    private String safeMessage(String message) { return message==null || message.trim().isEmpty()?"İşlem tamamlanamadı. Lütfen tekrar deneyin.":message; }
    private void recordSearch(Catalog catalog,String category,String query){Map<String,Object> values=TvAnalytics.values("query_length",query.trim().length());values.put("result_count",CatalogFilterData.preview(catalog,category,query).count);analytics.event("search",values);}
    private void showFailure(String message,Runnable retry) {
        int headingCount=page.section==Section.HOME?0:1;
        while(body.getChildCount()>headingCount)body.removeViewAt(headingCount);
        LinearLayout inner=scrollContent();
        TextView text=TvUi.text(this,safeMessage(message),20,TvUi.MUTED);inner.addView(text,TvUi.space(this,-1,-2));
        if(page.section==Section.ACCOUNT)addAccountActions(inner);
        Button button=TvUi.button(this,"Tekrar dene",retry);markFocus(button,"content:retry");inner.addView(button,TvUi.space(this,Math.min(220,sizing.contentWidth()-8),48));
        if(page.section==Section.ACCOUNT){
            View logout=findFocus(inner,"account:logout"),packages=findFocus(inner,"account:packages");
            if(logout!=null && packages!=null){inner.removeView(packages);inner.addView(packages);logout.setNextFocusDownId(button.getId());button.setNextFocusUpId(logout.getId());button.setNextFocusDownId(packages.getId());packages.setNextFocusUpId(button.getId());}
        }
        if(page.section!=Section.ACCOUNT)linkContent(button);restoreResizeFocus(true);startup.ready();
    }
    private void afterOrdinaryDialog(Dialog shown) {
        shown.setOnDismissListener(d->{
            if(dialog==shown)dialog=null;
            findViewById(android.R.id.content).post(()->{if(!stopped && !destroyed && !isFinishing())applyPendingCatalogs(true);});
        });
    }
    private void notice(String message) { dialog=new AlertDialog.Builder(this).setMessage(message).setPositiveButton("Tamam",null).create();afterOrdinaryDialog(dialog);dialog.show(); }
    @Override public void onBackPressed() {
        if(repository.hasSession() && welcomeBlocked()){finish();return;}
        if(startup!=null && startup.isShowing()){finish();return;}
        if(body==null) { super.onBackPressed();return; }
        if(!page.query.isEmpty() || !page.category.isEmpty()) { page.query="";page.category="";page.categoryTitle="Tümü";page.scroll=0;page.focusKey="";showPage(false,true);return; }
        View focus=getCurrentFocus();boolean inRail=false;for(Button b:rail)if(focus==b)inRail=true;
        if(!inRail) { rail[page.section.ordinal()].requestFocus();return; }
        if(page.section!=Section.HOME) { navigate(Section.HOME);return; }
        AlertDialog confirmation=new AlertDialog.Builder(this).setTitle("Flixify'dan çıkılsın mı?").setNegativeButton("Vazgeç",null).setPositiveButton("Çık",(d,w)->finish()).create();dialog=confirmation;afterOrdinaryDialog(confirmation);confirmation.setOnShowListener(d->confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());confirmation.show();
    }
}
