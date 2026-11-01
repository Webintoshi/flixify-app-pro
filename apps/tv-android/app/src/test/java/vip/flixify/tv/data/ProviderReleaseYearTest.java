package vip.flixify.tv.data;

import java.io.StringReader;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;

public class ProviderReleaseYearTest {
    private JSONArray categories()throws Exception{return new JSONArray().put(new JSONObject().put("category_id","9").put("category_name","Filmler"));}
    private String rows(){return "[{\"stream_id\":1,\"name\":\"Film (2026)\",\"category_id\":9,\"container_extension\":\"mp4\",\"year\":2025},{\"stream_id\":2,\"name\":\"Conflict (2026)\",\"category_id\":9,\"container_extension\":\"mp4\",\"year\":2026,\"release_date\":\"2025-01-01\"},{\"stream_id\":3,\"name\":\"Metadata only\",\"category_id\":9,\"container_extension\":\"mp4\",\"releaseDate\":\"2026-10-31\"},{\"stream_id\":4,\"name\":\"Terminal (2026)\",\"category_id\":9,\"container_extension\":\"mp4\"}]";}
    private void evidence(Catalog result){assertEquals(4,result.items.size());assertEquals(2025,result.items.get(0).releaseYear);assertEquals(0,result.items.get(1).releaseYear);assertEquals(2026,result.items.get(2).releaseYear);assertEquals(2026,result.items.get(3).releaseYear);}
    @Test public void directNormalizationCarriesConflictingExplicitEvidence()throws Exception{evidence(ProviderParser.catalog(Kind.MOVIE,new JSONArray(rows()),categories(),"account:source"));}
    @Test public void streamingNormalizationRetainsAllFiveReleaseFields()throws Exception{
        evidence(ProviderCatalogReader.read(new StringReader(rows()),Kind.MOVIE,categories(),"account:source"));
        for(String field:new String[]{"year","release_year","releaseYear","releaseDate","release_date"}){
            Object value=field.startsWith("releaseD") || field.equals("release_date")?"2025-01-01":2025;
            JSONObject row=new JSONObject().put("series_id",7).put("name","Series (2026)").put(field,value);
            Catalog result=ProviderCatalogReader.read(new StringReader(new JSONArray().put(row).toString()),Kind.SERIES,categories(),"account:source");assertEquals(field,2025,result.items.get(0).releaseYear);
        }
    }
    @Test public void malformedExplicitFieldsSuppressFallbackWithoutWeakeningRowValidation()throws Exception{
        for(Object value:new Object[]{false,new JSONObject(),new JSONArray(),"2026x",2026.5}){
            JSONObject row=new JSONObject().put("stream_id",1).put("name","Film (2026)").put("category_id",9).put("container_extension","mp4").put("year",value);
            assertEquals(0,ProviderCatalogReader.read(new StringReader(new JSONArray().put(row).toString()),Kind.MOVIE,categories(),"account:source").items.get(0).releaseYear);
        }
        Catalog live=ProviderParser.catalog(Kind.LIVE,new JSONArray().put(new JSONObject().put("stream_id",7).put("name","Channel (2026)").put("year",2026)),categories(),"account:source");assertEquals(0,live.items.get(0).releaseYear);
    }
}
