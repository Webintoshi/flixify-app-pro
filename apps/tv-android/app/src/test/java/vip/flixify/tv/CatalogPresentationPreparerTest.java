package vip.flixify.tv;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import java.util.concurrent.*;
import vip.flixify.tv.TvModels.*;

public class CatalogPresentationPreparerTest {
    private Catalog catalog(){return new Catalog(Kind.MOVIE,Collections.emptyList(),Collections.emptyList());}
    private CatalogPresentation.Key key(Catalog catalog,String account,String scope,String day,String query){return new CatalogPresentation.Key(catalog,"MOVIES",account,scope,day,"",query);}
    private static final class QueueExecutor extends AbstractExecutorService {
        final Queue<Runnable> work=new ArrayDeque<>();boolean closed;
        public void execute(Runnable task){if(closed)throw new RejectedExecutionException();work.add(task);}
        void drain(){while(!work.isEmpty())work.remove().run();}
        public void shutdown(){closed=true;}public List<Runnable> shutdownNow(){closed=true;List<Runnable> result=new ArrayList<>(work);work.clear();return result;}
        public boolean isShutdown(){return closed;}public boolean isTerminated(){return closed;}public boolean awaitTermination(long time,TimeUnit unit){return closed;}
    }
    @Test public void computationAndDeliveryUseSeparateExecutorsAndWarmResultIsImmediate(){
        QueueExecutor worker=new QueueExecutor(),main=new QueueExecutor();int[] computations={0},deliveries={0};
        CatalogPresentationPreparer preparer=new CatalogPresentationPreparer(worker,main,key->{computations[0]++;return CatalogPresentation.prepare(key);});
        CatalogPresentation.Key key=key(catalog(),"account","scope","day","");
        preparer.request(key,result->deliveries[0]++);assertEquals(0,computations[0]);assertEquals(0,deliveries[0]);
        worker.drain();assertEquals(1,computations[0]);assertEquals(0,deliveries[0]);main.drain();assertEquals(1,deliveries[0]);
        assertNotNull(preparer.cached(key));preparer.request(key,result->deliveries[0]++);assertEquals(2,deliveries[0]);assertEquals(1,computations[0]);preparer.close();
    }
    @Test public void supersededQueuedDeliveryAndLifecycleInvalidationCannotPublish(){
        QueueExecutor worker=new QueueExecutor(),main=new QueueExecutor();List<String> delivered=new ArrayList<>();
        CatalogPresentationPreparer preparer=new CatalogPresentationPreparer(worker,main,CatalogPresentation::prepare);
        Catalog catalog=catalog();CatalogPresentation.Key first=key(catalog,"account","scope","day","first"),second=key(catalog,"account","scope","day","second");
        preparer.request(first,result->delivered.add("first"));worker.drain();
        preparer.request(second,result->delivered.add("second"));worker.drain();main.drain();assertEquals(Collections.singletonList("second"),delivered);
        preparer.request(key(catalog,"account","scope","day","third"),result->delivered.add("third"));worker.drain();preparer.clear();main.drain();assertEquals(1,delivered.size());assertNull(preparer.cached(second));
        preparer.request(first,result->delivered.add("closed"));worker.drain();preparer.close();main.drain();assertEquals(1,delivered.size());
    }
    @Test public void snapshotAccountSourceDayAndFiltersAreCacheBoundaries(){
        QueueExecutor worker=new QueueExecutor(),main=new QueueExecutor();CatalogPresentationPreparer preparer=new CatalogPresentationPreparer(worker,main,CatalogPresentation::prepare);
        Catalog catalog=catalog();CatalogPresentation.Key initial=key(catalog,"a","s","d","");preparer.request(initial,result->{});worker.drain();main.drain();
        assertNotNull(preparer.cached(key(catalog,"a","s","d","")));
        for(CatalogPresentation.Key changed:Arrays.asList(key(catalog(),"a","s","d",""),key(catalog,"b","s","d",""),key(catalog,"a","t","d",""),key(catalog,"a","s","e",""),key(catalog,"a","s","d","x"),new CatalogPresentation.Key(catalog,"HOME","a","s","d","",""),new CatalogPresentation.Key(catalog,"MOVIES","a","s","d","category","")))assertNull(preparer.cached(changed));
        for(int n=0;n<8;n++){preparer.request(key(catalog,"a","s","d","q"+n),result->{});worker.drain();main.drain();}assertNull(preparer.cached(initial));preparer.close();
    }
    @Test public void emptyLiveFilterKeepsReferencesOrderAndCategorySemantics(){
        Item first=new Item(Kind.LIVE,"1","TR: Şöhret HD","a","Türkiye","","","scope","",0,0,""),second=new Item(Kind.LIVE,"2","DE: News","b","Germany","","","scope","",0,0,"");
        Catalog catalog=new Catalog(Kind.LIVE,Arrays.asList(first,second),Collections.emptyList());assertEquals(Arrays.asList(first,second),CatalogFilterData.filtered(catalog,"",""));assertEquals(Collections.singletonList(first),CatalogFilterData.filtered(catalog,"a",""));
    }
    @Test public void runningObsoleteWorkCannotFillCacheOrBlockNewestQueuedRequest()throws Exception{
        ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,1,TimeUnit.SECONDS,new ArrayBlockingQueue<>(1));QueueExecutor main=new QueueExecutor();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),finished=new CountDownLatch(1);List<String> deliveries=new ArrayList<>();
        CatalogPresentationPreparer preparer=new CatalogPresentationPreparer(worker,main,key->{if(key.query.equals("first")){entered.countDown();boolean done=false;while(!done)try{release.await();done=true;}catch(InterruptedException ignored){}}CatalogPresentation result=CatalogPresentation.prepare(key);if(key.query.equals("last"))finished.countDown();return result;});
        Catalog catalog=catalog();CatalogPresentation.Key first=key(catalog,"a","s","d","first"),last=key(catalog,"a","s","d","last");
        try{
            preparer.request(first,result->deliveries.add("first"));assertTrue(entered.await(2,TimeUnit.SECONDS));
            for(int n=0;n<30;n++)preparer.request(key(catalog,"a","s","d","obsolete"+n),result->deliveries.add("obsolete"));
            preparer.request(last,result->deliveries.add("last"));assertEquals(1,worker.getQueue().size());release.countDown();assertTrue(finished.await(2,TimeUnit.SECONDS));worker.shutdown();assertTrue(worker.awaitTermination(2,TimeUnit.SECONDS));main.drain();
            assertEquals(Collections.singletonList("last"),deliveries);assertNull(preparer.cached(first));assertNotNull(preparer.cached(last));
        }finally{release.countDown();preparer.close();}
    }
}
