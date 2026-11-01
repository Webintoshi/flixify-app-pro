package vip.flixify.tv;

import org.junit.Test;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;
import java.util.HashMap;
import java.util.Map;

public class CatalogReleaseYearTest {
    @Test public void legacyItemsUseOnlyAnUnambiguousTerminalReleaseMarker() throws Exception {
        Item item=new Item(Kind.MOVIE,"1","Film (2026)","1","Filmler","","mp4","account:source","",0,0,"");
        assertEquals(2026,item.releaseYear);
        assertEquals(2026,CatalogReleaseYear.title("2001: Bir Uzay Macerası (2026)"));
        assertEquals(2012,CatalogReleaseYear.title("2026 Gün (2012)"));
        assertEquals(2026,CatalogReleaseYear.title("Film [2026]  "));
        assertEquals(2026,CatalogReleaseYear.title("Film (２０２６)"));
        for(String title:new String[]{"2026","Film 2026","Film (2026) Fragman","Film (2025) (2026)","Film (20260)","Film [2026)"})assertEquals(title,0,CatalogReleaseYear.title(title));
    }
    private Map<String,Object> evidence(Object... pairs){Map<String,Object> result=new HashMap<>();for(int n=0;n<pairs.length;n+=2)result.put((String)pairs[n],pairs[n+1]);return result;}
    @Test public void explicitEvidenceWinsAndConflictsNeverFallBackToTheTitle(){
        assertEquals(2025,CatalogReleaseYear.fromMetadata(evidence("year",2025),"Film (2026)"));
        assertEquals(2026,CatalogReleaseYear.fromMetadata(evidence("release_year"," 2026 "),"Film"));
        assertEquals(2026,CatalogReleaseYear.fromMetadata(evidence("releaseYear",2026d,"release_date","2026-01-01"),"Film"));
        assertEquals(0,CatalogReleaseYear.fromMetadata(evidence("year",2025,"releaseDate","2026-01-01"),"Film (2026)"));
        for(Object invalid:new Object[]{"2026x","2.026e3",new HashMap<>(),true,2026.1,0,1899,2100,Double.NaN,Double.POSITIVE_INFINITY})assertEquals(String.valueOf(invalid),0,CatalogReleaseYear.fromMetadata(evidence("year",invalid),"Film (2026)"));
        Item conflicted=new Item(Kind.MOVIE,"1","Film (2026)","1","Filmler","","mp4","account:source","",0,0,"",0);
        assertEquals(0,conflicted.releaseYear);
    }
    @Test public void datesValidateTheActualCalendarAndStrictTimestampSyntax(){
        for(String field:new String[]{"releaseDate","release_date"}){
            assertEquals(2026,CatalogReleaseYear.fromMetadata(evidence(field,"2026-10-31"),"Film"));
            assertEquals(2026,CatalogReleaseYear.fromMetadata(evidence(field,"2026-01-01T00:30:00+03:00"),"Film"));
            assertEquals(2024,CatalogReleaseYear.fromMetadata(evidence(field,"2024-02-29T12:34:56.123Z"),"Film"));
            for(Object invalid:new Object[]{"2026-02-29","2026-02-30","2026-13-01","2026-00-01","2026-01-00","2026-01-01T25:00:00Z","2026-01-01junk",2026,"2026-01-01T12:00:00","2026-01-01T12:00:00+24:00"})assertEquals(String.valueOf(invalid),0,CatalogReleaseYear.fromMetadata(evidence(field,invalid),"Film (2026)"));
        }
    }
    @Test public void absentEvidenceAndNonReleaseDatesDoNotPromoteUnknownTitles(){
        assertEquals(2026,CatalogReleaseYear.fromMetadata(evidence("year"," \u00a0","releaseDate",null),"Film (2026)"));
        assertEquals(2016,CatalogReleaseYear.fromMetadata(evidence("added","2026-01-01","last_modified","2026-01-01"),"Film (2016)"));
        assertEquals(0,CatalogReleaseYear.fromMetadata(evidence("added","2026-01-01"),"Film"));
    }
}
