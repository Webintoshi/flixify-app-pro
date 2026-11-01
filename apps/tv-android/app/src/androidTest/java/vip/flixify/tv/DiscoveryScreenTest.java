package vip.flixify.tv;

import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.recyclerview.widget.RecyclerView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.util.*;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DiscoveryScreenTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private FakeTvRepository repository;
    private MainActivity activity;
    private PlayerActivity player;
    private static final String ARTWORK="https://fixture.invalid/discovery-poster.png";
    @Before public void setup()throws Exception{
        repository=new FakeTvRepository();repository.session=true;
        ArtworkDiskCache cache=new ArtworkDiskCache(new File(instrumentation.getTargetContext().getCacheDir(),"artwork-v1"));
        Bitmap logo=BitmapFactory.decodeResource(instrumentation.getTargetContext().getResources(),R.drawable.flixify_logo);ByteArrayOutputStream bytes=new ByteArrayOutputStream();assertTrue(logo.compress(Bitmap.CompressFormat.PNG,100,bytes));assertTrue(cache.write(repository.scope,ARTWORK,bytes.toByteArray(),()->true));
        for(String filename:new String[]{"movie-0.jpg","movie-1.jpg","movie-2.jpg","series.jpg","series-boroughs.jpg","series-mahsun.jpg"}){
            try(java.io.InputStream input=instrumentation.getContext().getAssets().open("discovery/"+filename)){
                ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)data.write(buffer,0,n);
                assertTrue(cache.write(repository.scope,"https://fixture.invalid/discovery/"+filename,data.toByteArray(),()->true));
            }
        }
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(repository));
    }
    @After public void cleanup(){if(player!=null)instrumentation.runOnMainSync(()->player.finish());if(activity!=null)instrumentation.runOnMainSync(()->activity.finish());instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(null));}
    private Item item(Kind kind,String id,String title,String group){return new Item(kind,id,title,group,group,kind==Kind.LIVE?ARTWORK:"https://fixture.invalid/discovery/"+(kind==Kind.SERIES?(id.equals("202")?"series-boroughs.jpg":id.equals("203")?"series-mahsun.jpg":"series.jpg"):(id.equals("103")?"movie-0.jpg":id.equals("8001")?"movie-1.jpg":"movie-"+Math.floorMod(id.hashCode(),3)+".jpg")),"mp4",repository.scope,"",0,0,"Çevrimdışı içerik açıklaması");}
    private void catalog(Kind kind,Item...items){repository.catalogOverrides.put(kind,new Catalog(kind,Arrays.asList(items),Collections.emptyList()));}
    private void launch(){activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));instrumentation.waitForIdleSync();}
    private void key(int value){instrumentation.sendKeyDownUpSync(value);instrumentation.waitForIdleSync();}
    private View tagged(String tag){return activity.getWindow().getDecorView().findViewWithTag(tag);}
    private View text(View root,String label){if(root instanceof TextView && label.equals(((TextView)root).getText().toString()))return root;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){View found=text(((ViewGroup)root).getChildAt(n),label);if(found!=null)return found;}return null;}
    private void navigate(String label){instrumentation.runOnMainSync(()->{View target=text(activity.getWindow().getDecorView(),label);assertNotNull(target);target.performClick();});instrumentation.waitForIdleSync();}
    private void capture(String name)throws Exception{File directory=instrumentation.getTargetContext().getExternalFilesDir(null);assertNotNull(directory);Bitmap bitmap=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(bitmap);try(FileOutputStream out=new FileOutputStream(new File(directory,name+".png"))){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));}}
    private void shelf(int position,String title){instrumentation.runOnMainSync(()->((DiscoveryScreen)tagged("tv-discovery")).scrollToPosition(position));instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->assertNotNull("Visible shelf: "+title,text(tagged("tv-discovery"),title)));}
    @Test public void homeUsesMovieAndSeriesCatalogsAndKeepsOlderTitlesSearchable()throws Exception{
        catalog(Kind.MOVIE,item(Kind.MOVIE,"100","Fısıltı Adam (2026)","Aksiyon"),item(Kind.MOVIE,"103","Telaşlı Baba (2026)","Dram"),item(Kind.MOVIE,"104","Örümcek-Adam: Yepyeni Bir Gün (2026)","Macera"),repository.movie);
        catalog(Kind.SERIES,item(Kind.SERIES,"200","The East Palace (2026)","Macera"),item(Kind.SERIES,"202","The Boroughs (2026)","Dram"),item(Kind.SERIES,"203","Mahsun J - Yılbaşı Özel (2026)","Macera"));catalog(Kind.LIVE,repository.live);launch();
        long deadline=SystemClock.uptimeMillis()+3000;boolean[] firstPosterReady={false};String[] geometry={"No first shelf layout"};
        do{
            instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->{
                View hero=tagged("tv-discovery-hero"),rail=tagged("tv-rail-home-movies");android.widget.ImageView poster=firstImage(rail);Rect heroRect=new Rect(),posterRect=new Rect();
                firstPosterReady[0]=hero!=null && poster!=null && poster.getWidth()>0 && poster.getHeight()>0 && hero.getGlobalVisibleRect(heroRect) && poster.getGlobalVisibleRect(posterRect) && posterRect.height()>=TvUi.dp(activity,24) && posterRect.top>=heroRect.bottom;
                geometry[0]="hero="+heroRect+", poster="+posterRect+", posterSize="+(poster==null?"missing":poster.getWidth()+"x"+poster.getHeight());
            });if(!firstPosterReady[0])SystemClock.sleep(25);
        }while(!firstPosterReady[0] && SystemClock.uptimeMillis()<deadline);
        assertTrue("Initial first-shelf artwork becomes visible after nested layout; "+geometry[0],firstPosterReady[0]);
        instrumentation.runOnMainSync(()->{
            assertNotNull(tagged("tv-discovery"));assertNotNull(tagged("tv-discovery-hero"));
            assertNotNull(tagged("tv-home-hero-play"));assertNotNull(tagged("tv-home-hero-info"));assertNotNull(tagged("tv-home-hero-favorite"));
            assertTrue("Home acquires each full catalog",repository.catalogRequests>=3);
            assertTrue(text(tagged("tv-discovery-hero"),"2026 · Film")!=null || text(tagged("tv-discovery-hero"),"2026 · Dizi")!=null);
            View hero=tagged("tv-discovery-hero");assertTrue("Hero leaves room for discovery artwork",hero.getHeight()<=TvUi.dp(activity,250));
            View firstRail=tagged("tv-rail-home-movies");assertNotNull("First 2026 shelf is attached below the hero",firstRail);android.widget.ImageView firstPoster=firstImage(firstRail);assertNotNull(firstPoster);Rect posterRect=new Rect(),heroRect=new Rect();assertTrue(hero.getGlobalVisibleRect(heroRect));assertTrue("First shelf poster is visible in the initial viewport",firstPoster.getGlobalVisibleRect(posterRect));assertTrue("The first shelf shows actual poster area",posterRect.height()>=TvUi.dp(activity,24));assertTrue(posterRect.top>=heroRect.bottom);
            assertNull("Hero supplies the Home heading",text(activity.getWindow().getDecorView(),"Sizin için"));
        });capture("discovery-home-2026");
        shelf(1,"2026 Filmleri");shelf(2,"2026 Dizileri");shelf(3,"Canlı TV");
        navigate("Ara");instrumentation.runOnMainSync(()->{try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("page");field.setAccessible(true);Object page=field.get(activity);java.lang.reflect.Field catalog=page.getClass().getDeclaredField("catalog");catalog.setAccessible(true);assertTrue(((Catalog)catalog.get(page)).items.stream().anyMatch(item->item.key().equals(repository.movie.key())));}catch(ReflectiveOperationException error){throw new AssertionError(error);}});
    }
    @Test public void moviesKeepAllCollectionsAndVirtualizeTheFullArchive()throws Exception{
        List<Item> rows=new ArrayList<>();for(int n=0;n<2500;n++)rows.add(item(Kind.MOVIE,String.valueOf(1000+n),"Arşiv "+n,"Dram"));
        rows.add(item(Kind.MOVIE,"8001","Fısıltı Adam (2026)","Aksiyon"));rows.add(item(Kind.MOVIE,"8002","Thor (2011)","Aksiyon"));rows.add(item(Kind.MOVIE,"8003","Harry Potter (2001)","Fantastik"));
        repository.catalogOverrides.put(Kind.MOVIE,new Catalog(Kind.MOVIE,rows,Collections.emptyList()));launch();navigate("Filmler");capture("discovery-movie-curated-overview");
        shelf(1,"2026 Filmleri");shelf(2,"Çok İzlenenler · Marvel");shelf(3,"Aksiyon Filmleri");shelf(4,"Fantastik Filmler");
        instrumentation.runOnMainSync(()->{DiscoveryScreen screen=(DiscoveryScreen)tagged("tv-discovery");assertTrue(screen.getAdapter().getItemCount()>2500);assertTrue("Archive creates only visible holders",screen.getChildCount()<35);screen.scrollToPosition(screen.getAdapter().getItemCount()-1);});instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(()->{DiscoveryScreen screen=(DiscoveryScreen)tagged("tv-discovery");assertTrue(screen.getChildCount()<35);assertTrue(screen.focusItem("MOVIE:3499"));});instrumentation.waitForIdleSync();capture("discovery-movie-archive");
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,false);
        try{key(KeyEvent.KEYCODE_DPAD_CENTER);player=(PlayerActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull("Archive opens the chosen player",player);assertEquals("MOVIE:3499",((Item)player.getIntent().getSerializableExtra(PlayerActivity.EXTRA_ITEM)).key());instrumentation.runOnMainSync(()->player.finish());player=null;instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->assertEquals("MOVIE:3499",activity.getCurrentFocus().getTag()));}finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void heroInformationAndFavoriteNeverLaunchPlayback()throws Exception{
        catalog(Kind.MOVIE,item(Kind.MOVIE,"100","Fısıltı Adam (2026)","Aksiyon"));launch();
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,true);
        try{
            key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_DOWN);awaitFocusedTag("tv-home-hero-play");
            key(KeyEvent.KEYCODE_DPAD_RIGHT);awaitFocusedTag("tv-home-hero-info");key(KeyEvent.KEYCODE_DPAD_RIGHT);awaitFocusedTag("tv-home-hero-favorite");
            key(KeyEvent.KEYCODE_DPAD_CENTER);assertTrue(repository.saved.contains("MOVIE:100"));assertEquals(0,monitor.getHits());
            key(KeyEvent.KEYCODE_DPAD_LEFT);awaitFocusedTag("tv-home-hero-info");key(KeyEvent.KEYCODE_DPAD_CENTER);
            long deadline=SystemClock.uptimeMillis()+3000;boolean[] dialogReady={false};
            do{
                instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->{
                    try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("dialog");field.setAccessible(true);android.app.Dialog shown=(android.app.Dialog)field.get(activity);View focus=shown==null?null:shown.getCurrentFocus();dialogReady[0]=shown!=null && shown.isShowing() && shown.getWindow()!=null && shown.getWindow().getDecorView().hasWindowFocus() && focus instanceof TextView && "Kapat".equalsIgnoreCase(((TextView)focus).getText().toString());}catch(ReflectiveOperationException error){throw new AssertionError(error);}
                });if(!dialogReady[0])SystemClock.sleep(30);
            }while(!dialogReady[0] && SystemClock.uptimeMillis()<deadline);
            assertTrue("Information opens with its safe close action focused",dialogReady[0]);assertEquals(0,monitor.getHits());key(KeyEvent.KEYCODE_BACK);
            deadline=SystemClock.uptimeMillis()+3000;boolean[] returned={false};
            do{instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->returned[0]=activity.hasWindowFocus() && activity.getCurrentFocus()==tagged("tv-home-hero-info"));if(!returned[0])SystemClock.sleep(30);}while(!returned[0] && SystemClock.uptimeMillis()<deadline);
            assertTrue("Back restores the actual remote information opener",returned[0]);
            instrumentation.runOnMainSync(()->{assertNotNull(tagged("tv-discovery"));assertEquals("tv-home-hero-info",activity.getCurrentFocus().getTag());});assertEquals(0,monitor.getHits());capture("discovery-hero-actions");
        }finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void resizedShortWindowKeepsHeroAndScrollsFocusedActionsIntoView()throws Exception{
        catalog(Kind.MOVIE,item(Kind.MOVIE,"100","Fısıltı Adam (2026)","Aksiyon"));launch();
        instrumentation.runOnMainSync(()->{View content=activity.findViewById(android.R.id.content);ViewGroup.LayoutParams params=content.getLayoutParams();params.width=TvUi.dp(activity,560);params.height=TvUi.dp(activity,320);content.setLayoutParams(params);});
        long end=SystemClock.uptimeMillis()+3000;boolean[] ready={false};
        do{instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->ready[0]=activity.findViewById(android.R.id.content).getWidth()==TvUi.dp(activity,560) && tagged("tv-discovery-hero")!=null);if(!ready[0])SystemClock.sleep(30);}while(!ready[0] && SystemClock.uptimeMillis()<end);
        assertTrue("Resized catalogue retains the 2026 hero",ready[0]);
        instrumentation.runOnMainSync(()->assertTrue(tagged("tv-home-hero-play").requestFocus()));instrumentation.waitForIdleSync();
        instrumentation.runOnMainSync(()->{View play=tagged("tv-home-hero-play");Rect rect=new Rect();assertTrue(play.getGlobalVisibleRect(rect));assertEquals("Focused play action fits the short viewport",play.getHeight(),rect.height());});capture("discovery-short-window");
    }
    @Test public void delayedHomeKindsFinishWhileAwayAndRemainAvailableOnReturn(){
        catalog(Kind.MOVIE,item(Kind.MOVIE,"100","Fısıltı Adam (2026)","Aksiyon"),item(Kind.MOVIE,"103","İkinci Film (2026)","Dram"));
        catalog(Kind.SERIES,item(Kind.SERIES,"200","The East Palace (2026)","Macera"),item(Kind.SERIES,"202","The Boroughs (2026)","Dram"));catalog(Kind.LIVE,repository.live);
        Map<Kind,TvRepository.Callback<Catalog>> callbacks=new EnumMap<>(Kind.class);int[] requests={0};
        TvRepository delayed=(TvRepository)java.lang.reflect.Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
            if(method.getName().equals("catalog") || method.getName().equals("homeCatalog")){requests[0]++;callbacks.put((Kind)args[0],(TvRepository.Callback<Catalog>)args[2]);return null;}
            return method.invoke(repository,args);
        });
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(delayed));launch();
        instrumentation.runOnMainSync(()->callbacks.get(Kind.MOVIE).onResult(repository.catalogOverrides.get(Kind.MOVIE)));instrumentation.waitForIdleSync();navigate("Hesabım");
        instrumentation.runOnMainSync(()->{callbacks.get(Kind.SERIES).onResult(repository.catalogOverrides.get(Kind.SERIES));callbacks.get(Kind.LIVE).onResult(repository.catalogOverrides.get(Kind.LIVE));assertNotNull(text(activity.getWindow().getDecorView(),"Test Paketi"));assertNull(tagged("tv-discovery"));});
        navigate("Ana Sayfa");assertEquals("Completed scoped Home sources are retained while another page is visible",3,requests[0]);
        shelf(1,"2026 Filmleri");shelf(2,"2026 Dizileri");shelf(3,"Canlı TV");
    }
    @Test public void memoryPressureReleasesInactiveHomeSourcesAndReacquiresThemOnReturn(){
        launch();
        instrumentation.runOnMainSync(()->{try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("homeSources");field.setAccessible(true);assertEquals(3,((Map<?,?>)field.get(activity)).size());}catch(ReflectiveOperationException error){throw new AssertionError(error);}});
        navigate("Canlı TV");
        instrumentation.runOnMainSync(()->{
            activity.onTrimMemory(android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW);
            assertEquals(Kind.LIVE,repository.retainedOnTrim);assertNotNull(tagged(repository.live.key()));
            try{
                java.lang.reflect.Field sources=MainActivity.class.getDeclaredField("homeSources");sources.setAccessible(true);assertTrue("Inactive Home cannot pin full VOD catalogs",((Map<?,?>)sources.get(activity)).isEmpty());
                java.lang.reflect.Field pages=MainActivity.class.getDeclaredField("pages");pages.setAccessible(true);for(Object candidate:((Map<?,?>)pages.get(activity)).values()){
                    java.lang.reflect.Field section=candidate.getClass().getDeclaredField("section");section.setAccessible(true);if("HOME".equals(String.valueOf(section.get(candidate)))){java.lang.reflect.Field catalog=candidate.getClass().getDeclaredField("catalog");catalog.setAccessible(true);assertNull(catalog.get(candidate));}
                }
            }catch(ReflectiveOperationException error){throw new AssertionError(error);}
        });
        int before=repository.catalogRequests;navigate("Ana Sayfa");assertEquals("Returning Home reloads all released kinds",before+3,repository.catalogRequests);
        instrumentation.runOnMainSync(()->{try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("homeSources");field.setAccessible(true);assertEquals(3,((Map<?,?>)field.get(activity)).size());}catch(ReflectiveOperationException error){throw new AssertionError(error);}});
    }
    @Test public void staleInitialHomeFailuresCannotReplaceTheNewSource(){
        Map<Kind,TvRepository.Callback<Catalog>> callbacks=new EnumMap<>(Kind.class);
        TvRepository delayed=(TvRepository)java.lang.reflect.Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
            if(method.getName().equals("catalog") || method.getName().equals("homeCatalog")){callbacks.put((Kind)args[0],(TvRepository.Callback<Catalog>)args[2]);return null;}
            return method.invoke(repository,args);
        });
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(delayed));launch();
        instrumentation.runOnMainSync(()->{
            repository.scope="fixture-account:replacement-source";
            for(TvRepository.Callback<Catalog> callback:callbacks.values())callback.onError(new Failure(Failure.Code.STALE,"Eski kaynak sonucu"));
            assertNull(text(activity.getWindow().getDecorView(),"Eski kaynak sonucu"));assertNotNull(text(activity.getWindow().getDecorView(),"Yükleniyor…"));
            for(Kind kind:new Kind[]{Kind.MOVIE,Kind.SERIES,Kind.LIVE}){
                Item fresh=new Item(kind,kind==Kind.MOVIE?"800":kind==Kind.SERIES?"801":"802",kind==Kind.MOVIE?"Yeni Kaynak Filmi (2026)":kind==Kind.SERIES?"Yeni Kaynak Dizisi (2026)":"Yeni Kaynak TV","1","Genel","","mp4",repository.scope,"",0,0,"");
                repository.publishCatalog(new Catalog(kind,Collections.singletonList(fresh),Collections.emptyList()));
            }
        });instrumentation.waitForIdleSync();
        shelf(1,"2026 Filmleri");shelf(2,"2026 Dizileri");shelf(3,"Canlı TV");
        instrumentation.runOnMainSync(()->assertNull(text(activity.getWindow().getDecorView(),"Eski kaynak sonucu")));
    }
    @Test public void upFromSecondArchiveColumnReturnsToPreviousShelf(){
        catalog(Kind.MOVIE,item(Kind.MOVIE,"100","Fısıltı Adam (2026)","Aksiyon"),item(Kind.MOVIE,"101","Thor (2011)","Aksiyon"),item(Kind.MOVIE,"102","Harry Potter (2001)","Fantastik"));launch();navigate("Filmler");
        instrumentation.runOnMainSync(()->assertTrue(((DiscoveryScreen)tagged("tv-discovery")).focusItem("MOVIE:101")));awaitFocusedTag("MOVIE:101");
        key(KeyEvent.KEYCODE_DPAD_UP);awaitFocusedTag("MOVIE:102");
        instrumentation.runOnMainSync(()->{View parent=(View)activity.getCurrentFocus().getParent();assertTrue("UP exits the archive grid toward the fantasy shelf",parent!=tagged("tv-discovery"));assertNotNull(text(activity.getWindow().getDecorView(),"Fantastik Filmler"));});
    }
    @Test public void lateSeriesCannotRetargetTheFocusedHeroPlayAction(){
        Item movie=item(Kind.MOVIE,"100","Seçili Film (2026)","Aksiyon");Item replacement=null;
        for(int id=200;id<1000;id++){
            Item candidate=item(Kind.SERIES,String.valueOf(id),"Yeni Dizi "+id+" (2026)","Macera");
            if(!CatalogShowcase.home(Arrays.asList(movie,candidate),CatalogShowcase.dayKey()).hero.get(0).key().equals(movie.key())){replacement=candidate;break;}
        }
        assertNotNull("Fixture enrichment would replace the unpinned hero",replacement);Item series=replacement;catalog(Kind.MOVIE,movie);catalog(Kind.SERIES,series);
        java.util.concurrent.atomic.AtomicReference<TvRepository.Callback<Catalog>> pendingSeries=new java.util.concurrent.atomic.AtomicReference<>();
        TvRepository delayed=(TvRepository)java.lang.reflect.Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
            if((method.getName().equals("catalog") || method.getName().equals("homeCatalog")) && args[0]==Kind.SERIES){pendingSeries.set((TvRepository.Callback<Catalog>)args[2]);return null;}
            return method.invoke(repository,args);
        });
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(delayed));launch();
        instrumentation.runOnMainSync(()->assertTrue(tagged("tv-home-hero-play").requestFocus()));awaitFocusedTag("tv-home-hero-play");
        instrumentation.runOnMainSync(()->pendingSeries.get().onResult(repository.catalogOverrides.get(Kind.SERIES)));awaitFocusedTag("tv-home-hero-play");
        instrumentation.runOnMainSync(()->assertNotNull("Focused hero keeps its selected film",text(tagged("tv-discovery-hero"),"Seçili Film")));
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(PlayerActivity.class.getName(),null,false);
        try{key(KeyEvent.KEYCODE_DPAD_CENTER);player=(PlayerActivity)monitor.waitForActivityWithTimeout(5000);assertNotNull(player);assertEquals("One OK still plays the film the user focused",movie.key(),((Item)player.getIntent().getSerializableExtra(PlayerActivity.EXTRA_ITEM)).key());instrumentation.runOnMainSync(()->player.finish());player=null;instrumentation.waitForIdleSync();}finally{instrumentation.removeMonitor(monitor);}
    }
    @Test public void stopAfterPartialHomeRestartsOnlyMissingKinds(){
        Map<Kind,List<TvRepository.Callback<Catalog>>> callbacks=new EnumMap<>(Kind.class);int[] requests={0};
        TvRepository delayed=(TvRepository)java.lang.reflect.Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
            if(method.getName().equals("catalog") || method.getName().equals("homeCatalog")){requests[0]++;Kind kind=(Kind)args[0];if(!callbacks.containsKey(kind))callbacks.put(kind,new ArrayList<>());callbacks.get(kind).add((TvRepository.Callback<Catalog>)args[2]);return null;}
            return method.invoke(repository,args);
        });
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(delayed));
        try(androidx.test.core.app.ActivityScenario<MainActivity> scenario=androidx.test.core.app.ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(value->activity=value);
            scenario.onActivity(value->callbacks.get(Kind.MOVIE).get(0).onResult(new Catalog(Kind.MOVIE,Collections.singletonList(repository.movie),Collections.emptyList())));instrumentation.waitForIdleSync();
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);instrumentation.waitForIdleSync();
            assertEquals("Resume requests the two incomplete kinds",5,requests[0]);assertEquals(1,callbacks.get(Kind.MOVIE).size());assertEquals(2,callbacks.get(Kind.SERIES).size());assertEquals(2,callbacks.get(Kind.LIVE).size());
            scenario.onActivity(value->{
                callbacks.get(Kind.SERIES).get(0).onError(new Failure(Failure.Code.STALE,"Eski dizi sonucu"));callbacks.get(Kind.LIVE).get(0).onError(new Failure(Failure.Code.STALE,"Eski canlı sonucu"));
                callbacks.get(Kind.SERIES).get(1).onResult(new Catalog(Kind.SERIES,Collections.singletonList(repository.show),Collections.emptyList()));callbacks.get(Kind.LIVE).get(1).onResult(new Catalog(Kind.LIVE,Collections.singletonList(repository.live),Collections.emptyList()));
                assertNull(text(activity.getWindow().getDecorView(),"Eski dizi sonucu"));assertNull(text(activity.getWindow().getDecorView(),"Eski canlı sonucu"));
                try{java.lang.reflect.Field sources=MainActivity.class.getDeclaredField("homeSources");sources.setAccessible(true);assertEquals(3,((Map<?,?>)sources.get(activity)).size());}catch(ReflectiveOperationException error){throw new AssertionError(error);}
            });
        }finally{activity=null;}
    }
    @Test public void seriesFavoritesAndLiveShowTheirOwnCatalogPresentation()throws Exception{
        Item movie=item(Kind.MOVIE,"100","Fısıltı Adam (2026)","Aksiyon"),series=item(Kind.SERIES,"200","The East Palace (2026)","Macera"),live=item(Kind.LIVE,"401","Örnek TV","Genel");
        catalog(Kind.MOVIE,movie,item(Kind.MOVIE,"103","İkinci Film (2026)","Dram"));catalog(Kind.SERIES,series,item(Kind.SERIES,"202","The Boroughs (2026)","Dram"));catalog(Kind.LIVE,live);repository.saved.add(movie.key());repository.saved.add(series.key());repository.saved.add(live.key());launch();
        navigate("Diziler");instrumentation.runOnMainSync(()->{assertNotNull(tagged("tv-discovery"));assertNotNull(text(activity.getWindow().getDecorView(),"Günün Seçkisi"));});capture("discovery-series-overview");
        navigate("Favoriler");instrumentation.runOnMainSync(()->assertNotNull(tagged("tv-rail-favorites-live")));capture("discovery-favorites-shelves");
        navigate("Canlı TV");instrumentation.runOnMainSync(()->{View card=tagged(live.key());assertNotNull(card);android.widget.ImageView logo=firstImage(card);assertNotNull(logo);assertEquals(android.widget.ImageView.ScaleType.FIT_CENTER,logo.getScaleType());assertNotNull(logo.getBackground());});capture("discovery-live-lineup");
    }
    @Test public void pendingHeroFavoriteKeepsRemoteFocusBlocksDuplicatesAndReleasesStaleAttempt(){
        Item movie=item(Kind.MOVIE,"100","Yeni Film (2026)","Aksiyon");catalog(Kind.MOVIE,movie);int[] writes={0};java.util.concurrent.atomic.AtomicReference<TvRepository.Callback<Boolean>> pending=new java.util.concurrent.atomic.AtomicReference<>();
        TvRepository delayed=(TvRepository)java.lang.reflect.Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
            if(method.getName().equals("toggleFavorite")){writes[0]++;pending.set((TvRepository.Callback<Boolean>)args[1]);return null;}return method.invoke(repository,args);
        });
        instrumentation.runOnMainSync(()->TvApplication.setRepositoryForTests(delayed));launch();key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_DOWN);awaitFocusedTag("tv-home-hero-play");key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_RIGHT);awaitFocusedTag("tv-home-hero-favorite");
        key(KeyEvent.KEYCODE_DPAD_CENTER);awaitFocusedTag("tv-home-hero-favorite");
        instrumentation.runOnMainSync(()->{assertTrue("Busy favorite remains an enabled remote focus target",tagged("tv-home-hero-favorite").isEnabled());tagged("tv-home-hero-favorite").performClick();assertEquals("Direct repeated clicks cannot duplicate a pending favorite write",1,writes[0]);});
        key(KeyEvent.KEYCODE_DPAD_LEFT);awaitFocusedTag("tv-home-hero-info");instrumentation.runOnMainSync(()->repository.toggleFavorite(movie,pending.get()));awaitFocusedTag("tv-home-hero-info");assertTrue(repository.saved.contains(movie.key()));
        key(KeyEvent.KEYCODE_DPAD_RIGHT);awaitFocusedTag("tv-home-hero-favorite");key(KeyEvent.KEYCODE_DPAD_CENTER);assertEquals(2,writes[0]);
        instrumentation.runOnMainSync(()->pending.get().onError(new Failure(Failure.Code.STALE,"Eski favori sonucu")));awaitFocusedTag("tv-home-hero-favorite");
        key(KeyEvent.KEYCODE_DPAD_CENTER);assertEquals("A stale completion releases the scoped pending guard",3,writes[0]);
        key(KeyEvent.KEYCODE_DPAD_LEFT);awaitFocusedTag("tv-home-hero-info");instrumentation.runOnMainSync(()->repository.toggleFavorite(movie,pending.get()));awaitFocusedTag("tv-home-hero-info");assertFalse(repository.saved.contains(movie.key()));
    }
    private android.widget.ImageView firstImage(View root){if(root instanceof android.widget.ImageView)return (android.widget.ImageView)root;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){android.widget.ImageView found=firstImage(((ViewGroup)root).getChildAt(n));if(found!=null)return found;}return null;}
    private void awaitFocusedTag(String wanted){
        long deadline=SystemClock.uptimeMillis()+3000;boolean[] focused={false};
        do{instrumentation.waitForIdleSync();instrumentation.runOnMainSync(()->{View current=activity.getCurrentFocus();focused[0]=current!=null && wanted.equals(current.getTag());});if(!focused[0])SystemClock.sleep(30);}while(!focused[0] && SystemClock.uptimeMillis()<deadline);
        assertTrue("Remote focus: "+wanted,focused[0]);
    }
}
