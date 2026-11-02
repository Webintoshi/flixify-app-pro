package vip.flixify.tv.data;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import vip.flixify.tv.PackagePlan;
public class PackageCatalogParserTest {
 private JSONObject entry(String slug,int months,boolean active,String price)throws Exception{return new JSONObject().put("slug",slug).put("durationMonths",months).put("isActive",active).put("priceLabel",price);}
 @Test public void acceptsSixCanonicalPlansAndConstructsCredentialFreeUrls()throws Exception{
  JSONArray items=new JSONArray();for(int users:new int[]{1,2})for(int months:new int[]{1,6,12})items.put(entry(PackagePlan.slug(months,users),months,true,"999 TL"));
  java.util.List<PackagePlan> plans=PackageCatalogParser.parse(new JSONObject().put("items",items));assertEquals(6,plans.size());
  assertEquals("https://flixify.vip/paketler?users=2&plan=12-ay-2-kullanici&from=android_tv",plans.get(5).url());
 }
 @Test public void rejectsInactiveWrongTermDuplicateAndInvalidPrice()throws Exception{
  JSONArray items=new JSONArray().put(entry("1-ay",1,false,"250 TL")).put(entry("6-ay",12,true,"699 TL")).put(entry("12-ay",12,true,"<bad>")).put(entry("1-ay-2-kullanici",1,true,"399 TL")).put(entry("1-ay-2-kullanici",1,true,"399 TL"));
  assertTrue(PackageCatalogParser.parse(new JSONObject().put("items",items)).isEmpty());
 }
 @Test(expected=ProviderParser.Invalid.class)public void missingItemsFails()throws Exception{PackageCatalogParser.parse(new JSONObject());}
}
