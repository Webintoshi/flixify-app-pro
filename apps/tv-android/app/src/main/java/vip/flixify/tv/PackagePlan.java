package vip.flixify.tv;

public final class PackagePlan {
    public final String slug,priceLabel;
    public final int months,users;
    public PackagePlan(String slug,int months,int users,String priceLabel){this.slug=slug;this.months=months;this.users=users;this.priceLabel=priceLabel;}
    public static String slug(int months,int users){if((months!=1&&months!=6&&months!=12)||(users!=1&&users!=2))throw new IllegalArgumentException();return months+"-ay"+(users==2?"-2-kullanici":"");}
    public String url(){if(!slug.equals(slug(months,users)))throw new IllegalArgumentException();return "https://flixify.vip/paketler?users="+users+"&plan="+slug+"&from=android_tv";}
}
