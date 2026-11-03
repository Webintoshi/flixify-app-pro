package vip.flixify.tv;

import java.util.List;
import vip.flixify.tv.TvModels.Catalog;

/** Runs the screen's complete category and presentation preparation without constructing views. */
public final class ReadyLiveSurfaceProbe {
    private ReadyLiveSurfaceProbe(){}
    public static final class Sample {
        public final long categoriesNanos,presentationNanos;
        public final int itemCount;
        public final String categorySignature;
        Sample(long categories,long presentation,int count,String signature){categoriesNanos=categories;presentationNanos=presentation;itemCount=count;categorySignature=signature;}
    }
    public static Sample prepare(Catalog catalog){
        long start=System.nanoTime();List<CatalogFilterData.CategoryOption> categories=CatalogFilterData.categories(catalog,"");
        long categoryNanos=System.nanoTime()-start;start=System.nanoTime();
        CatalogPresentation result=CatalogPresentation.prepare(new CatalogPresentation.Key(catalog,"LIVE","latency-fixture-account","latency-fixture-account:latency-source-a","2026-11-03","",""));
        long presentationNanos=System.nanoTime()-start;StringBuilder signature=new StringBuilder();
        for(CatalogFilterData.CategoryOption category:categories)signature.append(category.id).append('\t').append(category.title).append('\t').append(category.count).append('\n');
        return new Sample(categoryNanos,presentationNanos,result.items.size(),signature.toString());
    }
}
