package vip.flixify.tv.data;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import org.junit.Test;
import static org.junit.Assert.*;

/** The lightweight lineup path must share exactly the original names/countries. */
public class LiveChannelCurationEquivalenceTest {
    @Test public void fullDescriptionsAndPresentationLabelsMatchIndependentOriginal(){
        String[] titles={null,"","TRT 1 HD","[FuboTV] UK • BBC News HD","TRFHD | TRT 1 HEVC","VIP beIN Sports 1 FHD (Sadece maç zamanı)","TR | S Sport 1 (English)","DE | TRT 4K","beIN Sports 4K","EXXEN 2 [720p]","Nat Geo Wild HD","İstanbul Şehir","ꜰʜᴅ TRT 1","Name [İstanbulMarmara]","TRT 1 HD7/24canlı","<br>ATV\u0000HD","Kanal 1 [live events]","Name (low bandwidth)","Name [unknown note]","😀１２٣४"};
        String[] groups={null,"","TR:ULUSAL","Türkiye Ulusal","Türkiye Spor","UK News","DE:HABER","Colombia Sports","Arabic Sports","Kurdish Music","Unknown Region","7/24","Bilim Kurgu","Türkiye Radyo"};
        Map<String,LiveChannelCuration.GroupDetails> context=new HashMap<>();
        for(String title:titles)for(String group:groups)assertDescription(title,group,context);
        Random random=new Random(0xC0A710L);
        for(int i=0;i<200;i++){String title=String.valueOf(titles[random.nextInt(titles.length)])+" · "+i+(i%2==0?" (FHD)":" [Türkçe]");assertDescription(title,groups[random.nextInt(groups.length)],context);}
    }
    private static void assertDescription(String title,String group,Map<String,LiveChannelCuration.GroupDetails> context){
        OriginalLiveChannelCuration.Description expected=OriginalLiveChannelCuration.describe(title,group);
        LiveChannelCuration.Description actual=LiveChannelCuration.describe(title,group);
        assertEquals(expected.displayName,actual.displayName);assertEquals(expected.groupKey,actual.groupKey);assertEquals(expected.countryCode,actual.countryCode);assertEquals(expected.quality,actual.quality);
        assertEquals(expected.hevc,actual.hevc);assertEquals(expected.eventOnly,actual.eventOnly);assertEquals(expected.lowBandwidth,actual.lowBandwidth);assertEquals(expected.raw,actual.raw);
        LiveChannelCuration.Description label=LiveChannelCuration.describeForLineup(title,group,context);assertEquals(expected.displayName,label.displayName);assertEquals(expected.countryCode,label.countryCode);
    }
}
