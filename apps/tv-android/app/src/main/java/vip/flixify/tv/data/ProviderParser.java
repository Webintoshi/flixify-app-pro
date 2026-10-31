package vip.flixify.tv.data;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import vip.flixify.tv.TvModels.*;

/** Pure validation of untrusted, personally scoped provider data. Never includes source data in failures. */
public final class ProviderParser {
    private ProviderParser() {}
    public static final class Invalid extends Exception {
        public Invalid() { super("Kişisel içerik bilgisi doğrulanamadı."); }
    }
    static final int MAX_ROWS = 50000, MAX_EPISODES = 5000;
    private static final Set<String> EXTENSIONS = new HashSet<>(Arrays.asList("mp4", "mkv", "avi", "m3u8", "ts"));
    // Exact current allowlist from apps/ops-web/app/platform/personal-provider.ts.
    private static final Set<String> SAFE_MOVIE_NAMES = new HashSet<>();
    static {
        for (String name : new String[]{
            "Vizyondaki Filmler","Yüksek Puanlı Filmler","Yerli Filmler","Yeşilçam Filmleri","Kemal Sunal Filmleri","Film Serileri / Box Setler","Aksiyon - Macera Filmleri","Macera","Komedi","Dram - Romantik","Romantik","Korku - Gerilim","Suç / Polisiye","Bilim Kurgu - Fantastik Filmler","Fantastik","Tarih / Savaş","Gerçek Hikâye / Biyografi","Vahşi Batı / Western","Müzikal","Belgesel","Aile","Animasyon / Çizgi Film","Anime",
            "Aksiyon (Yabancı)","Aksiyon (Yerli)","Amazon","Animasyon","Apple TV+","Bilim Kurgu","Disney+","Dram (Yabancı)","Dram (Yerli)","Filmler","Gerilim (Yabancı)","HBO Max","Komedi (Yabancı)","Komedi (Yerli)","Korku (Yabancı)","Korku (Yerli)","MUBI FILMLER","Müzik","Netflix","Savaş","Seri Filmler","Sinema","Suç","Tabii"
        }) SAFE_MOVIE_NAMES.add(label(name));
    }
    static String text(Object value, int max) {
        if (!(value instanceof String) || ((String)value).length() > max) return "";
        return ((String)value).replaceAll("[\\x00-\\x1f\\x7f-\\x9f]", " ").replaceAll("\\s+", " ").trim();
    }
    static String id(Object value) {
        String candidate = "";
        if (value instanceof String) candidate = (String)value;
        else if (value instanceof Number) {
            double n = ((Number)value).doubleValue();
            if (!Double.isNaN(n) && !Double.isInfinite(n) && n == Math.floor(n) && n >= 1 && n <= 999999999999999L) candidate = Long.toString(((Number)value).longValue());
        }
        return candidate.matches("[1-9][0-9]{0,14}") ? candidate : "";
    }
    static String extension(Object value) {
        String ext = value instanceof String ? ((String)value).toLowerCase(Locale.ROOT) : "";
        return EXTENSIONS.contains(ext) ? ext : "";
    }
    private static String label(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKD).replaceAll("[\\u0300-\\u036f]", "").replace('İ','i').replace('I','i').replace('ı','i').toLowerCase(Locale.ROOT).replaceFirst("^tr\\s*[|:]\\s*", "").replaceAll("\\s+", " ").trim();
    }
    private static boolean junk(String title) {
        if (title.isEmpty()) return true;
        String compact = title.replaceAll("\\s+", ""); String lower = compact.toLowerCase(Locale.ROOT);
        for (String prefix : new String[]{"data:image/", "/9j/", "ivborw0kggo", "r0lgod"}) if (lower.startsWith(prefix)) return true;
        return compact.length() >= 160 && compact.replaceAll("[^A-Za-z0-9+/=]", "").length() >= compact.length() * .9;
    }
    public static String artwork(Object value) {
        String url = text(value, 2048);
        try {
            URI uri = new URI(url);
            // Artwork is independent of provider authentication; query strings may contain a provider token.
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || url.contains("\\")) return "";
            return uri.toASCIIString();
        } catch (Exception ignored) { return ""; }
    }
    static JSONArray list(Object value, int max) throws Invalid {
        if (!(value instanceof JSONArray) || ((JSONArray)value).length() > max) throw new Invalid();
        return (JSONArray)value;
    }
    static JSONObject object(Object value) throws Invalid {
        if (!(value instanceof JSONObject)) throw new Invalid(); return (JSONObject)value;
    }
    static long date(Object value) {
        if (!(value instanceof String) || ((String)value).length() > 64) return 0;
        String s = (String)value;
        // API dates are ISO 8601 UTC. Avoid java.time on Android 6.
        for (String pattern : new String[]{"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"}) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US); format.setLenient(false); format.setTimeZone(TimeZone.getTimeZone("UTC"));
            ParsePosition position = new ParsePosition(0); java.util.Date parsed = format.parse(s, position);
            if (parsed != null && position.getIndex() == s.length()) return parsed.getTime();
        }
        return 0;
    }
    public static final class LivePolicy {
        final String revision;
        final Set<String> excludedIds;
        LivePolicy(String revision,Set<String> ids) { this.revision=revision;this.excludedIds=Collections.unmodifiableSet(new HashSet<>(ids)); }
    }
    private static LivePolicy livePolicy(Object value) {
        if(!(value instanceof JSONObject))return null;
        JSONObject raw=(JSONObject)value;Object revision=raw.opt("revision"),rows=raw.opt("excludedIds");
        if(!(revision instanceof String) || !((String)revision).matches("[a-f0-9]{64}") || !(rows instanceof JSONArray) || ((JSONArray)rows).length()>MAX_ROWS)return null;
        Set<String> ids=new HashSet<>();JSONArray entries=(JSONArray)rows;
        for(int i=0;i<entries.length();i++){Object entry=entries.opt(i);if(!(entry instanceof String) || id(entry).isEmpty())return null;ids.add((String)entry);}
        return new LivePolicy((String)revision,ids);
    }
    public static final class Bootstrap {
        final String accountId, sourceVersion, origin, username, password;
        final long expiresAtMs;
        final LivePolicy livePolicy;
        Bootstrap(String accountId, String sourceVersion, String origin, String username, String password, long expiry) { this(accountId,sourceVersion,origin,username,password,expiry,null); }
        Bootstrap(String accountId, String sourceVersion, String origin, String username, String password, long expiry,LivePolicy policy) {
            this.accountId=accountId; this.sourceVersion=sourceVersion; this.origin=origin; this.username=username; this.password=password; this.expiresAtMs=expiry;this.livePolicy=policy;
        }
        String scope() { return accountId + ":" + sourceVersion; }
        boolean sameIdentity(Bootstrap other) {
            return other != null && accountId.equals(other.accountId) && sourceVersion.equals(other.sourceVersion) && origin.equals(other.origin) && username.equals(other.username) && password.equals(other.password);
        }
    }
    public static Bootstrap bootstrap(JSONObject raw, long now) throws Invalid {
        String account = secret(raw.opt("accountId"), 256), version = secret(raw.opt("sourceVersion"), 128);
        if (account.indexOf(':') >= 0 || !version.matches("[A-Za-z0-9_-]{1,128}")) throw new Invalid();
        String username = secret(raw.opt("username"), 256), password = secret(raw.opt("password"), 2048);
        String origin = raw.opt("providerOrigin") instanceof String ? raw.optString("providerOrigin") : "";
        try {
            URI uri = new URI(origin);
            int port = uri.getPort();
            String canonical = "https://" + (uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT)) + (port == -1 || port == 443 ? "" : ":" + port);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || !uri.getRawPath().isEmpty() || uri.getRawQuery() != null || uri.getRawFragment() != null || !origin.equals(canonical) || origin.contains("\\") || port == 0 || port > 65535) throw new Invalid();
        } catch (Invalid invalid) { throw invalid; } catch (Exception ignored) { throw new Invalid(); }
        long expiry = date(raw.opt("expiresAt"));
        if (!"general-audience-only".equals(raw.opt("moviePolicy")) || expiry <= now) throw new Invalid();
        return new Bootstrap(account,version,origin,username,password,expiry,livePolicy(raw.opt("livePolicy")));
    }
    static Bootstrap retainLivePolicy(Bootstrap incoming,Bootstrap previous) {
        if(incoming.livePolicy!=null || !incoming.sameIdentity(previous) || previous.livePolicy==null)return incoming;
        return new Bootstrap(incoming.accountId,incoming.sourceVersion,incoming.origin,incoming.username,incoming.password,incoming.expiresAtMs,previous.livePolicy);
    }
    static boolean liveExcluded(Item item,Bootstrap bootstrap) {
        return bootstrap!=null && item!=null && item.kind==Kind.LIVE && item.scope.equals(bootstrap.scope()) && bootstrap.livePolicy!=null && bootstrap.livePolicy.excludedIds.contains(item.id);
    }
    static Catalog filterLiveCatalog(Catalog catalog,Bootstrap bootstrap) {
        if(catalog.kind!=Kind.LIVE || bootstrap==null || bootstrap.livePolicy==null || bootstrap.livePolicy.excludedIds.isEmpty())return catalog;
        List<Item> items=new ArrayList<>();Set<String> categoryIds=new HashSet<>();
        for(Item item:catalog.items)if(!liveExcluded(item,bootstrap)){items.add(item);categoryIds.add(item.categoryId);}
        if(items.size()==catalog.items.size())return catalog;
        List<Category> categories=new ArrayList<>();for(Category category:catalog.categories)if(categoryIds.contains(category.id))categories.add(category);
        return new Catalog(catalog.kind,items,categories);
    }
    static String secret(Object value, int max) throws Invalid {
        if (!(value instanceof String) || ((String)value).isEmpty() || ((String)value).length() > max || ((String)value).matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new Invalid();
        return (String)value;
    }
    static Object parseJson(String json) throws Invalid {
        int depth=0;boolean quoted=false,escaped=false;
        for(int i=0;i<json.length();i++) {
            char c=json.charAt(i);
            if(quoted) {if(escaped)escaped=false;else if(c=='\\')escaped=true;else if(c=='"')quoted=false;continue;}
            if(c=='"')quoted=true;
            else if(c=='{' || c=='[') {if(++depth>64)throw new Invalid();}
            else if(c=='}' || c==']') {if(--depth<0)throw new Invalid();}
        }
        if(quoted || depth!=0)throw new Invalid();
        try {JSONTokener reader=new JSONTokener(json);Object result=reader.nextValue();if(reader.nextClean()!=0)throw new Invalid();return result;}
        catch(Invalid invalid){throw invalid;}catch(Exception ignored){throw new Invalid();}
    }
    public static Catalog catalog(Kind kind, Object raw, Object rawCategories, String scope) throws Invalid {
        if (kind == null || kind == Kind.EPISODE) throw new Invalid();
        JSONArray rows = list(raw, MAX_ROWS), categories = list(rawCategories, MAX_ROWS);
        Map<String,String> groups = new LinkedHashMap<>();
        for (int i=0; i<categories.length(); i++) {
            JSONObject row = object(categories.opt(i)); String key = id(row.opt("category_id")), name = text(row.opt("category_name"),256);
            if (!key.isEmpty() && !name.isEmpty()) { if (groups.containsKey(key) && !groups.get(key).equals(name)) throw new Invalid(); groups.put(key,name); }
        }
        List<Item> result = new ArrayList<>(); Set<String> seen = new HashSet<>(); Set<String> usedGroups = new HashSet<>();
        for (int i=0; i<rows.length(); i++) {
            if (!(rows.opt(i) instanceof JSONObject)) continue;
            JSONObject row = (JSONObject)rows.opt(i);
            String key = id(row.opt(kind == Kind.SERIES ? "series_id" : "stream_id")), title = text(row.opt("name"),512);
            String groupId = id(row.opt("category_id")), group = groups.containsKey(groupId) ? groups.get(groupId) : "";
            if (key.isEmpty() || junk(title) || seen.contains(key)) continue;
            Object declaredExtension=row.opt("container_extension");
            boolean missingExtension=declaredExtension==null || declaredExtension==JSONObject.NULL || "".equals(declaredExtension);
            String ext = extension(declaredExtension); if (ext.isEmpty() && kind == Kind.LIVE) ext=missingExtension?"ts":"m3u8";
            if (kind == Kind.MOVIE && (group.isEmpty() || !SAFE_MOVIE_NAMES.contains(label(group)) || ext.isEmpty())) continue;
            Object art = row.isNull("stream_icon") ? row.opt("cover") : row.opt("stream_icon");
            result.add(new Item(kind,key,title,groupId,group,artwork(art),ext,scope,"",0,0,text(row.opt("plot"),8192)));
            seen.add(key); usedGroups.add(groupId);
        }
        List<Category> outputGroups = new ArrayList<>(); for (Map.Entry<String,String> group : groups.entrySet()) if (usedGroups.contains(group.getKey())) outputGroups.add(new Category(group.getKey(),group.getValue()));
        return new Catalog(kind,result,outputGroups);
    }
    private static int positive(Object value, int max) {
        String raw = value instanceof Number ? String.valueOf(value) : value instanceof String ? (String)value : "";
        if (!raw.matches("[0-9]{1,5}")) return 0;
        try { int n = Integer.parseInt(raw); return n >= 1 && n <= max ? n : 0; } catch (Exception ignored) { return 0; }
    }
    public static SeriesDetail series(Object raw, Item parent) throws Invalid {
        if (parent == null || parent.kind != Kind.SERIES || id(parent.id).isEmpty() || junk(parent.title)) throw new Invalid();
        JSONObject buckets = object(object(raw).opt("episodes")); if (buckets.length() > MAX_EPISODES) throw new Invalid();
        List<JSONArray> groups = new ArrayList<>(); int count=0;
        Iterator<String> keys = buckets.keys(); while (keys.hasNext()) { JSONArray group=list(buckets.opt(keys.next()),MAX_EPISODES); count+=group.length(); if(count > MAX_EPISODES) throw new Invalid(); groups.add(group); }
        Set<String> seen = new HashSet<>(); List<Item> episodes = new ArrayList<>();
        for (JSONArray group : groups) for (int i=0; i<group.length(); i++) {
            if (!(group.opt(i) instanceof JSONObject)) continue; JSONObject row=(JSONObject)group.opt(i);
            String key=id(row.opt("id")), title=text(row.opt("title"),512), ext=extension(row.opt("container_extension"));
            int season=positive(row.opt("season"),999), episode=positive(row.opt("episode_num"),9999);
            if (key.isEmpty() || seen.contains(key) || junk(title) || ext.isEmpty() || season==0 || episode==0) continue;
            JSONObject info=row.optJSONObject("info");
            episodes.add(new Item(Kind.EPISODE,key,title,parent.categoryId,parent.categoryName,parent.artwork,ext,parent.scope,parent.id,season,episode, info==null ? "" : text(info.opt("plot"),8192))); seen.add(key);
        }
        Collections.sort(episodes,(a,b)->a.season != b.season ? Integer.compare(a.season,b.season) : Integer.compare(a.episode,b.episode));
        Map<Integer,List<Item>> seasons = new LinkedHashMap<>(); for(Item e:episodes) { if(!seasons.containsKey(e.season)) seasons.put(e.season,new ArrayList<>()); seasons.get(e.season).add(e); }
        List<Season> result=new ArrayList<>(); for(Map.Entry<Integer,List<Item>> season:seasons.entrySet()) result.add(new Season(season.getKey(),season.getValue()));
        return new SeriesDetail(parent,result);
    }
    static String encode(String value) throws Invalid {
        try { return URLEncoder.encode(value,"UTF-8").replace("+","%20").replace("%7E","~"); } catch(Exception ignored) { throw new Invalid(); }
    }
    public static JSONObject reference(Item item,String scope) throws Invalid {
        if (item==null || item.kind==null || !scope.equals(item.scope) || id(item.id).isEmpty() || scope.lastIndexOf(':')<=0) throw new Invalid();
        if (item.kind==Kind.EPISODE ? id(item.seriesId).isEmpty() : !item.seriesId.isEmpty()) throw new Invalid();
        if (!item.extension.isEmpty() && extension(item.extension).isEmpty()) throw new Invalid();
        try {
            JSONObject ref=new JSONObject().put("source","personal").put("sourceVersion",scope.substring(scope.lastIndexOf(':')+1)).put("kind",item.kind.name().toLowerCase(Locale.ROOT)).put("id",item.id);
            if(!item.extension.isEmpty()) ref.put("extension",item.extension); if(item.kind==Kind.EPISODE) ref.put("seriesId",item.seriesId); return ref;
        } catch(Exception ignored) { throw new Invalid(); }
    }
    public static String mediaUrl(Bootstrap b,Item item,long now) throws Invalid {
        if(liveExcluded(item,b))throw new Invalid();
        reference(item,b.scope()); if(b.expiresAtMs<=now || item.kind==Kind.SERIES || (item.kind!=Kind.LIVE && extension(item.extension).isEmpty())) throw new Invalid();
        String ext=item.extension.isEmpty()?"m3u8":extension(item.extension); if(ext.isEmpty()) throw new Invalid();
        return b.origin + "/" + (item.kind==Kind.EPISODE?"series":item.kind.name().toLowerCase(Locale.ROOT)) + "/" + encode(b.username) + "/" + encode(b.password) + "/" + item.id + "." + ext;
    }
    private static String decode(Object value) {
        if (!(value instanceof String)) return ""; String s=(String)value;
        if(s.isEmpty() || s.length()>1024 || s.length()%4!=0 || !s.matches("[A-Za-z0-9+/]*={0,2}")) return "";
        // android.util.Base64 is a stub on the host JVM; this small strict decoder is API 23 safe.
        byte[] bytes=new byte[s.length()/4*3]; int count=0, bits=0, accum=0;
        String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for(int i=0;i<s.length();i++) { char c=s.charAt(i); if(c=='=') break; int n=alphabet.indexOf(c); if(n<0)return ""; accum=(accum<<6)|n; bits+=6; if(bits>=8){bits-=8; bytes[count++]=(byte)(accum>>bits);} }
        try { return text(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes,0,count)).toString(),512); } catch(CharacterCodingException ignored){return "";}
    }
    private static long timestamp(Object value) {
        try { String s=String.valueOf(value); if(!s.matches("[0-9]{1,10}")) return 0; return Long.parseLong(s); } catch(Exception ignored){return 0;}
    }
    public static List<Programme> epg(Object raw) throws Invalid {
        JSONArray rows=list(object(raw).opt("epg_listings"),24); List<Programme> result=new ArrayList<>();
        for(int i=0;i<rows.length();i++) { JSONObject row=rows.optJSONObject(i); if(row==null)continue; long start=timestamp(row.opt("start_timestamp")), end=timestamp(row.isNull("stop_timestamp")?row.opt("end_timestamp"):row.opt("stop_timestamp")); String title=decode(row.opt("title")); if(!title.isEmpty() && start>=946684800L && end<=4102444800L && end>start && end-start<=86400) result.add(new Programme(title,start*1000,end*1000)); }
        Collections.sort(result,(a,b)->Long.compare(a.startsAtMs,b.startsAtMs)); return Collections.unmodifiableList(result);
    }
}
