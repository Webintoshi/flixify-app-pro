package vip.flixify.tv;

/** Display-only campaign state; payment eligibility and amounts are always checked by the server. */
public final class WelcomeOffer {
    public static final String CAMPAIGN="welcome-monthly-50-v1";
    public final String state;
    public final boolean eligible;
    public final int movies,live,series;
    public WelcomeOffer(String state,boolean eligible,int movies,int live,int series){this.state=state;this.eligible=eligible;this.movies=movies;this.live=live;this.series=series;}
    public static WelcomeOffer notEligible(){return new WelcomeOffer("not_eligible",false,0,0,0);}
    public boolean showPrompt(){return eligible && "pending".equals(state);}
    public String price(int users){return users==2?"199,50 ₺":"125 ₺";}
    public String regularPrice(int users){return users==2?"399 ₺":"250 ₺";}
    public String paymentUrl(int users){return "https://flixify.vip/paketler?welcome=1&users="+(users==2?"2":"1");}
}
