package vip.flixify.tv.data;

import java.util.*;
import org.json.*;
import vip.flixify.tv.PackagePlan;

public final class PackageCatalogParser {
    private PackageCatalogParser(){}
    public static List<PackagePlan> parse(JSONObject root) throws Exception {
        JSONArray items=root.optJSONArray("items");if(items==null||items.length()>100)throw new ProviderParser.Invalid();
        Map<String,PackagePlan> result=new LinkedHashMap<>();Set<String> seen=new HashSet<>();
        for(int n=0;n<items.length();n++){
            JSONObject item=items.optJSONObject(n);if(item==null)continue;
            String slug=item.optString("slug","");int users=slug.endsWith("-2-kullanici")?2:1;int months=slug.startsWith("12-")?12:slug.startsWith("6-")?6:1;
            if(!slug.equals(PackagePlan.slug(months,users)))continue;
            if(!seen.add(slug)){result.remove(slug);continue;}
            Object term=item.opt("durationMonths");Object active=item.opt("isActive");Object price=item.opt("priceLabel");
            if(!(term instanceof Number)||((Number)term).doubleValue()!=months||!Boolean.TRUE.equals(active)||!(price instanceof String))continue;
            String label=((String)price).trim();if(label.length()>40||!label.matches("(?i)(?:₺\\s*)?[0-9]{1,6}(?:\\.[0-9]{3})*(?:,00)?\\s*(?:TL|TRY|₺)?"))continue;
            String digits=label.replaceAll("[^0-9]","");if(digits.isEmpty()||Long.parseLong(digits)==0)continue;
            result.put(slug,new PackagePlan(slug,months,users,label));
        }
        return Collections.unmodifiableList(new ArrayList<>(result.values()));
    }
}
