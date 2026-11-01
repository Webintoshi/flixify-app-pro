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
import java.lang.reflect.Field;
import org.json.*;
import org.junit.Test;
import vip.flixify.tv.TvModels.*;
import vip.flixify.tv.TvRepository;
import static org.junit.Assert.*;

/** Real repository scheduling and parsing, with every connection intercepted before any socket opens. */
public class NetworkLiveCurationTest {
    private static final long NOW=1700000000000L;
    private static final String SCOPE="fixture-account:source-a";
    private static String date(long value){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);f.setTimeZone(TimeZone.getTimeZone("UTC"));return f.format(new Date(value));}
    private static final class Preferences implements SharedPreferences {
        final Map<String,Object> values=new HashMap<>();
        public Map<String,?> getAll(){return new HashMap<>(values);}public String getString(String k,String d){return (String)values.getOrDefault(k,d);}
        @SuppressWarnings("unchecked") public Set<String> getStringSet(String k,Set<String>d){return (Set<String>)values.getOrDefault(k,d);}
        public int getInt(String k,int d){return (Integer)values.getOrDefault(k,d);}public long getLong(String k,long d){return (Long)values.getOrDefault(k,d);}
        public float getFloat(String k,float d){return (Float)values.getOrDefault(k,d);}public boolean getBoolean(String k,boolean d){return (Boolean)values.getOrDefault(k,d);}public boolean contains(String k){return values.containsKey(k);}
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){}public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){}
        public Editor edit(){return new Editor(){Map<String,Object> next=new HashMap<>();Set<String> removed=new HashSet<>();boolean clear;
            public Editor putString(String k,String v){next.put(k,v);return this;}public Editor putStringSet(String k,Set<String>v){next.put(k,v);return this;}public Editor putInt(String k,int v){next.put(k,v);return this;}public Editor putLong(String k,long v){next.put(k,v);return this;}public Editor putFloat(String k,float v){next.put(k,v);return this;}public Editor putBoolean(String k,boolean v){next.put(k,v);return this;}public Editor remove(String k){removed.add(k);return this;}public Editor clear(){clear=true;return this;}public boolean commit(){if(clear)values.clear();for(String k:removed)values.remove(k);values.putAll(next);return true;}public void apply(){commit();}};}
    }
    private static final class FixtureContext extends ContextWrapper {
        final File root;final Map<String,Preferences> preferences=new HashMap<>();
        FixtureContext()throws IOException{super(null);root=Files.createTempDirectory("flixify-live-curation-").toFile();}
        @Override public Context getApplicationContext(){return this;}@Override public File getFilesDir(){return root;}
        @Override public SharedPreferences getSharedPreferences(String name,int mode){return preferences.computeIfAbsent(name,k->new Preferences());}
    }
    private static final class Fixture implements NetworkTvRepository.ConnectionFactory {
        final Set<String> favorites=new LinkedHashSet<>(Arrays.asList("34","36"));final List<String> writes=new ArrayList<>(),epgIds=new ArrayList<>();
        final Set<String> exclusions=new LinkedHashSet<>();String source="source-a",favoritesSource="source-a",failDeleteOnce;int streams;
        private JSONObject ref(String id)throws Exception{return new JSONObject().put("source","personal").put("sourceVersion",favoritesSource).put("kind","live").put("id",id);}
        private JSONObject row(String id,String title)throws Exception{return new JSONObject().put("stream_id",id).put("name",title).put("category_id","7").put("container_extension","ts");}
        public HttpURLConnection open(URL url){return new HttpURLConnection(url){
            final ByteArrayOutputStream request=new ByteArrayOutputStream();byte[] response;int responseStatus=200;
            public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public OutputStream getOutputStream(){return request;}
            private void resolve(){if(response!=null)return;try{
                Object result;String path=url.getPath(),query=url.getQuery();
                if(path.equals("/me")){result=new JSONObject().put("user",new JSONObject().put("id","fixture-account").put("status","active").put("codeSuffix","1234").put("hasAssignedLink",true).put("hasActiveSubscription",true).put("activePackage",new JSONObject().put("title","Fixture").put("endsAt",date(NOW+600000))));}
                else if(path.equals("/me/provider-session")){result=new JSONObject().put("accountId","fixture-account").put("sourceVersion",source).put("providerOrigin","https://provider.test").put("username","fixture-user").put("password","fixture-password").put("expiresAt",date(NOW+600000)).put("moviePolicy","general-audience-only").put("livePolicy",new JSONObject().put("revision",exclusions.isEmpty()?String.join("",Collections.nCopies(64,"a")):String.join("",Collections.nCopies(64,"b"))).put("excludedIds",new JSONArray(exclusions)));}
                else if(path.equals("/me/personal-library")){JSONArray refs=new JSONArray();for(String id:favorites)refs.put(ref(id));result=new JSONObject().put("favorites",refs).put("watched",new JSONArray());}
                else if(path.equals("/me/personal-library/favorites")){JSONObject ref=new JSONObject(request.toString("UTF-8")).getJSONObject("ref");assertEquals(source,ref.getString("sourceVersion"));String id=ref.getString("id");writes.add(getRequestMethod()+":"+id);if(getRequestMethod().equals("DELETE") && id.equals(failDeleteOnce)){failDeleteOnce=null;responseStatus=503;}else if(getRequestMethod().equals("DELETE"))favorites.remove(id);else favorites.add(id);result=new JSONObject().put("ok",responseStatus==200);}
                else if(path.equals("/player_api.php") && query.contains("action=get_live_categories")){result=new JSONArray().put(new JSONObject().put("category_id","7").put("category_name","TR: Ulusal"));}
                else if(path.equals("/player_api.php") && query.contains("action=get_live_streams")){streams++;result=new JSONArray().put(row("34","TR | ATV SD")).put(row("35","TR | ATV FHD")).put(row("36","TR | Atv ꜰʜᴅ")).put(row("45","TR | TRT 1"));}
                else if(path.equals("/player_api.php") && query.contains("action=get_short_epg")){String id=query.replaceAll(".*&stream_id=([0-9]+).*","$1");epgIds.add(id);result=new JSONObject().put("epg_listings",new JSONArray().put(new JSONObject().put("title","TmV3cw==").put("start_timestamp","1700000000").put("stop_timestamp","1700003600")));}
                else throw new AssertionError("Unexpected intercepted request "+path);
                response=result.toString().getBytes(StandardCharsets.UTF_8);
            }catch(Exception e){throw new AssertionError(e);}}
            public int getResponseCode(){resolve();return responseStatus;}public String getHeaderField(String k){resolve();return "Content-Length".equals(k)?String.valueOf(response.length):null;}public InputStream getInputStream(){resolve();return new ByteArrayInputStream(response);}
        };}
    }
    private static final class Result<T> implements TvRepository.Callback<T>{T value;Failure failure;boolean done;public void onResult(T v){value=v;done=true;}public void onError(Failure f){failure=f;done=true;}}
    private static final class Harness implements AutoCloseable {
        final FixtureContext context;final Fixture fixture;final BlockingQueue<Runnable> deliveries=new LinkedBlockingQueue<>();final NetworkTvRepository repository;
        Harness()throws Exception{this(new FixtureContext(),new Fixture());}
        Harness(FixtureContext context,Fixture fixture)throws Exception{this.context=context;this.fixture=fixture;repository=new NetworkTvRepository(context,fixture,()->NOW,deliveries::add);Field f=NetworkTvRepository.class.getDeclaredField("tokens");f.setAccessible(true);f.set(repository,new TokenStore.Session("fixture-access","fixture-refresh","fixture-account","1234"));}
        <T> void await(Result<T> result)throws Exception{long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(!result.done && System.nanoTime()<deadline){Runnable r=deliveries.poll(1,TimeUnit.SECONDS);if(r!=null)r.run();}assertTrue("Repository callback did not complete",result.done);}
        <T> T deliver(Result<T> result)throws Exception{await(result);assertNull(result.failure);return result.value;}
        void awaitQueued(int count)throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(deliveries.size()<count && System.nanoTime()<end)Thread.sleep(1);assertTrue("Expected queued callbacks",deliveries.size()>=count);}
        Catalog catalog()throws Exception{Result<Catalog> r=new Result<>();repository.catalog(Kind.LIVE,false,r);return deliver(r);}
        void stopWorkers()throws Exception{for(String name:Arrays.asList("worker","epgWorker","metadataWorker","timeout")){Field f=NetworkTvRepository.class.getDeclaredField(name);f.setAccessible(true);((ExecutorService)f.get(repository)).shutdownNow();}}
        public void close()throws Exception{repository.logout();stopWorkers();}
    }
    private Item station(Catalog catalog,String title){for(Item item:catalog.items)if(item.title.equals(title))return item;throw new AssertionError("Missing canonical station: "+title);}
    private Item legacy(){return new Item(Kind.LIVE,"34","TR | ATV SD","7","TR: Ulusal","","ts",SCOPE,"",0,0,"");}
    @Test public void savedRawAliasesAppearOnceAndDoNotWriteDuringRead()throws Exception{
        try(Harness h=new Harness()){h.catalog();Result<List<Item>> r=new Result<>();h.repository.favorites(r);List<Item> saved=h.deliver(r);assertEquals(1,saved.size());assertEquals("35",saved.get(0).id);assertTrue(h.fixture.writes.isEmpty());}
    }
    @Test public void oldPlaybackIdentityResolvesToSelectedStreamWithoutChangingScopeOrExtension()throws Exception{
        try(Harness h=new Harness()){h.catalog();Result<Playback> r=new Result<>();h.repository.playback(legacy(),r);Playback p=h.deliver(r);assertEquals("35",p.item.id);assertEquals(SCOPE,p.item.scope);assertEquals("ts",p.item.extension);assertTrue(p.url.endsWith("/35.ts"));}
    }
    @Test public void oldEpgIdentityUsesSelectedOriginalProviderStreamId()throws Exception{
        try(Harness h=new Harness()){h.catalog();Result<List<Programme>> r=new Result<>();h.repository.epg(legacy(),r);assertEquals(1,h.deliver(r).size());assertEquals(Collections.singletonList("35"),h.fixture.epgIds);}
    }

    @Test public void legacyFavoritePlaybackAndEpgResolveToOneFhdWithoutBackgroundWrites()throws Exception{
        try(Harness h=new Harness()){
            Catalog c=h.catalog();assertEquals(2,c.items.size());Item atv=station(c,"ATV");assertEquals("35",atv.id);assertEquals("ATV",atv.title);assertEquals("TRT 1",c.items.get(0).title);
            Result<List<Item>> favorites=new Result<>();h.repository.favorites(favorites);List<Item> saved=h.deliver(favorites);assertEquals(1,saved.size());assertEquals("35",saved.get(0).id);assertTrue(h.repository.isFavorite(atv));assertTrue(h.fixture.writes.isEmpty());
            Result<Playback> playback=new Result<>();h.repository.playback(legacy(),playback);Playback playable=h.deliver(playback);assertEquals("35",playable.item.id);assertTrue(playable.url.endsWith("/35.ts"));
            Result<List<Programme>> epg=new Result<>();h.repository.epg(legacy(),epg);assertEquals(1,h.deliver(epg).size());assertEquals(Collections.singletonList("35"),h.fixture.epgIds);assertTrue(h.fixture.writes.isEmpty());
            Result<Boolean> remove=new Result<>();h.repository.toggleFavorite(atv,remove);assertFalse(h.deliver(remove));assertEquals(Arrays.asList("DELETE:34","DELETE:36"),h.fixture.writes);assertTrue(h.fixture.favorites.isEmpty());assertFalse(h.repository.isFavorite(atv));
            Result<Boolean> add=new Result<>();h.repository.toggleFavorite(atv,add);assertTrue(h.deliver(add));assertEquals(Collections.singleton("35"),h.fixture.favorites);assertEquals("PUT:35",h.fixture.writes.get(2));
        }
    }
    @Test public void diskRestorationAndPolicyRefreshRecomputeAliasesWithoutProviderRefetch()throws Exception{
        FixtureContext context=new FixtureContext();Harness first=new Harness(context,new Fixture());assertEquals("35",station(first.catalog(),"ATV").id);first.stopWorkers();
        Fixture fixture=new Fixture();fixture.exclusions.add("35");try(Harness h=new Harness(context,fixture)){
            assertEquals("36",station(h.catalog(),"ATV").id);assertEquals(0,fixture.streams);
            Result<List<Item>> favorites=new Result<>();h.repository.favorites(favorites);assertEquals("36",h.deliver(favorites).get(0).id);assertTrue(fixture.writes.isEmpty());
            fixture.exclusions.clear();Result<Account> access=new Result<>();h.repository.refreshAccess(access);h.deliver(access);assertEquals("35",station(h.catalog(),"ATV").id);assertEquals(0,fixture.streams);
        }finally{first.close();}
    }
    @Test public void newlyExcludedRequestedAliasCannotEscapeThroughQueuedCanonicalPlayback()throws Exception{
        try(Harness h=new Harness()){
            h.catalog();Result<Playback> pending=new Result<>();h.repository.playback(legacy(),pending);h.awaitQueued(1);
            h.fixture.exclusions.add("34");Result<Account> refreshed=new Result<>();h.repository.refreshAccess(refreshed);h.awaitQueued(2);
            h.await(pending);assertNull(pending.value);assertNotNull(pending.failure);h.deliver(refreshed);assertTrue(h.fixture.writes.isEmpty());
        }
    }
    @Test public void queuedFavoritesUseLatestPolicyProjection()throws Exception{
        try(Harness h=new Harness()){
            h.catalog();Result<List<Item>> pending=new Result<>();h.repository.favorites(pending);h.awaitQueued(1);
            h.fixture.exclusions.add("35");Result<Account> refreshed=new Result<>();h.repository.refreshAccess(refreshed);h.awaitQueued(2);
            assertEquals("36",h.deliver(pending).get(0).id);h.deliver(refreshed);assertTrue(h.fixture.writes.isEmpty());
        }
    }

    @Test public void partialFavoriteRemovalRetriesOnlyUnacknowledgedExactAliases()throws Exception{
        try(Harness h=new Harness()){
            Item canonical=station(h.catalog(),"ATV");h.fixture.failDeleteOnce="36";
            Result<Boolean> first=new Result<>();h.repository.toggleFavorite(canonical,first);h.await(first);assertNotNull(first.failure);
            assertEquals(Collections.singleton("36"),h.fixture.favorites);assertTrue(h.repository.isFavorite(canonical));
            Result<Boolean> retry=new Result<>();h.repository.toggleFavorite(canonical,retry);assertFalse(h.deliver(retry));
            assertEquals(Arrays.asList("DELETE:34","DELETE:36","DELETE:36"),h.fixture.writes);assertTrue(h.fixture.favorites.isEmpty());assertFalse(h.repository.isFavorite(canonical));
        }
    }
    @Test public void sourceReplacementDoesNotReuseOldAliasOrSavedFavoriteIdentity()throws Exception{
        try(Harness h=new Harness()){
            Item previous=station(h.catalog(),"ATV");assertTrue(h.repository.isFavorite(previous));h.fixture.source="source-b";
            Result<Account> access=new Result<>();h.repository.refreshAccess(access);h.deliver(access);Catalog current=h.catalog();assertEquals("fixture-account:source-b",station(current,"ATV").scope);assertFalse(h.repository.isFavorite(station(current,"ATV")));
            Result<Playback> old=new Result<>();h.repository.playback(legacy(),old);h.await(old);assertNull(old.value);assertNotNull(old.failure);assertTrue(h.fixture.writes.isEmpty());
        }
    }

    @Test public void ownerExcludedAliasCannotBypassPolicyThroughFavoritesOrPlayback()throws Exception{
        try(Harness h=new Harness()){
            h.fixture.exclusions.add("34");h.fixture.favorites.clear();h.fixture.favorites.add("34");Catalog c=h.catalog();assertEquals("35",station(c,"ATV").id);
            Result<List<Item>> saved=new Result<>();h.repository.favorites(saved);assertTrue(h.deliver(saved).isEmpty());assertFalse(h.repository.isFavorite(station(c,"ATV")));assertTrue(h.fixture.writes.isEmpty());
            Result<Playback> playback=new Result<>();h.repository.playback(legacy(),playback);long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(!playback.done && System.nanoTime()<end){Runnable r=h.deliveries.poll(1,TimeUnit.SECONDS);if(r!=null)r.run();}assertTrue(playback.done);assertNull(playback.value);assertNotNull(playback.failure);
        }
    }
}
