package vip.flixify.tv.data;

import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;
import vip.flixify.tv.TvModels.*;

public class LiveChannelLineupTest {
    private Item channel(String id,String title,String group){return new Item(Kind.LIVE,id,title,"provider",group,"","ts","scope","",0,0,"");}
    private List<String> ids(List<Item> items){List<String> result=new ArrayList<>();for(Item item:items)result.add(item.id);return result;}
    @Test public void turkishStationsFollowWebsiteReferenceWhileForeignOrderAndIdentityRemain(){
        Item foreign=channel("9","BBC News","UK:HABER"),foreign2=channel("8","ZDF","DE:ULUSAL");
        Item star=channel("3","Star TV","TR:ULUSAL"),trt=channel("1","TRT 1","TR:ULUSAL"),atv=channel("4","ATV","TR:ULUSAL"),kanal=channel("2","Kanal D","TR:ULUSAL"),bein=channel("7","BEIN Sport 1","TR:BEINSPORT");
        List<Item> result=LiveChannelLineup.sort(Arrays.asList(foreign,bein,atv,star,foreign2,kanal,trt));
        assertEquals(Arrays.asList("1","2","3","4","7","9","8"),ids(result));assertSame(trt,result.get(0));assertSame(foreign,result.get(5));
    }
    @Test public void sportsAndAliasesUseSameSlotsAsWeb(){
        Item ssport=channel("3","S Sport 1","TR:S-SPORT PLUS"),bein=channel("2","BEIN Sport 1","TR:BEINSPORT"),trt=channel("1","TRT Spor","TR:SPOR");
        assertEquals(Arrays.asList("1","2","3"),ids(LiveChannelLineup.sort(Arrays.asList(ssport,bein,trt))));
    }
    @Test public void classificationUsesSourceCountryAndFriendlyCategory(){
        assertEquals("de",LiveChannelLineup.info(channel("1","ATV","DE:ULUSAL")).countryId);
        assertEquals("sports",LiveChannelLineup.info(channel("2","BEIN Sport 1","TR:BEINSPORT")).categoryId);
        assertEquals("news",LiveChannelLineup.info(channel("3","CNN Türk","TR:HABER")).categoryId);
        assertEquals("Türkiye",LiveChannelLineup.countryTitle("tr"));
        assertEquals("arabic",LiveChannelLineup.info(channel("4","QA | beIN Sports 1","Arabic Sports")).countryId);
    }
    @Test public void sortingDoesNotInventRemoveOrMutateSources(){
        List<Item> input=Arrays.asList(channel("11","Bilinmeyen","XX:OTHER"),channel("12","TRT 1","TR:ULUSAL"));
        List<Item> result=LiveChannelLineup.sort(input);assertEquals(2,result.size());assertEquals("11",input.get(0).id);assertEquals("12",result.get(0).id);assertEquals("provider",result.get(0).categoryId);
    }
}
