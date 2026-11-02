package vip.flixify.tv;

import java.util.*;

final class AnalyticsPolicy {
    interface Sink { void event(String name, Map<String,Object> values); }
    static final int VERSION=1;
    private static final Set<String> EVENTS=new HashSet<>(Arrays.asList("login","logout","screen_view","search","select_content","category_select","catalog_page_loaded","add_to_wishlist","remove_from_wishlist","trial_select","welcome_offer_select","select_item","package_open","update_offered","update_selected","update_downloaded","playback_request","video_start","video_progress","video_complete","playback_buffer","playback_error","playback_end"));
    private static final Set<String> SCREENS=new HashSet<>(Arrays.asList("home","live","movies","series","favorites","account","login","welcome","player","settings"));
    private static final Set<String> REASONS=new HashSet<>(Arrays.asList("closed","completed","replaced","network","decoder","access","recovery","unknown"));
    private final boolean configured;
    private final Sink sink;
    private boolean accepted;
    private long generation;
    AnalyticsPolicy(boolean configured, Sink sink) {this.configured=configured;this.sink=sink;}
    void choice(boolean accepted,int version) {generation++;this.accepted=configured && accepted && version==VERSION;}
    long epoch() {return generation;}
    boolean enabled() {return accepted;}
    static String visibleScreen(boolean hasSession,String visible) { return !hasSession ? "login" : SCREENS.contains(visible) ? visible : "login"; }
    static String catalogLabel(String value,int maximum) {
        if(value==null||value.length()>4096)return "";String s=value.trim();if(s.isEmpty())return "";
        for(int at=0;at<value.length();){int cp=value.codePointAt(at),type=Character.getType(cp);if(type==Character.CONTROL||type==Character.FORMAT||type==Character.SURROGATE||type==Character.LINE_SEPARATOR||type==Character.PARAGRAPH_SEPARATOR)return "";at+=Character.charCount(cp);}
        String lower=s.toLowerCase(Locale.ROOT);
        if(java.util.regex.Pattern.compile("(?:https?|ftp|mailto|data|file|javascript):",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(s).find()||lower.contains("://")||lower.contains("www.")||lower.contains("@")||java.util.regex.Pattern.compile("%[0-9a-f]{2}",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(s).find()||java.util.regex.Pattern.compile("(?:username|password|token|secret|session)(?:_id)?\\s*[=:]",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(s).find()||java.util.regex.Pattern.compile("(?<![A-Za-z0-9])[A-Z0-9]{16}(?![A-Za-z0-9])").matcher(s).find())return "";
        return s.substring(0,s.offsetByCodePoints(0,Math.min(maximum,s.codePointCount(0,s.length()))));
    }
    void event(long epoch,String name,Map<String,Object> values) {
        if(!accepted || epoch!=generation || !EVENTS.contains(name))return;
        Map<String,Object> safe=new LinkedHashMap<>();
        for(Map.Entry<String,Object> entry:values.entrySet()){
            String key=entry.getKey();Object value=entry.getValue();
            if(value instanceof Number){double n=((Number)value).doubleValue();if(Double.isNaN(n)||Double.isInfinite(n)||n<0)continue;
                double max=key.equals("query_length")?500:key.equals("result_count")?100000:key.equals("progress_percent")?100:key.equals("package_users")?2:key.equals("package_months")?12:86400000;
                if(Arrays.asList("query_length","result_count","startup_ms","buffer_ms","watch_ms","progress_percent","package_users","package_months").contains(key)&&n<=max)safe.put(key,((Number)value).longValue());
            }else if(value instanceof String){String s=(String)value;
                if(key.equals("content_name")||key.equals("category_name")){String label=catalogLabel(s,key.equals("content_name")?100:80);if(!label.isEmpty())safe.put(key,label);continue;}
                if(key.equals("screen_name")&&SCREENS.contains(s)||key.equals("content_type")&&Arrays.asList("live","movie","series","episode").contains(s)||key.equals("reason")&&REASONS.contains(s)||key.equals("offer_id")&&s.equals("welcome-monthly-50-v1")||(key.equals("content_id")||key.equals("category_id"))&&s.matches("[0-9a-f]{24}"))safe.put(key,s);
            }
        }
        try{sink.event(name,Collections.unmodifiableMap(safe));}catch(RuntimeException ignored){}
    }
}
