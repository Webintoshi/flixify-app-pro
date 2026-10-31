package vip.flixify.tv.data;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
import org.junit.Test;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

public class LiveChannelCurationTest {
    private JSONObject fixtures()throws Exception{
        try(InputStream in=getClass().getResourceAsStream("/live-channel-curation.json")){
            assertNotNull("Shared TS/Java fixture resource",in);ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
            while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
        }
    }
    private LiveChannelCuration.Channel channel(JSONObject r)throws Exception{return new LiveChannelCuration.Channel(r.getString("id"),r.getString("title"),r.optString("groupTitle",""),r.has("sourceTitle")?r.getString("sourceTitle"):null,r.optString("providerId",r.getString("id")),!Boolean.FALSE.equals(r.opt("available")),!Boolean.FALSE.equals(r.opt("playbackAllowed")),Boolean.TRUE.equals(r.opt("lookupFailed")));}
    @Test public void sharedSelectionCasesMatchInBothOrdersAndAfterRepeatedProjection()throws Exception{
        JSONArray cases=fixtures().getJSONArray("cases");
        for(int i=0;i<cases.length();i++){
            JSONObject c=cases.getJSONObject(i);String name=c.getString("name");List<LiveChannelCuration.Channel> input=new ArrayList<>();JSONArray rows=c.getJSONArray("rows");for(int r=0;r<rows.length();r++)input.add(channel(rows.getJSONObject(r)));
            Set<String> excluded=new HashSet<>();JSONArray ids=c.optJSONArray("excludedIds");if(ids!=null)for(int n=0;n<ids.length();n++)excluded.add(ids.getString(n));
            for(int order=0;order<2;order++){
                LiveChannelCuration.Selection selected=LiveChannelCuration.curateChannels(input,excluded);JSONArray expected=c.getJSONArray("expectedItems");assertEquals(name,expected.length(),selected.items.size());
                for(int n=0;n<expected.length();n++){assertEquals(name,expected.getJSONObject(n).getString("id"),selected.items.get(n).id);assertEquals(name,expected.getJSONObject(n).getString("title"),selected.items.get(n).title);}
                JSONObject aliases=c.getJSONObject("expectedAliases");Map<String,String> wanted=new HashMap<>();for(Iterator<String> keys=aliases.keys();keys.hasNext();){String key=keys.next();wanted.put(key,aliases.getString(key));}assertEquals(name,wanted,selected.canonicalById);
                LiveChannelCuration.Selection repeated=LiveChannelCuration.curateChannels(selected.items,excluded);assertEquals(name,selected.items.size(),repeated.items.size());
                for(int n=0;n<selected.items.size();n++){assertEquals(name,selected.items.get(n).id,repeated.items.get(n).id);assertEquals(name,selected.items.get(n).title,repeated.items.get(n).title);assertEquals(name,selected.items.get(n).sourceTitle,repeated.items.get(n).sourceTitle);}
                Collections.reverse(input);
            }
        }
    }
    @Test public void sharedDescriptionsClassifyOriginalLabelsBeforeRemovingTechnicalNotes()throws Exception{
        JSONArray cases=fixtures().getJSONArray("descriptorCases");
        for(int i=0;i<cases.length();i++){
            JSONObject c=cases.getJSONObject(i),e=c.getJSONObject("expected");LiveChannelCuration.Description d=LiveChannelCuration.describe(c.getString("title"),c.optString("groupTitle",""));String name=c.getString("title");
            assertEquals(name,e.getString("displayName"),d.displayName);assertEquals(name,e.isNull("countryCode")?null:e.getString("countryCode"),d.countryCode);assertEquals(name,e.getString("quality"),d.quality);
            assertEquals(name,e.getBoolean("hevc"),d.hevc);assertEquals(name,e.getBoolean("eventOnly"),d.eventOnly);assertEquals(name,e.getBoolean("lowBandwidth"),d.lowBandwidth);assertEquals(name,e.getBoolean("raw"),d.raw);
        }
    }
    @Test public void nativeProjectionPreservesSelectedIdentityAndRawRecords() {
        Item hd=new Item(Kind.LIVE,"11","TR | ATV HD","7","TR | Ulusal","https://images.test/hd.png","m3u8","a:s","",0,0,"HD description");
        Item fhd=new Item(Kind.LIVE,"12","TR | Atv FHD","8","TR | Spor","https://images.test/fhd.png","ts","a:s","",0,0,"Selected description");
        Catalog raw=new Catalog(Kind.LIVE,Arrays.asList(hd,fhd),Arrays.asList(new Category("7","TR | Ulusal"),new Category("8","TR | Spor")));
        LiveChannelCuration.Projection p=LiveChannelCuration.curate(raw,Collections.emptySet());Item selected=p.resolve("11");
        assertEquals("12",selected.id);assertEquals("ATV",selected.title);assertEquals("TR | Atv FHD",selected.sourceTitle);assertEquals(fhd.scope,selected.scope);assertEquals(fhd.extension,selected.extension);assertEquals(fhd.categoryId,selected.categoryId);assertEquals(fhd.artwork,selected.artwork);assertEquals(fhd.description,selected.description);
        assertEquals(Arrays.asList("11","12"),p.aliases("12"));assertSame(hd,p.original("11"));assertEquals(2,raw.items.size());assertEquals("TR | ATV HD",raw.items.get(0).title);assertNotSame(fhd,selected);
        LiveChannelCuration.Projection repeated=LiveChannelCuration.curate(p.catalog,Collections.emptySet());assertEquals("TR | Atv FHD",repeated.resolve("12").sourceTitle);
        try{p.catalog.items.clear();fail("Projection must be immutable");}catch(UnsupportedOperationException expected){}
    }
}
