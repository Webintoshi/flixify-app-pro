package vip.flixify.tv.data;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.lang.reflect.Field;
import org.json.*;
import org.junit.Test;
import vip.flixify.tv.BackgroundWorkGate;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.TvRepository;
import static org.junit.Assert.*;

public class NetworkHomeCatalogTest {
    private static final long NOW=1700000000000L;
    private static String date(long value){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);f.setTimeZone(TimeZone.getTimeZone("UTC"));return f.format(new Date(value));}
    private static final class Preferences implements SharedPreferences {
        final Map<String,Object> values=new ConcurrentHashMap<>();
        public Map<String,?> getAll(){return new HashMap<>(values);}public String getString(String k,String d){return (String)values.getOrDefault(k,d);}
        @SuppressWarnings("unchecked") public Set<String> getStringSet(String k,Set<String>d){return (Set<String>)values.getOrDefault(k,d);}
        public int getInt(String k,int d){return (Integer)values.getOrDefault(k,d);}public long getLong(String k,long d){return (Long)values.getOrDefault(k,d);}
        public float getFloat(String k,float d){return (Float)values.getOrDefault(k,d);}public boolean getBoolean(String k,boolean d){return (Boolean)values.getOrDefault(k,d);}public boolean contains(String k){return values.containsKey(k);}
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){}public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){}
        public Editor edit(){return new Editor(){final Map<String,Object> next=new HashMap<>();final Set<String> removed=new HashSet<>();boolean clear;
            public Editor putString(String k,String v){if(v==null)return remove(k);next.put(k,v);return this;}public Editor putStringSet(String k,Set<String>v){next.put(k,v);return this;}public Editor putInt(String k,int v){next.put(k,v);return this;}public Editor putLong(String k,long v){next.put(k,v);return this;}public Editor putFloat(String k,float v){next.put(k,v);return this;}public Editor putBoolean(String k,boolean v){next.put(k,v);return this;}public Editor remove(String k){removed.add(k);return this;}public Editor clear(){clear=true;return this;}public boolean commit(){if(clear)values.clear();for(String k:removed)values.remove(k);values.putAll(next);return true;}public void apply(){commit();}};}
    }
    private static final class FixtureContext extends ContextWrapper {
        final File root;final Map<String,Preferences> preferences=new ConcurrentHashMap<>();
        FixtureContext()throws IOException{super(null);root=Files.createTempDirectory("flixify-home-catalog-").toFile();}
        @Override public Context getApplicationContext(){return this;}@Override public File getFilesDir(){return root;}
        @Override public SharedPreferences getSharedPreferences(String name,int mode){return preferences.computeIfAbsent(name,k->new Preferences());}
    }
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory {
        volatile String source="source-a",blockedAction="",movieTitle="Movie (2026)";
        final CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1),disconnected=new CountDownLatch(1);
        final Map<String,AtomicInteger> reads=new ConcurrentHashMap<>();final List<String> apiThreads=new CopyOnWriteArrayList<>(),providerThreads=new CopyOnWriteArrayList<>();
        int reads(String name){AtomicInteger count=reads.get(name);return count==null?0:count.get();}
        public HttpURLConnection open(URL url){return new HttpURLConnection(url){
            byte[] response;final String action=action(url);boolean blocked,closed;
            public void connect(){}public boolean usingProxy(){return false;}
            public void disconnect(){closed=true;if(blocked){disconnected.countDown();release.countDown();}}
            private void resolve(){if(response!=null)return;try{
                Object result;String path=url.getPath();reads.computeIfAbsent(action.isEmpty()?path:action,k->new AtomicInteger()).incrementAndGet();
                if(path.equals("/me/provider-session")){apiThreads.add(Thread.currentThread().getName());result=new JSONObject().put("accountId","fixture-account").put("sourceVersion",source).put("providerOrigin","https://provider.test").put("username","fixture-user").put("password","fixture-password").put("expiresAt",date(NOW+600000)).put("moviePolicy","general-audience-only");}
                else if(path.equals("/me")){apiThreads.add(Thread.currentThread().getName());result=new JSONObject().put("user",new JSONObject().put("id","fixture-account").put("status","active").put("hasAssignedLink",true).put("hasActiveSubscription",true).put("activePackage",new JSONObject().put("title","Fixture").put("endsAt",date(NOW+600000))));}
                else if(path.equals("/me/personal-library")){apiThreads.add(Thread.currentThread().getName());result=new JSONObject().put("favorites",new JSONArray()).put("watched",new JSONArray());}
                else if(path.equals("/player_api.php")){
                    providerThreads.add(Thread.currentThread().getName());
                    if(action.endsWith("_categories"))result=new JSONArray().put(new JSONObject().put("category_id","9").put("category_name",action.equals("get_vod_categories")?"Filmler":action.equals("get_series_categories")?"Diziler":"TR: Ulusal"));
                    else if(action.equals("get_vod_streams"))result=new JSONArray().put(new JSONObject().put("stream_id","12").put("name",movieTitle).put("category_id","9").put("container_extension","mp4"));
                    else if(action.equals("get_series"))result=new JSONArray().put(new JSONObject().put("series_id","56").put("name","Series (2026)").put("category_id","9"));
                    else if(action.equals("get_live_streams"))result=new JSONArray().put(new JSONObject().put("stream_id","34").put("name","TR | TRT 1 FHD").put("category_id","9").put("container_extension","ts"));
                    else throw new AssertionError("Unexpected provider action");
                }else throw new AssertionError("Unexpected API path");
                response=result.toString().getBytes(StandardCharsets.UTF_8);
            }catch(Exception error){throw new AssertionError(error);}}
            public int getResponseCode(){resolve();return 200;}public String getHeaderField(String key){resolve();return "Content-Length".equals(key)?String.valueOf(response.length):null;}
            public InputStream getInputStream(){resolve();InputStream bytes=new ByteArrayInputStream(response);if(blockedAction.isEmpty() || !action.equals(blockedAction))return bytes;blocked=true;return new FilterInputStream(bytes){
                @Override public int read(byte[] data,int offset,int length)throws IOException{started.countDown();try{if(!release.await(4,TimeUnit.SECONDS))throw new IOException("Unreleased provider fixture");}catch(InterruptedException error){Thread.currentThread().interrupt();throw new IOException(error);}if(closed)throw new IOException("Disconnected provider fixture");return super.read(data,offset,length);}
            };}
        };}
        private static String action(URL url){String query=url.getQuery();if(query!=null)for(String part:query.split("&"))if(part.startsWith("action="))return part.substring(7);return "";}
    }
    private static final class Result<T> implements TvRepository.Callback<T>{T value;Failure error;int calls;public void onResult(T v){value=v;calls++;}public void onError(Failure f){error=f;calls++;}}
    private static final class Harness implements AutoCloseable {
        final FixtureContext context;final Fixture fixture;final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();final NetworkTvRepository repository;
        Harness()throws Exception{this(new FixtureContext(),new Fixture());}
        Harness(FixtureContext context,Fixture fixture)throws Exception{this.context=context;this.fixture=fixture;repository=new NetworkTvRepository(context,fixture,()->NOW,deliveries::add);Field field=NetworkTvRepository.class.getDeclaredField("tokens");field.setAccessible(true);field.set(repository,new TokenStore.Session("fixture-access","fixture-refresh","fixture-account","1234"));}
        <T> void await(Result<T> result,long millis)throws Exception{long end=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(millis);while(result.calls==0 && System.nanoTime()<end){Runnable next=deliveries.poll(Math.min(50,millis),TimeUnit.MILLISECONDS);if(next!=null)next.run();}assertEquals("Repository callback must complete once within the bound",1,result.calls);}
        <T> T value(Result<T> result,long millis)throws Exception{await(result,millis);assertNull(result.error==null?"":result.error.code.name(),result.error);return result.value;}
        Catalog home(Kind kind)throws Exception{Result<Catalog> result=new Result<>();repository.homeCatalog(kind,false,result);return value(result,2000);}
        void stopWorkers()throws Exception{for(String name:Arrays.asList("worker","epgWorker","metadataWorker","timeout")){Field field=NetworkTvRepository.class.getDeclaredField(name);field.setAccessible(true);((ExecutorService)field.get(repository)).shutdownNow();}}
        public void close()throws Exception{fixture.release.countDown();repository.logout();stopWorkers();}
    }
    @Test public void blockedHomeShelvesYieldWithoutDelayingMoviePlaybackOrMovingApiWork()throws Exception{
        Object player=new Object();try(Harness h=new Harness()){
            Item movie=h.home(Kind.MOVIE).items.get(0);h.fixture.blockedAction="get_series";Result<Catalog> series=new Result<>(),live=new Result<>();h.repository.homeCatalog(Kind.SERIES,false,series);h.repository.homeCatalog(Kind.LIVE,false,live);assertTrue(h.fixture.started.await(1,TimeUnit.SECONDS));
            BackgroundWorkGate.beginPlayback(player);Result<Playback> playback=new Result<>();h.repository.playback(movie,playback);assertEquals("12",h.value(playback,1200).item.id);assertTrue(h.fixture.disconnected.await(1,TimeUnit.SECONDS));
            h.await(series,1200);h.await(live,1200);assertNotNull(series.error);assertNotNull(live.error);assertEquals(0,h.fixture.reads("get_live_categories"));assertTrue(h.repository.hasSession());
            for(String thread:h.fixture.apiThreads)assertEquals("flixify-personal-data",thread);for(String thread:h.fixture.providerThreads)assertEquals("flixify-catalog-refresh",thread);
        }finally{BackgroundWorkGate.endPlayback(player);}
    }
    @Test public void cachedHomeHitDoesNotQueueBehindAnotherKindsSlowProviderBody()throws Exception{
        try(Harness h=new Harness()){
            Catalog movie=h.home(Kind.MOVIE);h.fixture.blockedAction="get_series";Result<Catalog> series=new Result<>();h.repository.homeCatalog(Kind.SERIES,false,series);assertTrue(h.fixture.started.await(1,TimeUnit.SECONDS));
            Result<Catalog> cached=new Result<>();h.repository.homeCatalog(Kind.MOVIE,false,cached);assertEquals(movie.items.get(0).id,h.value(cached,750).items.get(0).id);assertEquals(1,h.fixture.reads("get_vod_streams"));
        }
    }
    @Test public void forceRefreshFetchesFreshCacheOnceForJoinedHomeCallers()throws Exception{
        try(Harness h=new Harness()){
            h.home(Kind.MOVIE);h.fixture.movieTitle="Updated (2026)";h.fixture.blockedAction="get_vod_streams";Result<Catalog> first=new Result<>(),joined=new Result<>();h.repository.homeCatalog(Kind.MOVIE,true,first);assertTrue(h.fixture.started.await(1,TimeUnit.SECONDS));h.repository.homeCatalog(Kind.MOVIE,true,joined);h.fixture.release.countDown();
            assertEquals("Updated (2026)",h.value(first,2000).items.get(0).title);assertEquals("Updated (2026)",h.value(joined,2000).items.get(0).title);assertEquals(2,h.fixture.reads("get_vod_streams"));assertEquals(1,h.fixture.reads("/me/personal-library"));
        }
    }
    @Test public void sourceReplacementRejectsAnOldHomeResultWithoutBlockingAccessRefresh()throws Exception{
        try(Harness h=new Harness()){
            h.home(Kind.MOVIE);h.fixture.blockedAction="get_series";Result<Catalog> series=new Result<>();h.repository.homeCatalog(Kind.SERIES,false,series);assertTrue(h.fixture.started.await(1,TimeUnit.SECONDS));h.fixture.source="source-b";
            Result<Account> account=new Result<>();h.repository.refreshAccess(account);assertTrue(h.value(account,1200).canPlay);assertEquals("fixture-account:source-b",h.repository.currentScope());h.fixture.release.countDown();h.await(series,1200);assertEquals(Failure.Code.STALE,series.error.code);assertNull(series.value);
        }
    }
    @Test public void diskCachedHomeCatalogRestoresWithoutProviderOrLibraryFetch()throws Exception{
        FixtureContext context=new FixtureContext();Harness first=new Harness(context,new Fixture());try{first.home(Kind.MOVIE);first.stopWorkers();try(Harness restored=new Harness(context,new Fixture())){
            assertEquals(2026,restored.home(Kind.MOVIE).items.get(0).releaseYear);assertEquals(0,restored.fixture.reads("get_vod_categories"));assertEquals(0,restored.fixture.reads("get_vod_streams"));assertEquals(0,restored.fixture.reads("/me/personal-library"));assertEquals(1,restored.fixture.reads("/me/provider-session"));
        }}finally{first.close();}
    }
}
