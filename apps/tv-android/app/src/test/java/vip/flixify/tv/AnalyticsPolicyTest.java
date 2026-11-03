package vip.flixify.tv;

import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class AnalyticsPolicyTest {
    @Test public void configuredPolicyStartsAcceptedWithoutAChoice() {
        List<String> sent=new ArrayList<>();AnalyticsPolicy policy=new AnalyticsPolicy(true,(name,values)->sent.add(name));
        policy.event(policy.epoch(),"login",Collections.emptyMap());
        assertEquals(Collections.singletonList("login"),sent);
        AnalyticsPolicy unavailable=new AnalyticsPolicy(false,(name,values)->fail("Missing config must never collect"));
        unavailable.event(unavailable.epoch(),"login",Collections.emptyMap());
    }
    @Test public void onlySafeCatalogueLabelsCanBeMeasured() {
        List<Map<String,Object>> sent=new ArrayList<>();AnalyticsPolicy p=new AnalyticsPolicy(true,(n,v)->sent.add(v));p.choice(true,1);
        p.event(p.epoch(),"select_content",TvAnalyticsValues.label("content_name","Şebeke (2023)"));
        assertEquals("Şebeke (2023)",sent.get(0).get("content_name"));
        for(String bad:Arrays.asList("user@example.com","https://provider/user/pass","ABCDEFGHIJKLMNOP","movie\u200b","username=secret","secret%20token","http:private","HTTPS:private","mailto:private","data:private","file:private","javascript:private","movie\u2028","movie\u2029","session:private","session_id=private-value","token_id:private","ftp:private")){
            p.event(p.epoch(),"select_content",TvAnalyticsValues.label("content_name",bad));assertFalse(sent.get(sent.size()-1).containsKey("content_name"));
        }
        assertEquals(19,sent.size());
    }
    @Test public void consentRecordsTheVisibleLoginInsteadOfRememberedHomeSection() {
        assertEquals("login",AnalyticsPolicy.visibleScreen(false,"home"));
        assertEquals("login",AnalyticsPolicy.visibleScreen(true,"login"));
        assertEquals("welcome",AnalyticsPolicy.visibleScreen(true,"welcome"));
        assertEquals("movies",AnalyticsPolicy.visibleScreen(true,"movies"));
    }
    private static final class TvAnalyticsValues {static Map<String,Object> label(String key,String value){Map<String,Object> v=new HashMap<>();v.put(key,value);return v;}}
    @Test public void forcedConsentStillRejectsOldAsyncWorkAcrossInternalReset() {
        List<String> sent=new ArrayList<>();
        AnalyticsPolicy p=new AnalyticsPolicy(true,(name,values)->sent.add(name));
        long ticket=p.epoch();p.event(ticket,"login",Collections.emptyMap());assertEquals(Arrays.asList("login"),sent);
        p.choice(false,AnalyticsPolicy.VERSION);p.choice(true,AnalyticsPolicy.VERSION);
        p.event(ticket,"login",Collections.emptyMap());assertEquals(1,sent.size());
        p.choice(true,0);p.event(p.epoch(),"login",Collections.emptyMap());assertEquals(1,sent.size());
    }
    @Test public void unknownSensitiveFieldsAndRawSearchAreDropped() {
        List<Map<String,Object>> sent=new ArrayList<>();
        AnalyticsPolicy p=new AnalyticsPolicy(true,(name,values)->sent.add(values));p.choice(true,1);
        Map<String,Object> values=new HashMap<>();values.put("query_length",8);values.put("result_count",3);
        values.put("search_term","a@example.com");values.put("url","https://host/u/p");values.put("token","secret");
        p.event(p.epoch(),"search",values);
        assertEquals(1,sent.size());assertEquals(new HashSet<>(Arrays.asList("query_length","result_count")),sent.get(0).keySet());
        p.event(p.epoch(),"anything",values);assertEquals(1,sent.size());
        AnalyticsPolicy unavailable=new AnalyticsPolicy(false,(name,event)->fail("Missing config must never collect"));
        unavailable.choice(true,1);unavailable.event(unavailable.epoch(),"login",Collections.emptyMap());
    }
    @Test public void regularPackageEventRequiresConsentAndBoundsCapacity(){
        List<Map<String,Object>> sent=new ArrayList<>();AnalyticsPolicy policy=new AnalyticsPolicy(true,(name,values)->{assertEquals("package_open",name);sent.add(values);});Map<String,Object> values=new HashMap<>();values.put("package_users",2);values.put("url","https://private.invalid");
        policy.event(policy.epoch(),"package_open",values);assertEquals(1,sent.size());assertEquals(Collections.singletonMap("package_users",2L),sent.get(0));policy.choice(false,AnalyticsPolicy.VERSION);policy.event(policy.epoch(),"package_open",values);assertEquals(1,sent.size());
    }

}
