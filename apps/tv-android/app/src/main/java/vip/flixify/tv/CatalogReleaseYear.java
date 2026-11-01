package vip.flixify.tv;

import java.text.Normalizer;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Zero means unknown, including conflicting explicit release evidence. */
public final class CatalogReleaseYear {
    private static final Pattern MARKER=Pattern.compile("\\(((?:19|20)[0-9]{2})\\)|\\[((?:19|20)[0-9]{2})\\]");
    private static final Pattern DATE=Pattern.compile("^((?:19|20)[0-9]{2})-([0-9]{2})-([0-9]{2})(?:T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]{1,3})?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9]))?$");
    private CatalogReleaseYear(){}
    public static int normalize(int value){return value>=1900 && value<=2099?value:0;}
    private static String trim(String value){return value.replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$","");}
    public static int title(String value){
        String text=trim(Normalizer.normalize(value==null?"":value,Normalizer.Form.NFKC));
        Matcher markers=MARKER.matcher(text);int found=0,end=-1;
        while(markers.find()){
            int current=Integer.parseInt(markers.group(1)==null?markers.group(2):markers.group(1));
            if(found!=0 && found!=current)return 0;found=current;end=markers.end();
        }
        return end==text.length()?found:0;
    }
    private static int year(Object value){
        if(value instanceof Number){double number=((Number)value).doubleValue();return number==Math.floor(number) && number>=1900 && number<=2099?(int)number:0;}
        if(value instanceof String){String text=trim((String)value);if(text.matches("(?:19|20)[0-9]{2}"))return Integer.parseInt(text);}
        return 0;
    }
    private static int dateYear(Object value){
        if(!(value instanceof String) || ((String)value).length()>64)return 0;
        Matcher match=DATE.matcher(trim((String)value));if(!match.matches())return 0;
        int year=Integer.parseInt(match.group(1)),month=Integer.parseInt(match.group(2)),day=Integer.parseInt(match.group(3));
        if(month<1 || month>12)return 0;
        int[] days={31,year%4==0 && (year%100!=0 || year%400==0)?29:28,31,30,31,30,31,31,30,31,30,31};
        return day>=1 && day<=days[month-1]?year:0;
    }
    public static int fromMetadata(Map<String,?> metadata,String title){
        int found=0;
        if(metadata!=null)for(String field:new String[]{"year","release_year","releaseYear","releaseDate","release_date"}){
            Object value=metadata.get(field);
            if(value==null || value instanceof String && trim((String)value).isEmpty())continue;
            int current=field.equals("releaseDate") || field.equals("release_date")?dateYear(value):year(value);
            if(current==0 || found!=0 && found!=current)return 0;found=current;
        }
        return found==0?title(title):found;
    }
}
