package vip.flixify.tv.data;

import org.json.JSONArray;
import org.json.JSONObject;
import vip.flixify.tv.WelcomeOffer;

public final class WelcomeOfferParser {
    private WelcomeOfferParser(){}
    private static int integer(Object value,int maximum)throws ProviderParser.Invalid{
        if(!(value instanceof Integer || value instanceof Long) || ((Number)value).longValue()<0 || ((Number)value).longValue()>maximum)throw new ProviderParser.Invalid();
        return ((Number)value).intValue();
    }
    public static WelcomeOffer parse(JSONObject raw)throws ProviderParser.Invalid{
        if(raw==null || !WelcomeOffer.CAMPAIGN.equals(raw.opt("campaign")) || !(raw.opt("eligible") instanceof Boolean))throw new ProviderParser.Invalid();
        Object value=raw.opt("state");if(!(value instanceof String))throw new ProviderParser.Invalid();String state=(String)value;
        boolean eligible=(Boolean)raw.opt("eligible"),pending="pending".equals(state),dismissed="dismissed".equals(state);
        if(!pending && !dismissed && !"not_eligible".equals(state) && !"redeemed".equals(state) || eligible!=(pending || dismissed))throw new ProviderParser.Invalid();
        JSONArray offers=raw.optJSONArray("offers");if(offers==null || offers.length()!=(eligible?2:0))throw new ProviderParser.Invalid();
        boolean single=false,dual=false;
        for(int n=0;n<offers.length();n++){
            JSONObject quote=offers.optJSONObject(n);if(quote==null)throw new ProviderParser.Invalid();
            int users=integer(quote.opt("users"),2);
            if(users!=1 && users!=2 || users==1 && single || users==2 && dual || !WelcomeOffer.CAMPAIGN.equals(quote.opt("id")) || !"try".equals(quote.opt("currency")) || integer(quote.opt("durationMonths"),12)!=1 || integer(quote.opt("amountMinor"),100000)!=(users==1?12500:19950) || integer(quote.opt("regularAmountMinor"),100000)!=(users==1?25000:39900) || !(users==1?"1-ay":"1-ay-2-kullanici").equals(quote.opt("packageSlug")))throw new ProviderParser.Invalid();
            if(users==1)single=true;else dual=true;
        }
        JSONObject catalogue=raw.optJSONObject("catalogue");if(eligible && catalogue==null)throw new ProviderParser.Invalid();
        int movies=0,live=0,series=0;
        if(catalogue!=null){movies=integer(catalogue.opt("movies"),1000000);live=integer(catalogue.opt("live"),1000000);series=integer(catalogue.opt("series"),1000000);}
        return new WelcomeOffer(state,eligible,movies,live,series);
    }
}
