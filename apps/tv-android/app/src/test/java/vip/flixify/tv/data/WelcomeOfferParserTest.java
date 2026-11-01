package vip.flixify.tv.data;

import org.json.JSONObject;
import org.junit.Test;
import vip.flixify.tv.WelcomeOffer;
import static org.junit.Assert.*;

public class WelcomeOfferParserTest {
    private JSONObject quote() throws Exception {
        return new JSONObject("{\"campaign\":\"welcome-monthly-50-v1\",\"state\":\"pending\",\"eligible\":true,\"offers\":[{\"id\":\"welcome-monthly-50-v1\",\"packageSlug\":\"1-ay\",\"users\":1,\"durationMonths\":1,\"amountMinor\":12500,\"regularAmountMinor\":25000,\"currency\":\"try\"},{\"id\":\"welcome-monthly-50-v1\",\"packageSlug\":\"1-ay-2-kullanici\",\"users\":2,\"durationMonths\":1,\"amountMinor\":19950,\"regularAmountMinor\":39900,\"currency\":\"try\"}],\"catalogue\":{\"movies\":11955,\"live\":12677,\"series\":1675}}");
    }
    @Test public void exactSingleAndDualQuotesKeepFractionalCurrency() throws Exception {
        WelcomeOffer offer=WelcomeOfferParser.parse(quote());assertTrue(offer.showPrompt());
        assertEquals("125 ₺",offer.price(1));assertEquals("199,50 ₺",offer.price(2));
        assertEquals("399 ₺",offer.regularPrice(2));assertEquals(1675,offer.series);
        assertEquals("https://flixify.vip/paketler?welcome=1&users=2",offer.paymentUrl(2));
    }
    @Test public void historicalAccountsDoNotNeedQuotes() throws Exception {
        assertFalse(WelcomeOfferParser.parse(new JSONObject("{\"campaign\":\"welcome-monthly-50-v1\",\"state\":\"not_eligible\",\"eligible\":false,\"offers\":[]}")).showPrompt());
    }
    @Test public void DismissalKeepsDiscountButDoesNotReopenPrompt() throws Exception {
        WelcomeOffer offer=WelcomeOfferParser.parse(quote().put("state","dismissed"));assertTrue(offer.eligible);assertFalse(offer.showPrompt());
    }
    @Test public void cannotDisplayForgedPriceCapacityCurrencyOrMissingDual() throws Exception {
        for(String key:new String[]{"amountMinor","regularAmountMinor","durationMonths","users","currency","packageSlug"}){
            JSONObject raw=quote();raw.getJSONArray("offers").getJSONObject(1).put(key,key.equals("currency")?"usd":key.equals("packageSlug")?"12-ay":key.equals("durationMonths")?2:1);
            try{WelcomeOfferParser.parse(raw);fail(key);}catch(ProviderParser.Invalid expected){}
        }
        JSONObject raw=quote();raw.getJSONArray("offers").remove(1);try{WelcomeOfferParser.parse(raw);fail();}catch(ProviderParser.Invalid expected){}
    }
    @Test public void rejectsContradictoryEligibilityAndUnboundedStatistics() throws Exception {
        for(JSONObject raw:new JSONObject[]{quote().put("eligible",false),quote().put("state","unknown"),quote().put("campaign","untrusted")}){
            try{WelcomeOfferParser.parse(raw);fail();}catch(ProviderParser.Invalid expected){}
        }
        JSONObject raw=quote();raw.getJSONObject("catalogue").put("movies",Integer.MAX_VALUE);try{WelcomeOfferParser.parse(raw);fail();}catch(ProviderParser.Invalid expected){}
    }
}
