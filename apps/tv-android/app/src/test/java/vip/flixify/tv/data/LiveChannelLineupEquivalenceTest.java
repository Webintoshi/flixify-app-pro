package vip.flixify.tv.data;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import org.junit.Test;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Catches altered numeric/collation ties, foreign stability, or fold/search semantics. */
public class LiveChannelLineupEquivalenceTest {
    @Test public void seededUnicodeAndNumericChannelsExactlyMatchOriginalOrder(){
        String[] text={"İstanbul","Istanbul","ıstanbul","İ","I","ı","Şehir","S\u0327ehir","Écho","E\u0301cho","Bölge","BÖLGE"," ","-","'","\u00ad","\u0301","\u200b","\ufeff","😀","𝟙","٠","०","１","a","Z"};
        String[] digits={"0","00","000","01","1","001","2","10","00010","9999999999999999999999999999999999","٠١","१२","１２","\u0660\u0660","1٠1"};
        String[] groups={"TR:ULUSAL","Türkiye Haber","Türkiye Spor","Türkiye Radyo","DE:ULUSAL","UK News","Arabic Sports","XX:Other"};
        Random random=new Random(0x51A7C011L);List<Item> source=new ArrayList<>();
        for(int i=0;i<360;i++){
            String name=text[random.nextInt(text.length)]+digits[random.nextInt(digits.length)]+text[random.nextInt(text.length)]+digits[random.nextInt(digits.length)];
            source.add(channel(i%7==0?"000"+i:digits[random.nextInt(digits.length)]+i,name,groups[i%groups.length]));
        }
        for(String digit:digits)for(String prefix:Arrays.asList("Kanal ","Kanal-","İ","","\u0301"))source.add(channel(digit,prefix+digit,"TR:ULUSAL"));
        source.add(source.get(0));source.add(channel("same","Aynı 0001","TR:ULUSAL"));source.add(channel("same","Aynı 1","TR:ULUSAL"));
        for(Item item:source){
            OriginalLiveChannelLineup.Info expected=OriginalLiveChannelLineup.info(item);LiveChannelLineup.Info actual=LiveChannelLineup.info(item);
            assertEquals(expected.countryId,actual.countryId);assertEquals(expected.categoryId,actual.categoryId);assertEquals(expected.name,actual.name);assertEquals(expected.id,actual.id);assertEquals(expected.section,actual.section);assertEquals(expected.position,actual.position,0);
        }
        for(int pass=0;pass<12;pass++){
            Collections.shuffle(source,random);List<Item> before=new ArrayList<>(source);
            assertOrder(OriginalLiveChannelLineup.sort(source),LiveChannelLineup.sort(source));assertOrder(before,source);
        }
    }
    @Test public void reviewedSlotsAliasesAndForeignEntriesKeepExactReferences(){
        List<Item> source=new ArrayList<>();String[] names={"TRT 1","Kanal D","Star TV","ATV","Show TV","NOW","TV8","TV8,5","TV2","Sözcü SZC TV","BEIN Sport 1","Tivibu Spor 0002","S Sport 1","Nat Geo Wild","Disney JR","TRT 3 TBMM TV","Power Türk TV"};
        int n=0;for(String name:names)source.add(channel(String.valueOf(n++),name,"TR:ULUSAL"));
        source.add(channel("foreign-2","ZDF","DE:ULUSAL"));source.add(channel("foreign-1","BBC News","UK News"));source.add(source.get(3));Collections.reverse(source);
        assertOrder(OriginalLiveChannelLineup.sort(source),LiveChannelLineup.sort(source));
    }
    @Test public void unicodeFoldAndSearchMatchOriginalExpressions(){
        List<String> samples=new ArrayList<>(Arrays.asList(null,"","İıIŞĞÇÖÜ", "É E\u0301 Ş S\u0327", "１２٣४😀\ud800\udfff", "TRT 1 | Bölge 12000", "\u00ad\u200b\ufeff"));
        Random random=new Random(0xF01D51L);for(int i=0;i<500;i++){StringBuilder value=new StringBuilder();for(int j=0;j<35;j++)value.append((char)random.nextInt(65536));samples.add(value.toString());}
        for(String sample:samples){String expected=Normalizer.normalize(sample==null?"":sample,Normalizer.Form.NFKD).replaceAll("[\\u0300-\\u036f]","").replace('ı','i').toLowerCase(Locale.ROOT);assertEquals(expected,LiveChannelLineup.fold(sample));assertEquals(expected.replaceAll("[^\\p{L}\\p{N}]",""),LiveChannelLineup.search(sample));}
    }
    @Test public void rawNaturalComparatorSignsMatchIncludingDigitIgnorableTransitions() throws Exception {
        java.text.Collator collator=java.text.Collator.getInstance(new Locale("tr","TR"));collator.setStrength(java.text.Collator.PRIMARY);
        Class<?> keyType=Class.forName("vip.flixify.tv.data.LiveChannelLineup$NaturalKey");
        java.lang.reflect.Constructor<?> constructor=keyType.getDeclaredConstructor(String.class,java.text.Collator.class,java.util.Map.class);constructor.setAccessible(true);
        java.lang.reflect.Method original=OriginalLiveChannelLineup.class.getDeclaredMethod("natural",String.class,String.class,java.text.Collator.class);original.setAccessible(true);
        java.lang.reflect.Method optimized=LiveChannelLineup.class.getDeclaredMethod("natural",keyType,keyType,java.text.CollationKey.class);optimized.setAccessible(true);
        List<String> values=new ArrayList<>(Arrays.asList("","0","00","0001","1","01x","1x","000x","0x0","x0","x00","x0001","x1","0-","-0","0\u00ad","\u00ad0","0\u0301","\u03010","\u200b0","0\u200b","\u0301","-","İ","I","ı","i","Ş","S\u0327","😀0","0😀","٠","٠1","0٠","१२","１２","999999999999999999999999999999999"));
        Random random=new Random(0xDA741L);String[] pieces={"0","00","1","12","٠","१२","１２","-","\u00ad","\u0301","\u200b","I","ı","İ","x","😀"};
        for(int n=0;n<80;n++)values.add(pieces[random.nextInt(pieces.length)]+pieces[random.nextInt(pieces.length)]+pieces[random.nextInt(pieces.length)]);
        java.util.Map<String,java.text.CollationKey> texts=new java.util.HashMap<>();List<Object> keys=new ArrayList<>();for(String value:values)keys.add(constructor.newInstance(value,collator,texts));
        java.text.CollationKey empty=collator.getCollationKey("");
        for(int i=0;i<values.size();i++)for(int j=0;j<values.size();j++){
            int expected=(Integer)original.invoke(null,values.get(i),values.get(j),collator),actual=(Integer)optimized.invoke(null,keys.get(i),keys.get(j),empty);
            assertEquals("raw pair "+i+","+j,Integer.signum(expected),Integer.signum(actual));
        }
    }
    private static Item channel(String id,String title,String group){return new Item(Kind.LIVE,id,title,"provider",group,"","ts","offline:source","",0,0,"",title,0);}
    private static void assertOrder(List<Item> expected,List<Item> actual){assertEquals(expected.size(),actual.size());for(int i=0;i<expected.size();i++)assertSame("index "+i+" expected="+expected.get(i).title+" actual="+actual.get(i).title,expected.get(i),actual.get(i));}
}
