package vip.flixify.tv.data;

import java.io.IOException;
import java.io.Reader;
import java.io.StringReader;
import org.junit.Test;
import static org.junit.Assert.*;

public class BoundedJsonInputTest {
    private String all(Reader reader)throws IOException {
        StringBuilder result=new StringBuilder();char[] chunk=new char[317];int count;
        while((count=reader.read(chunk))!=-1)result.append(chunk,0,count);
        return result.toString();
    }
    private String repeat(String value,int count){StringBuilder result=new StringBuilder(value.length()*count);for(int n=0;n<count;n++)result.append(value);return result.toString();}
    private void text(String expected,String actual){assertEquals("Output length",expected.length(),actual.length());assertTrue("Output content",expected.equals(actual));}
    @Test public void replacesAnOversizedLazyStringAndPreservesTheNextField()throws Exception {
        Lazy input=new Lazy("[{\"unused\":\"",2*1024*1024,"\",\"next\":\"ok\"}]");
        text("[{\"unused\":false,\"next\":\"ok\"}]",all(new BoundedJsonInput(input)));
        assertTrue(input.position>2*1024*1024);
    }
    @Test public void allowsTheExactRawStringBoundaryAndReplacesOnlyTheLargerToken()throws Exception {
        String content=repeat("x",65536);
        text("[\""+content+"\"]",all(new BoundedJsonInput(new StringReader("[\""+content+"\"]"))));
        text("[false,\"small\"]",all(new BoundedJsonInput(new StringReader("[\""+content+"x\",\"small\"]"))));
    }
    @Test public void countsUnicodeEscapesByRawCharactersAndValidatesThem()throws Exception {
        String content=repeat("\\u0041",10922)+"abcd";
        assertEquals(65536,content.length());
        text("[\""+content+"\"]",all(new BoundedJsonInput(new StringReader("[\""+content+"\"]"))));
        text("[false]",all(new BoundedJsonInput(new StringReader("[\""+content+"e\"]"))));
    }
    @Test public void rejectsInvalidEscapesAndControlsEvenAfterDiscardingALargeToken()throws Exception {
        for(String tail:new String[]{"\\q\"}]","\\u00x0\"}]","\n\"}]","\\u00","\\"}) {
            try{all(new BoundedJsonInput(new Lazy("[{\"unused\":\"",2*1024*1024,tail)));fail("Malformed oversized string was accepted");}
            catch(IOException expected){}
        }
    }
    @Test public void preservesAnUnderlyingCancellationExceptionDuringDiscard()throws Exception {
        IOException cancelled=new IOException("fixture cancellation");
        Reader input=new Lazy("[\"",100000,""){@Override public int read(char[] out,int offset,int length)throws IOException{int count=super.read(out,offset,length);if(count<0)throw cancelled;return count;}};
        try{all(new BoundedJsonInput(input));fail();}catch(IOException expected){assertSame(cancelled,expected);}
    }
    @Test public void rejectsAPrimitiveBeforeReadingItsFullLargeBody()throws Exception {
        Lazy input=new Lazy("[",2*1024*1024,"]",'9');
        try{all(new BoundedJsonInput(input));fail("Oversized numeric token accepted");}catch(IOException expected){}
        assertTrue("Primitive cap fails before consuming the entire response",input.position<=8192);
        String numeric=repeat("9",1024);
        assertEquals("["+numeric+"]",all(new BoundedJsonInput(new StringReader("["+numeric+"]"))));
    }
    @Test public void keepsOrdinaryInputCharacterForCharacter()throws Exception {
        String input=" \n{\"x\":[-2.5e+3,true,false,null],\"name\":\"İstanbul 🎬\",\"escapes\":\"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\"}\r\n";
        assertEquals(input,all(new BoundedJsonInput(new StringReader(input))));
    }
    @Test public void validatesMalformedSmallStringsToo()throws Exception {
        for(String input:new String[]{"[\"\\x\"]","[\"raw\tcontrol\"]","[\"\\u123z\"]","[\"unfinished"}) {
            try{all(new BoundedJsonInput(new StringReader(input)));fail();}catch(IOException expected){}
        }
    }
    @Test public void readsOneCharacterOffsetsAndZeroLengthWithoutClosingTheOwner()throws Exception {
        int[] closes={0};StringReader owner=new StringReader("[\"ok\"]"){@Override public void close(){closes[0]++;super.close();}};
        BoundedJsonInput input=new BoundedJsonInput(owner);assertEquals('[',input.read());
        char[] target={'a','a','a','a','a','a'};assertEquals(0,input.read(target,1,0));assertEquals(4,input.read(target,1,4));assertEquals("a\"ok\"a",new String(target));
        assertEquals(']',input.read());assertEquals(-1,input.read());assertEquals(0,closes[0]);
        input.close();input.close();assertEquals(1,closes[0]);
        try{input.read();fail();}catch(IOException expected){}
    }
    private static class Lazy extends Reader {
        final String prefix,suffix;final int count;final char repeated;int position;
        Lazy(String prefix,int count,String suffix){this(prefix,count,suffix,'x');}
        Lazy(String prefix,int count,String suffix,char repeated){this.prefix=prefix;this.count=count;this.suffix=suffix;this.repeated=repeated;}
        @Override public int read(char[] out,int offset,int length)throws IOException {
            int size=prefix.length()+count+suffix.length();if(position>=size)return -1;int n=Math.min(length,size-position);
            for(int index=0;index<n;index++,position++)out[offset+index]=position<prefix.length()?prefix.charAt(position):position<prefix.length()+count?repeated:suffix.charAt(position-prefix.length()-count);
            return n;
        }
        @Override public void close(){}
    }
}
