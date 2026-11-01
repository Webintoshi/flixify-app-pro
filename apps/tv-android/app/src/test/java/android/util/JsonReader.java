package android.util;
import java.io.IOException;
import java.io.Reader;
/** Android's mockable jar has no JSON implementation; Gson supplies the equivalent host reader. */
public final class JsonReader implements java.io.Closeable {
    private final com.google.gson.stream.JsonReader reader;
    public JsonReader(Reader input){reader=new com.google.gson.stream.JsonReader(input);}
    public void setLenient(boolean value){reader.setLenient(value);}
    public JsonToken peek()throws IOException{return JsonToken.valueOf(reader.peek().name());}
    public void beginArray()throws IOException{reader.beginArray();}
    public void endArray()throws IOException{reader.endArray();}
    public void beginObject()throws IOException{reader.beginObject();}
    public void endObject()throws IOException{reader.endObject();}
    public boolean hasNext()throws IOException{return reader.hasNext();}
    public String nextName()throws IOException{return reader.nextName();}
    public String nextString()throws IOException{return reader.nextString();}
    public boolean nextBoolean()throws IOException{return reader.nextBoolean();}
    public void nextNull()throws IOException{reader.nextNull();}
    public void skipValue()throws IOException{reader.skipValue();}
    public void close()throws IOException{reader.close();}
}
