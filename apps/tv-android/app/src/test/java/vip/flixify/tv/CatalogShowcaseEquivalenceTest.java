package vip.flixify.tv;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import org.junit.Test;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

/** Catches changed daily order, duplicates/artwork preference, exclusion aliases or rail fallback. */
public class CatalogShowcaseEquivalenceTest {
    @Test public void seededMixedCatalogsPreserveEveryHeroAndRailItem(){
        for(int size:new int[]{0,1,2,6,12,18,61,400})for(long seed:new long[]{1,71,20261103}){
            List<Item> source=fixture(size,seed),before=new ArrayList<>(source);Set<String> failed=new HashSet<>();for(int i=0;i<source.size();i+=7)if(source.get(i)!=null)failed.add(source.get(i).key());
            for(String day:Arrays.asList(null,"","2026-11-02","2026-11-03")){
                assertResult(OriginalCatalogShowcase.home(source,day,failed),CatalogShowcase.home(source,day,failed));
                assertResult(OriginalCatalogShowcase.movies(source,day,failed),CatalogShowcase.movies(source,day,failed));
                assertResult(OriginalCatalogShowcase.series(source,day),CatalogShowcase.series(source,day));
            }
            assertOrder(before,source);
        }
    }
    @Test public void full12000MovieInventoryPreservesExactDailySelection(){
        List<Item> source=new ArrayList<>();String[] groups={"Aksiyon","Dram","Fantastik","Bilim Kurgu","Komedi","Macera","Suç","Belgesel"};
        String[] names={"Örümcek-Adam","Thor","Harry Potter","Fısıltı Adam","Telaşlı Baba","Yüzüklerin Efendisi","Yenilmezler","Sessiz Deniz"};
        for(int i=0;i<12000;i++)source.add(item(Kind.MOVIE,String.valueOf(i),names[i%8]+" · "+i,groups[i%8],i%10==0?2026:1980+i%46,i%4==0?"":"art"));
        for(String day:Arrays.asList("2026-11-02","2026-11-03"))assertResult(OriginalCatalogShowcase.movies(source,day),CatalogShowcase.movies(source,day));
    }
    @Test public void duplicateOccurrencesAndWhitespaceCategoriesKeepOriginalFallback(){
        Item noArt=item(Kind.MOVIE,"1","THOR"," Aksiyon\u00a0",2026,"\ufeff "),covered=item(Kind.MOVIE,"2","thor"," Aksiyon\u00a0",2026,"art"),other=item(Kind.MOVIE,"1","Different","Fantastik",2026,"art");
        List<Item> source=Arrays.asList(noArt,covered,other,noArt,covered,item(Kind.MOVIE,"3","Harry Potter","\ufeff",2026,"\u00a0"),item(Kind.SERIES,"3","Harry Potter","",2026,"art"),null);
        for(Set<String> failed:Arrays.asList(Collections.<String>emptySet(),Collections.singleton(noArt.key()),Collections.singleton(covered.key()))){assertResult(OriginalCatalogShowcase.movies(source,"day",failed),CatalogShowcase.movies(source,"day",failed));assertResult(OriginalCatalogShowcase.home(source,"day",failed),CatalogShowcase.home(source,"day",failed));}
    }
    @Test public void primitiveMovieTextAndWhitespaceFastpathsMatchOriginalUnicodeRules() throws Exception {
        List<String> values=new ArrayList<>(Arrays.asList("","a b"," a  b ","\tA\r\nB\f","\u0000 A \u0000","İıI ŞĞÇÖÜ","E\u0301 S\u0327","a\u0085b","\u0085a\u0085","\u00a0a\u00a0","\ufeffa\ufeff","😀１２٣४","K Å 𝐀 ﬃ"));
        StringBuilder bmp=new StringBuilder();for(int c=0;c<=65535;c++)bmp.append((char)c);values.add(bmp.toString());
        Random random=new Random(0xA5C117L);for(int n=0;n<600;n++){StringBuilder value=new StringBuilder();for(int i=0;i<40;i++)value.append((char)random.nextInt(65536));values.add(value.toString());}
        for(String method:Arrays.asList("movieText","trim","whitespace")){
            java.lang.reflect.Method original=OriginalCatalogShowcase.class.getDeclaredMethod(method,String.class),optimized=CatalogShowcase.class.getDeclaredMethod(method,String.class);original.setAccessible(true);optimized.setAccessible(true);
            for(String value:values)assertEquals(method,original.invoke(null,value),optimized.invoke(null,value));
        }
    }
    @Test public void normalizedFranchisePhraseBoundariesMatchFrozenRegexes() throws Exception {
        java.lang.reflect.Method normalize=OriginalCatalogShowcase.class.getDeclaredMethod("movieText",String.class);normalize.setAccessible(true);
        java.lang.reflect.Method match=CatalogShowcase.class.getDeclaredMethod("containsPhrase",String.class,String[].class);match.setAccessible(true);
        String[] edges={"","x","1"," ","x ","_","É","😀","\u0301"};Random random=new Random(0xF12A115EL);
        for(String name:Arrays.asList("MARVEL","FANTASY")){
            java.lang.reflect.Field originalField=OriginalCatalogShowcase.class.getDeclaredField(name),optimizedField=CatalogShowcase.class.getDeclaredField(name);originalField.setAccessible(true);optimizedField.setAccessible(true);
            java.util.regex.Pattern pattern=(java.util.regex.Pattern)originalField.get(null);String[] phrases=(String[])optimizedField.get(null);
            String expression=pattern.pattern();String[] originalPhrases=expression.substring(5,expression.length()-3).split("\\|");List<String> values=new ArrayList<>();
            for(String phrase:originalPhrases)for(String left:edges)for(String right:edges)values.add(left+phrase+right);
            for(int n=0;n<1200;n++){StringBuilder value=new StringBuilder();for(int i=0;i<20;i++)value.append((char)random.nextInt(65536));value.append(edges[random.nextInt(edges.length)]).append(originalPhrases[random.nextInt(originalPhrases.length)]).append(edges[random.nextInt(edges.length)]);for(int i=0;i<20;i++)value.append((char)random.nextInt(65536));values.add(value.toString());}
            for(String value:values){String normalized=(String)normalize.invoke(null,value);assertEquals(name+" "+normalized,pattern.matcher(normalized).find(),(Boolean)match.invoke(null,normalized,phrases));}
        }
    }
    private static List<Item> fixture(int count,long seed){
        Random random=new Random(seed);String[] names={"Thor","THOR","Harry Potter","Örümcek Adam","Yenilmez - Undisputed","Şehir","S\u0327ehir","A\u00a0 B","a b","Narnia","Alien"," ","😀"};
        String[] groups={"Aksiyon"," Aksiyon ","Fantastik","Bilim Kurgu - Fantastik Filmler","\u00a0","\ufeff","Dram","Aksiyon\u200b","TR | Aksiyon - Macera Filmleri","science fiction fantasy"};
        String[] artwork={""," ","\u00a0","\ufeff","art"," art "};List<Item> result=new ArrayList<>();
        for(int i=0;i<count;i++){
            if(i>0 && i%19==0){result.add(result.get(random.nextInt(result.size())));continue;}
            Kind kind=Kind.values()[random.nextInt(3)];String id=String.valueOf(random.nextInt(Math.max(1,count/2)));String title=names[random.nextInt(names.length)]+(i%3==0?"":" "+random.nextInt(17));
            result.add(item(kind,id,title,groups[random.nextInt(groups.length)],random.nextBoolean()?2026:2017,artwork[random.nextInt(artwork.length)]));
        }
        if(count>2)result.add(null);Collections.shuffle(result,random);return result;
    }
    private static Item item(Kind kind,String id,String title,String group,int year,String artwork){return new Item(kind,id,title,"g",group,artwork,"mp4","offline:source","",0,0,"",year);}
    private static void assertResult(OriginalCatalogShowcase.Result expected,CatalogShowcase.Result actual){assertOrder(expected.hero,actual.hero);assertEquals(expected.rails.size(),actual.rails.size());for(int i=0;i<expected.rails.size();i++){OriginalCatalogShowcase.Rail left=expected.rails.get(i);CatalogShowcase.Rail right=actual.rails.get(i);assertEquals(left.id,right.id);assertEquals(left.title,right.title);assertOrder(left.items,right.items);}}
    private static void assertOrder(List<Item> expected,List<Item> actual){assertEquals(expected.size(),actual.size());for(int i=0;i<expected.size();i++)assertSame("index "+i,expected.get(i),actual.get(i));}
}
