package vip.flixify.tv;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.*;

/** One running preparation and one newest pending request per Activity. */
final class CatalogPresentationPreparer implements AutoCloseable {
    interface Computer {CatalogPresentation prepare(CatalogPresentation.Key key);}
    interface Callback {void ready(CatalogPresentation result);}
    private final ExecutorService worker;private final Executor delivery;private final Computer computer;
    private final Map<CatalogPresentation.Key,CatalogPresentation> cache=new LinkedHashMap<CatalogPresentation.Key,CatalogPresentation>(8,.75f,true){@Override protected boolean removeEldestEntry(Map.Entry<CatalogPresentation.Key,CatalogPresentation> entry){return size()>6;}};
    private FutureTask<Void> pending;private long generation;private boolean closed;
    CatalogPresentationPreparer(Executor delivery){this(new ThreadPoolExecutor(1,1,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(1),task->{Thread thread=new Thread(task,"catalog-presentation");thread.setPriority(Thread.MIN_PRIORITY);return thread;}),delivery,CatalogPresentation::prepare);((ThreadPoolExecutor)worker).allowCoreThreadTimeOut(true);}
    CatalogPresentationPreparer(ExecutorService worker,Executor delivery,Computer computer){this.worker=worker;this.delivery=delivery;this.computer=computer;}
    synchronized CatalogPresentation cached(CatalogPresentation.Key key){return closed?null:cache.get(key);}
    synchronized void request(CatalogPresentation.Key key,Callback callback){
        cancel();if(closed)return;CatalogPresentation hit=cache.get(key);if(hit!=null){callback.ready(hit);return;}long ticket=generation;
        pending=new FutureTask<>(()->{
            CatalogPresentation result;
            try{result=computer.prepare(key);}catch(CancellationException cancelled){return null;}
            synchronized(this){if(closed || generation!=ticket || Thread.currentThread().isInterrupted())return null;cache.put(key,result);}
            delivery.execute(()->{synchronized(this){if(closed || generation!=ticket)return;}callback.ready(result);});return null;
        });
        worker.execute(pending);
    }
    synchronized void remember(CatalogPresentation.Key key,CatalogPresentation result){if(!closed)cache.put(key,result);}
    synchronized void cancel(){generation++;if(pending!=null){pending.cancel(true);if(worker instanceof ThreadPoolExecutor)((ThreadPoolExecutor)worker).remove(pending);pending=null;}}
    synchronized void clear(){cancel();cache.clear();}
    @Override public synchronized void close(){closed=true;clear();worker.shutdownNow();}
}
