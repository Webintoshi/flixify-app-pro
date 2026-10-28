package vip.flixify.tv;

import android.app.Dialog;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.view.inputmethod.EditorInfo;
import android.content.Intent;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Checkable;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;

/** Native panels and real remote navigation with entirely offline account/catalogue fixtures. */
@RunWith(AndroidJUnit4.class)
public class CatalogPanelsTest {
    final FakeTvRepository repository=new FakeTvRepository();
    @Before public void setup(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{repository.session=true;TvApplication.setRepositoryForTests(repository);AccessibilityServiceInfo info=InstrumentationRegistry.getInstrumentation().getUiAutomation().getServiceInfo();info.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;InstrumentationRegistry.getInstrumentation().getUiAutomation().setServiceInfo(info);});}
    @After public void teardown(){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->TvApplication.setRepositoryForTests(null));}
    ActivityScenario<MainActivity> launch(){return ActivityScenario.launch(new Intent(ApplicationProvider.getApplicationContext(),MainActivity.class));}
    void key(int code){InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(code);InstrumentationRegistry.getInstrumentation().waitForIdleSync();}
    Dialog panel(MainActivity activity){try{Field f=MainActivity.class.getDeclaredField("catalogDialog");f.setAccessible(true);return (Dialog)f.get(activity);}catch(Exception e){throw new AssertionError(e);}}
    View tag(MainActivity a,String value){Dialog d=panel(a);return d==null?null:d.findViewById(android.R.id.content).findViewWithTag(value);}
    View text(View v,String value){if(!v.isShown())return null;if(v instanceof TextView && value.contentEquals(((TextView)v).getText()))return v;if(v instanceof ViewGroup)for(int n=0;n<((ViewGroup)v).getChildCount();n++){View r=text(((ViewGroup)v).getChildAt(n),value);if(r!=null)return r;}return null;}
    interface Check{boolean ok(MainActivity a);}
    void await(ActivityScenario<MainActivity> s,String reason,Check check){long end=SystemClock.uptimeMillis()+4000;AtomicBoolean result=new AtomicBoolean();do{s.onActivity(a->result.set(check.ok(a)));if(result.get())return;SystemClock.sleep(30);}while(SystemClock.uptimeMillis()<end);fail(reason);}
    void openSearch(ActivityScenario<MainActivity> s){key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_CENTER);await(s,"Native search input focus",a->tag(a,"tv_search_input")!=null && tag(a,"tv_search_input").hasFocus());}
    void openCategories(ActivityScenario<MainActivity> s){key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_CENTER);await(s,"Native category list focus",a->tag(a,"tv_categories_list")!=null && tag(a,"tv_categories_list").hasFocus());}
    void draft(ActivityScenario<MainActivity> s,String tag,String value){s.onActivity(a->((EditText)tag(a,tag)).setText(value));}
    void applySearch(ActivityScenario<MainActivity> s){key(KeyEvent.KEYCODE_DPAD_DOWN);s.onActivity(a->assertTrue(tag(a,"tv_search_apply").hasFocus()));key(KeyEvent.KEYCODE_DPAD_CENTER);}
    @Test public void searchPreviewIsDraftUntilApplyAndCancelRestoresOpener(){
        try(ActivityScenario<MainActivity> s=launch()){
            openSearch(s);draft(s,"tv_search_input","Deniz");
            await(s,"Live local preview",a->text(tag(a,"tv_search_preview"),"1 sonuç")!=null);
            s.onActivity(a->{assertNotNull(text(a.findViewById(android.R.id.content),repository.movie.title));assertNotNull(text(a.findViewById(android.R.id.content),repository.movie2.title));});
            key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_LEFT);key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(s,"Cancel returns to Ara",a->panel(a)==null && a.hasWindowFocus() && a.getCurrentFocus() instanceof TextView && "Ara".contentEquals(((TextView)a.getCurrentFocus()).getText()));
            key(KeyEvent.KEYCODE_DPAD_CENTER);await(s,"Reopened search",a->tag(a,"tv_search_input")!=null);
            s.onActivity(a->assertEquals("",((EditText)tag(a,"tv_search_input")).getText().toString()));
            draft(s,"tv_search_input","Deniz");applySearch(s);
            await(s,"Committed search",a->text(a.findViewById(android.R.id.content),"Arama: Deniz · 1 sonuç")!=null);
            s.onActivity(a->assertNull("Home hero must respect search too",text(a.findViewById(android.R.id.content),repository.movie.title)));
            key(KeyEvent.KEYCODE_BACK);await(s,"Back restores catalogue",a->text(a.findViewById(android.R.id.content),repository.movie.title)!=null);
        }
    }
    @Test public void categoriesHaveCountsSelectedMarkerAndLocalFinder(){
        try(ActivityScenario<MainActivity> s=launch()){
            openCategories(s);
            s.onActivity(a->{ListView list=(ListView)tag(a,"tv_categories_list");assertEquals(3,list.getAdapter().getCount());View selected=list.getSelectedView();assertTrue(selected instanceof Checkable && ((Checkable)selected).isChecked());assertTrue(selected.getContentDescription().toString().contains("2 içerik"));});
            key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(s,"Drama commits",a->text(a.findViewById(android.R.id.content),"Kategori: Drama")!=null);
            key(KeyEvent.KEYCODE_DPAD_UP);key(KeyEvent.KEYCODE_DPAD_RIGHT);key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(s,"Selected Drama stays checked",a->{ListView list=(ListView)tag(a,"tv_categories_list");return list!=null && list.getSelectedView()!=null && "tv_category_2".equals(list.getSelectedView().getTag()) && ((Checkable)list.getSelectedView()).isChecked();});
            key(KeyEvent.KEYCODE_DPAD_LEFT);draft(s,"tv_categories_filter","Bilim");
            await(s,"Category filtering stays local",a->((ListView)tag(a,"tv_categories_list")).getAdapter().getCount()==1);
            s.onActivity(a->assertNotNull(text(a.findViewById(android.R.id.content),"Kategori: Drama")));
            key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(s,"Filtered category commits by ID",a->text(a.findViewById(android.R.id.content),"Kategori: Bilim Kurgu")!=null);
        }
    }
    @Test public void searchEditorAndDraftSurviveUnderlyingResizeThenSubmit(){
        try(ActivityScenario<MainActivity> s=launch()){
            openSearch(s);draft(s,"tv_search_input","Deniz");final View[] original={null};
            s.onActivity(a->{original[0]=tag(a,"tv_search_input");ViewGroup root=a.findViewById(android.R.id.content);ViewGroup.LayoutParams p=root.getLayoutParams();p.width=TvUi.dp(a,560);p.height=TvUi.dp(a,320);root.setLayoutParams(p);});
            await(s,"Measured resize",a->a.findViewById(android.R.id.content).getWidth()==TvUi.dp(a,560));
            s.onActivity(a->{assertSame(original[0],tag(a,"tv_search_input"));assertEquals("Deniz",((EditText)original[0]).getText().toString());Rect visible=new Rect();View apply=tag(a,"tv_search_apply");assertTrue(apply.getGlobalVisibleRect(visible));assertEquals("Apply fits without scrolling in a short window",apply.getHeight(),visible.height());});
            applySearch(s);await(s,"Draft accepted after resize",a->text(a.findViewById(android.R.id.content),"Arama: Deniz · 1 sonuç")!=null);
        }
    }
    boolean imeVisible(){for(AccessibilityWindowInfo w:InstrumentationRegistry.getInstrumentation().getUiAutomation().getWindows())if(w.getType()==AccessibilityWindowInfo.TYPE_INPUT_METHOD)return true;return false;}
    @Test public void categoryFinderKeepsEditorVisibleAndDoneReturnsToList(){
        try(ActivityScenario<MainActivity> s=launch()){
            openCategories(s);key(KeyEvent.KEYCODE_DPAD_LEFT);key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(s,"Native category keyboard visible",a->imeVisible());
            final View[] original={null};
            s.onActivity(a->{original[0]=tag(a,"tv_categories_filter");Rect visible=new Rect();assertTrue("Category editor remains visible with the TV keyboard",original[0].getGlobalVisibleRect(visible));assertTrue("Category editor fully fits while typing; visible="+visible+", size="+original[0].getWidth()+"x"+original[0].getHeight(),visible.height()>=original[0].getHeight()-2);});
            draft(s,"tv_categories_filter","Drama");
            s.onActivity(a->((EditText)original[0]).onEditorAction(EditorInfo.IME_ACTION_DONE));
            await(s,"Done dismisses keyboard and focuses matching category",a->!imeVisible() && tag(a,"tv_categories_list")!=null && tag(a,"tv_categories_list").hasFocus());
            s.onActivity(a->{assertSame(original[0],tag(a,"tv_categories_filter"));assertEquals(1,((ListView)tag(a,"tv_categories_list")).getAdapter().getCount());});
            key(KeyEvent.KEYCODE_DPAD_CENTER);await(s,"Category chosen after keyboard",a->text(a.findViewById(android.R.id.content),"Kategori: Drama")!=null);
        }
    }
    @Test public void changedSourceCannotApplyOldDialogDraft(){
        AtomicReference<String> scope=new AtomicReference<>(repository.scope);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->TvApplication.setRepositoryForTests((TvRepository)Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->method.getName().equals("currentScope")?scope.get():method.invoke(repository,args))));
        try(ActivityScenario<MainActivity> s=launch()){
            openSearch(s);draft(s,"tv_search_input","Deniz");scope.set("replacement-scope");applySearch(s);
            await(s,"Stale dialog closes",a->panel(a)==null);
            s.onActivity(a->assertNull(text(a.findViewById(android.R.id.content),"Arama: Deniz · 1 sonuç")));
        }
    }
    @Test public void hundredsOfCategoriesStayVirtualizedAndFinderReachesLastId(){
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->TvApplication.setRepositoryForTests((TvRepository)Proxy.newProxyInstance(TvRepository.class.getClassLoader(),new Class<?>[]{TvRepository.class},(proxy,method,args)->{
            if(method.getName().equals("catalog")){
                List<Item> items=new ArrayList<>();List<Category> categories=new ArrayList<>();
                for(int n=0;n<600;n++){String title="Kategori "+n+" · Uzun kategori açıklaması ve içerikler";categories.add(new Category("c"+n,title));items.add(new Item(Kind.MOVIE,""+n,"Film "+n,"c"+n,title,"","mp4",repository.scope,"",0,0,""));}
                ((TvRepository.Callback<Catalog>)args[2]).onResult(new Catalog(Kind.MOVIE,items,categories));return null;
            }return method.invoke(repository,args);
        })));
        try(ActivityScenario<MainActivity> s=launch()){
            openCategories(s);s.onActivity(a->{ListView list=(ListView)tag(a,"tv_categories_list");assertEquals(601,list.getAdapter().getCount());assertTrue(list.getChildCount()<20);});
            for(int n=0;n<20;n++)key(KeyEvent.KEYCODE_DPAD_DOWN);
            s.onActivity(a->{ListView list=(ListView)tag(a,"tv_categories_list");assertEquals(20,list.getSelectedItemPosition());assertTrue(list.getChildCount()<20);});
            key(KeyEvent.KEYCODE_DPAD_LEFT);draft(s,"tv_categories_filter","599");key(KeyEvent.KEYCODE_DPAD_DOWN);key(KeyEvent.KEYCODE_DPAD_CENTER);
            await(s,"Last category selected",a->text(a.findViewById(android.R.id.content),"Kategori: Kategori 599 · Uzun kategori açıklaması ve içerikler")!=null);
        }
    }
}
