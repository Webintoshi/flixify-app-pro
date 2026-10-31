package vip.flixify.tv;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import vip.flixify.tv.TvModels.*;
public class CatalogFilterDataTest {
    Item item(String id,String title,String category,String name){return new Item(Kind.MOVIE,id,title,category,name,"","mp4","scope","",0,0,"");}
    Catalog fixture(){return new Catalog(Kind.MOVIE,Arrays.asList(item("1","İstanbul Gecesi","a","Drama"),item("2","Sessiz Deniz","b","Belgesel"),item("3","Deniz Yolu","a","Drama"),item("4","SINIR","c","Macera")),Arrays.asList(new Category("a","Drama"),new Category("a","Duplicate"),new Category("b","Belgesel"),new Category("z","Boş")));}
    @Test public void previewIntersectsCategoryAndTrimmedTurkishQuery(){
        Catalog c=fixture();assertEquals(2,CatalogFilterData.preview(c,"","  deniz ").count);assertEquals(Arrays.asList("Deniz Yolu"),CatalogFilterData.preview(c,"a","deniz").titles);
        assertEquals(1,CatalogFilterData.preview(c,"","İSTANBUL").count);assertEquals(1,CatalogFilterData.preview(c,"","sınır").count);assertEquals(0,CatalogFilterData.preview(c,"","sinir").count);
    }
    @Test public void categoryCountsRespectQueryAndMergeMissingIdsWithoutDuplicates(){
        List<CatalogFilterData.CategoryOption> r=CatalogFilterData.categories(fixture(),"deniz");assertEquals(5,r.size());assertEquals("",r.get(0).id);assertEquals("Tümü",r.get(0).title);assertEquals(2,r.get(0).count);
        assertEquals("Drama",r.get(1).title);assertEquals(1,r.get(1).count);assertEquals(1,r.get(2).count);assertEquals(0,r.get(3).count);assertEquals("c",r.get(4).id);assertEquals("Macera",r.get(4).title);
    }
    @Test public void previewCapsSamplesButCountsAllAndCollectionsAreImmutable(){
        List<Item> rows=new ArrayList<>();for(int n=0;n<40;n++)rows.add(item(""+n,"Film "+n,"a","Drama"));Catalog c=new Catalog(Kind.MOVIE,rows,Collections.emptyList());
        CatalogFilterData.SearchPreview p=CatalogFilterData.preview(c,"","");assertEquals(40,p.count);assertEquals(3,p.titles.size());
        try{p.titles.add("x");fail("Immutable preview");}catch(UnsupportedOperationException expected){}
        try{p.items.clear();fail("Immutable preview identities");}catch(UnsupportedOperationException expected){}
        try{CatalogFilterData.categories(c,"").clear();fail("Immutable categories");}catch(UnsupportedOperationException expected){}
    }
    @Test public void sameTitleInDifferentCategoriesKeepsTheMatchingItemIdentity(){
        Item first=item("one","Avengers","a","Drama"),second=item("two","Avengers","b","Belgesel");
        Catalog c=new Catalog(Kind.MOVIE,Arrays.asList(first,second),Collections.emptyList());
        CatalogFilterData.SearchPreview preview=CatalogFilterData.preview(c,"b","Avengers");
        assertEquals(1,preview.count);assertEquals(1,preview.items.size());assertSame(second,preview.items.get(0));
    }
    @Test public void emptyAndUncategorizedCatalogKeepsAllOptionAndCorrectMatching(){
        Catalog empty=new Catalog(Kind.MOVIE,Collections.emptyList(),Collections.emptyList());List<CatalogFilterData.CategoryOption> r=CatalogFilterData.categories(empty,"");assertEquals(1,r.size());assertEquals(0,r.get(0).count);
        Item i=item("1","Yeni Film","","");assertTrue(CatalogFilterData.matches(i,"","film"));assertFalse(CatalogFilterData.matches(i,"x","film"));
    }
}
