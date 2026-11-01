package vip.flixify.tv.data;

import android.util.JsonReader;
import android.util.JsonToken;
import java.io.IOException;
import java.io.Reader;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;
import vip.flixify.tv.TvModels.*;

/** Parses one provider row at a time; unknown metadata never becomes a JSON tree. */
final class ProviderCatalogReader {
    private static final Set<String> FIELDS=new HashSet<>(Arrays.asList("stream_id","series_id","name","category_id","container_extension","stream_icon","cover","plot","year","release_year","releaseYear","releaseDate","release_date"));
    private ProviderCatalogReader(){}
    static Catalog read(Reader input,Kind kind,Object categories,String scope)throws IOException,ProviderParser.Invalid {
        JsonReader reader=new JsonReader(new BoundedJsonInput(input));reader.setLenient(false);
        ProviderParser.CatalogAccumulator rows=new ProviderParser.CatalogAccumulator(kind,categories,scope);
        if(reader.peek()!=JsonToken.BEGIN_ARRAY)throw new ProviderParser.Invalid();reader.beginArray();
        while(reader.hasNext()) {
            if(reader.peek()!=JsonToken.BEGIN_OBJECT){skip(reader,1);rows.accept(JSONObject.NULL);continue;}
            JSONObject row=new JSONObject();reader.beginObject();
            while(reader.hasNext()) {
                String name=reader.nextName();
                if(!FIELDS.contains(name)){skip(reader,2);continue;}
                Object value;
                switch(reader.peek()) {
                    case STRING:value=reader.nextString();break;
                    case NUMBER:
                        String number=reader.nextString();try{double numeric=Double.parseDouble(number);value=Double.isInfinite(numeric)||Double.isNaN(numeric)?number:numeric;}catch(NumberFormatException invalid){throw new ProviderParser.Invalid();}break;
                    case BOOLEAN:value=reader.nextBoolean();break;
                    case NULL:reader.nextNull();value=JSONObject.NULL;break;
                    default:skip(reader,2);value=new JSONObject();
                }
                try{row.put(name,value);}catch(JSONException invalid){throw new ProviderParser.Invalid();}
            }
            reader.endObject();rows.accept(row);
        }
        reader.endArray();if(reader.peek()!=JsonToken.END_DOCUMENT)throw new ProviderParser.Invalid();return rows.finish();
    }
    private static void skip(JsonReader reader,int depth)throws IOException,ProviderParser.Invalid {
        switch(reader.peek()) {
            case BEGIN_ARRAY:if(depth>=64)throw new ProviderParser.Invalid();reader.beginArray();while(reader.hasNext())skip(reader,depth+1);reader.endArray();break;
            case BEGIN_OBJECT:if(depth>=64)throw new ProviderParser.Invalid();reader.beginObject();while(reader.hasNext()){reader.nextName();skip(reader,depth+1);}reader.endObject();break;
            default:reader.skipValue();
        }
    }
}
