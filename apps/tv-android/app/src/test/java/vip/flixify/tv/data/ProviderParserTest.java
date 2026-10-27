package vip.flixify.tv.data;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.List;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

public class ProviderParserTest {
    private static final long NOW = 1700000000000L;
    private JSONObject bootstrap() throws Exception {
        return new JSONObject("{\"accountId\":\"account-a\",\"sourceVersion\":\"source-a\",\"providerOrigin\":\"https://provider.test\",\"username\":\"private user\",\"password\":\"secret/password\",\"expiresAt\":\"2023-11-14T22:15:20.000Z\",\"moviePolicy\":\"general-audience-only\"}");
    }
    private JSONArray categories(String name) throws Exception { return new JSONArray().put(new JSONObject().put("category_id", "9").put("category_name", name)); }
    private JSONObject row(String id, String extension) throws Exception { return new JSONObject().put("stream_id", id).put("name", "A film").put("category_id", "9").put("container_extension", extension); }
    private void rejects(Throwing work) throws Exception { try { work.run(); fail("Expected rejection"); } catch (ProviderParser.Invalid expected) { assertFalse(expected.getMessage().contains("secret")); assertFalse(expected.getMessage().contains("provider.test")); } }
    private interface Throwing { void run() throws Exception; }

    @Test public void movieAllowlistAcceptsTurkishNormalizedCategoryButRejectsUnknownAndAdult() throws Exception {
        JSONArray rows = new JSONArray().put(row("11", "MKV"));
        assertEquals(1, ProviderParser.catalog(Kind.MOVIE, rows, categories("TR | Yeşilçam Filmleri"), "account-a:source-a").items.size());
        assertTrue(ProviderParser.catalog(Kind.MOVIE, rows, categories("Yeni / Unreviewed"), "account-a:source-a").items.isEmpty());
        assertTrue(ProviderParser.catalog(Kind.MOVIE, rows, categories("Yetişkin"), "account-a:source-a").items.isEmpty());
    }
    @Test public void catalogRejectsMalformedIdsExtensionsDuplicatesAndJunk() throws Exception {
        JSONArray rows = new JSONArray().put(row("01", "mp4")).put(row("11", "exe")).put(row("12", "mp4")).put(row("12", "mkv")).put(row("13", "mp4").put("name", "data:image/png;base64,abc"));
        Catalog catalog = ProviderParser.catalog(Kind.MOVIE, rows, categories("Filmler"), "account-a:source-a");
        assertEquals(1, catalog.items.size()); assertEquals("12", catalog.items.get(0).id);
        assertEquals("account-a:source-a", catalog.items.get(0).scope);
    }
    @Test public void duplicateCategoryWithDifferentNameFailsClosed() throws Exception {
        JSONArray cats = categories("Filmler").put(new JSONObject().put("category_id", "9").put("category_name", "Yetişkin"));
        rejects(() -> ProviderParser.catalog(Kind.MOVIE, new JSONArray().put(row("1", "mp4")), cats, "a:v"));
    }
    @Test public void rejectsNonRootHttpCredentialAndExpiredBootstrap() throws Exception {
        for (String origin : new String[]{"http://provider.test", "https://provider.test/", "https://provider.test/base", "https://user:password@provider.test", "https://provider.test?secret=x", "https://provider.test#secret", "https://provider.test\\evil"}) {
            rejects(() -> ProviderParser.bootstrap(bootstrap().put("providerOrigin", origin), NOW));
        }
        rejects(() -> ProviderParser.bootstrap(bootstrap(), NOW + 120000));
        rejects(() -> ProviderParser.bootstrap(bootstrap().put("moviePolicy", "all"), NOW));
    }
    @Test public void mediaUrlEncodesCredentialsAndRequiresCurrentScopeAndSafeExtension() throws Exception {
        ProviderParser.Bootstrap b = ProviderParser.bootstrap(bootstrap(), NOW);
        Item item = new Item(Kind.MOVIE, "12", "Film", "9", "Filmler", "", "mkv", "account-a:source-a", "", 0, 0, "");
        assertEquals("https://provider.test/movie/private%20user/secret%2Fpassword/12.mkv", ProviderParser.mediaUrl(b, item, NOW));
        rejects(() -> ProviderParser.mediaUrl(b, new Item(Kind.MOVIE, "12", "Film", "9", "Filmler", "", "mp4", "account-b:source-a", "", 0, 0, ""), NOW));
        rejects(() -> ProviderParser.mediaUrl(b, new Item(Kind.MOVIE, "12", "Film", "9", "Filmler", "", "exe", b.scope(), "", 0, 0, ""), NOW));
        rejects(() -> ProviderParser.mediaUrl(b, item, NOW + 120000));
    }
    @Test public void artworkNeverContainsCredentialsOrProviderSecrets() throws Exception {
        JSONArray rows = new JSONArray().put(row("12", "mp4").put("stream_icon", "https://image.test/poster?password=secret"));
        assertEquals("", ProviderParser.catalog(Kind.MOVIE, rows, categories("Filmler"), "a:v").items.get(0).artwork);
        assertEquals("", ProviderParser.artwork("https://user:pass@image.test/x"));
        assertEquals("https://image.test/poster.jpg", ProviderParser.artwork("https://image.test/poster.jpg"));
    }
    @Test public void episodesValidateParentAndSortAndDropInvalidExtensions() throws Exception {
        Item parent = new Item(Kind.SERIES, "17", "Series", "", "", "", "", "a:v", "", 0, 0, "");
        JSONObject raw = new JSONObject("{\"episodes\":{\"2\":[{\"id\":\"3\",\"title\":\"Second\",\"season\":2,\"episode_num\":1,\"container_extension\":\"mp4\"}],\"1\":[{\"id\":\"2\",\"title\":\"First\",\"season\":1,\"episode_num\":1,\"container_extension\":\"mkv\"},{\"id\":\"4\",\"title\":\"Unsafe\",\"season\":1,\"episode_num\":2,\"container_extension\":\"exe\"}]}}");
        SeriesDetail detail = ProviderParser.series(raw, parent);
        assertEquals(2, detail.seasons.size()); assertEquals("2", detail.seasons.get(0).episodes.get(0).id); assertEquals("17", detail.seasons.get(0).episodes.get(0).seriesId);
    }
    @Test public void epgDecodesAndBoundsTimestamp() throws Exception {
        List<Programme> result = ProviderParser.epg(new JSONObject("{\"epg_listings\":[{\"title\":\"TmV3cw==\",\"start_timestamp\":1700000000,\"stop_timestamp\":1700003600},{\"title\":\"TmV3cw==\",\"start_timestamp\":1,\"stop_timestamp\":9}]}"));
        assertEquals(1, result.size()); assertEquals("News", result.get(0).title); assertEquals(1700003600000L, result.get(0).endsAtMs);
    }
    @Test public void scopeDeadlineUpdatesPreserveIdentityButCutOffAtBoundary() throws Exception {
        SourceGuard guard = new SourceGuard(); ProviderParser.Bootstrap b = ProviderParser.bootstrap(bootstrap(), NOW);
        long generation = guard.install(b); assertTrue(guard.active(generation, b.scope(), NOW));
        ProviderParser.Bootstrap shorter = ProviderParser.bootstrap(bootstrap().put("expiresAt", "2023-11-14T22:14:20.000Z"), NOW);
        assertEquals(generation, guard.install(shorter)); assertTrue(guard.active(generation, b.scope(), NOW + 59999));
        assertFalse(guard.active(generation, b.scope(), NOW + 60000));
    }
    @Test public void changingSourceOrSameVersionCredentialsInvalidatesOldGeneration() throws Exception {
        SourceGuard guard = new SourceGuard(); ProviderParser.Bootstrap first = ProviderParser.bootstrap(bootstrap(), NOW); long old = guard.install(first);
        guard.install(ProviderParser.bootstrap(bootstrap().put("password", "rotated"), NOW));
        assertFalse(guard.active(old, first.scope(), NOW));
        long current = guard.generation(); guard.clear(); assertFalse(guard.active(current, first.scope(), NOW));
    }
    @Test public void referenceUsesPersonalDecimalIdentityAndRequiresEpisodeParent() throws Exception {
        Item episode = new Item(Kind.EPISODE, "23", "Episode", "", "", "", "mkv", "account-a:source-a", "17", 1, 1, "");
        JSONObject ref = ProviderParser.reference(episode, "account-a:source-a");
        assertEquals("personal", ref.getString("source")); assertEquals("source-a", ref.getString("sourceVersion"));
        assertEquals("episode", ref.getString("kind")); assertEquals("17", ref.getString("seriesId")); assertEquals("23", ref.getString("id"));
        rejects(() -> ProviderParser.reference(new Item(Kind.EPISODE, "23", "Episode", "", "", "", "mp4", "account-a:source-a", "", 1, 1, ""), "account-a:source-a"));
    }
    @Test public void sourceChangeCannotReuseOldScopeEvenWithSameCredentials() throws Exception {
        SourceGuard guard = new SourceGuard(); ProviderParser.Bootstrap original = ProviderParser.bootstrap(bootstrap(), NOW); long old = guard.install(original);
        ProviderParser.Bootstrap replacement = ProviderParser.bootstrap(bootstrap().put("sourceVersion", "source-b"), NOW); guard.install(replacement);
        assertFalse(guard.active(old, original.scope(), NOW)); assertTrue(guard.active(guard.generation(), "account-a:source-b", NOW));
    }
    @Test public void catalogEnvelopeIsBoundedBeforeNormalization() throws Exception {
        JSONArray rows = new JSONArray(); for (int i=0; i<50001; i++) rows.put(JSONObject.NULL);
        rejects(() -> ProviderParser.catalog(Kind.LIVE, rows, categories("Live"), "a:v"));
    }
    @Test public void nestedProviderJsonIsBoundedAndTrailingDataIsRejected() throws Exception {
        StringBuilder input=new StringBuilder();for(int i=0;i<65;i++)input.append('[');input.append('0');for(int i=0;i<65;i++)input.append(']');
        rejects(() -> ProviderParser.parseJson(input.toString()));
        rejects(() -> ProviderParser.parseJson("{} {}"));
        assertEquals("[inside string]", ((JSONObject)ProviderParser.parseJson("{\"title\":\"[inside string]\"}")).getString("title"));
    }
    @Test public void oversizedEpisodeEnvelopeFailsClosed() throws Exception {
        JSONArray rows = new JSONArray(); for (int i=0; i<5001; i++) rows.put(new JSONObject());
        Item parent = new Item(Kind.SERIES, "17", "Series", "", "", "", "", "a:v", "", 0, 0, "");
        rejects(() -> ProviderParser.series(new JSONObject().put("episodes", new JSONObject().put("1", rows)), parent));
    }
}
