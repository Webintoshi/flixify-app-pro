package vip.flixify.tv.data;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.IOException;
import java.io.Reader;
import java.io.StringReader;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ProviderCatalogReaderTest {
    private JSONArray categories() throws Exception {return new JSONArray().put(new JSONObject().put("category_id","9").put("category_name","Filmler"));}
    private Catalog read(String rows,Kind kind)throws Exception{return ProviderCatalogReader.read(new StringReader(rows),kind,categories(),"fixture:source");}
    @Test public void preservesExistingFiltersDuplicatesNumericIdsAndTransportRules()throws Exception{
        String rows="[{\"stream_id\":12.0,\"name\":\"Film\",\"category_id\":\"9\",\"container_extension\":\"mp4\",\"cover\":\"https://images.test/a.jpg\"},{\"stream_id\":12,\"name\":\"Duplicate\",\"category_id\":9,\"container_extension\":\"mkv\"},{\"stream_id\":13,\"name\":\"Hidden\",\"category_id\":10,\"container_extension\":\"mp4\"},false,null,[]]";
        Catalog result=read(rows,Kind.MOVIE);Catalog old=ProviderParser.catalog(Kind.MOVIE,new JSONArray(rows),categories(),"fixture:source");
        assertEquals(1,result.items.size());assertEquals(old.items.get(0).key(),result.items.get(0).key());assertEquals("https://images.test/a.jpg",result.items.get(0).artwork);
        assertEquals("ts",read("[{\"stream_id\":1,\"name\":\"Kanal\"}]",Kind.LIVE).items.get(0).extension);
        assertEquals("m3u8",read("[{\"stream_id\":1,\"name\":\"Kanal\",\"container_extension\":\"invalid\"}]",Kind.LIVE).items.get(0).extension);
    }
    @Test public void handlesLargeLazyCatalogueWithoutMaterializingUnrelatedMetadata()throws Exception{
        String unused=new String(new char[512]).replace('\0','x');final int count=18000;
        Reader source=new Reader(){int row,index;String part="[";boolean ended;
            public int read(char[] out,int offset,int length){int n=0;while(n<Math.min(length,1024)){
                if(index==part.length()){if(row<count){part=(row==0?"":",")+"{\"stream_id\":"+(++row)+",\"name\":\"Film "+row+"\",\"category_id\":9,\"container_extension\":\"mp4\",\"unused\":{\"blob\":\""+unused+"\"}}";index=0;}else if(!ended){part="]";index=0;ended=true;}else return n==0?-1:n;}
                out[offset+n++]=part.charAt(index++);
            }return n;}public void close(){}};
        long start=System.nanoTime();Catalog result=ProviderCatalogReader.read(source,Kind.MOVIE,categories(),"fixture:source");
        assertEquals(count,result.items.size());assertEquals("18000",result.items.get(count-1).id);
        System.out.println("STREAMED_CATALOGUE rows="+count+" elapsedMs="+(System.nanoTime()-start)/1000000);
    }
    @Test public void rejectsMalformedEnvelopeExcessiveNestingAndTrailingData()throws Exception{
        StringBuilder nested=new StringBuilder();for(int i=0;i<65;i++)nested.append('[');nested.append('0');for(int i=0;i<65;i++)nested.append(']');
        for(String raw:new String[]{"{}","[{}] {}","[}","[{\"unused\":"+nested+"}]"})try{read(raw,Kind.LIVE);fail("Malformed catalogue accepted");}catch(ProviderParser.Invalid|IOException expected){}
        JSONArray cats=categories().put(new JSONObject().put("category_id","9").put("category_name","Other"));
        try{ProviderCatalogReader.read(new StringReader("[]"),Kind.MOVIE,cats,"fixture:source");fail();}catch(ProviderParser.Invalid expected){}
    }
    @Test public void exactContainerDepthBoundaryIncludesRootAndRowEvenWhenEmpty()throws Exception{
        for(int count:new int[]{62,63}){StringBuilder nested=new StringBuilder();for(int i=0;i<count;i++)nested.append('[');for(int i=0;i<count;i++)nested.append(']');String raw="[{\"unused\":"+nested+"}]";
            if(count==62)assertTrue(read(raw,Kind.LIVE).items.isEmpty());
            else try{read(raw,Kind.LIVE);fail("65 containers accepted");}catch(ProviderParser.Invalid expected){}
        }
        assertEquals("m3u8",read("[{\"stream_id\":1,\"name\":\"Kanal\",\"container_extension\":{}}]",Kind.LIVE).items.get(0).extension);
    }
    private Reader hugeField(String field){
        String prefix="[{\"stream_id\":1,\"name\":\"Kanal\",\""+field+"\":\"",suffix="\",\"cover\":\"https://images.test/fallback.jpg\"}]";
        return new Reader(){int position;public int read(char[] out,int offset,int length){int written=0;int padding=2*1024*1024,total=prefix.length()+padding+suffix.length();while(written<length && position<total){out[offset+written++]=position<prefix.length()?prefix.charAt(position):position<prefix.length()+padding?'x':suffix.charAt(position-prefix.length()-padding);position++;}return written==0?-1:written;}public void close(){}};
    }
    @Test public void hugeKnownAndUnknownStringsStayBoundedWithoutChangingExplicitExtensionOrArtworkRules()throws Exception{
        Catalog ignored=ProviderCatalogReader.read(hugeField("unused"),Kind.LIVE,categories(),"fixture:source");assertEquals(1,ignored.items.size());
        Catalog named=ProviderCatalogReader.read(hugeField("name"),Kind.LIVE,categories(),"fixture:source");assertTrue(named.items.isEmpty());
        Catalog extension=ProviderCatalogReader.read(hugeField("container_extension"),Kind.LIVE,categories(),"fixture:source");assertEquals("m3u8",extension.items.get(0).extension);
        Catalog artwork=ProviderCatalogReader.read(hugeField("stream_icon"),Kind.LIVE,categories(),"fixture:source");assertEquals("",artwork.items.get(0).artwork);
    }
    @Test public void preservesInputCancellationWithoutPublishingPartialCatalogue()throws Exception{
        IOException cancelled=new IOException("fixture cancellation");Reader source=new Reader(){public int read(char[] out,int offset,int length)throws IOException{throw cancelled;}public void close(){}};
        try{ProviderCatalogReader.read(source,Kind.LIVE,categories(),"fixture:source");fail();}catch(IOException expected){assertSame(cancelled,expected);}
    }
    @Test public void countsSkippedValuesInFiftyThousandRowLimit()throws Exception{
        StringBuilder raw=new StringBuilder("[");for(int i=0;i<50001;i++){if(i>0)raw.append(',');raw.append("null");}raw.append(']');
        try{read(raw.toString(),Kind.LIVE);fail();}catch(ProviderParser.Invalid expected){}
    }
}
