package vip.flixify.tv.data;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import vip.flixify.tv.TvModels.*;
import static org.junit.Assert.*;

public class MetadataReadyLiveCacheTest {
    private static final String SCOPE="account:source",POLICY="policy-a";
    private static final long NOW=1700000000000L,UNTIL=NOW+10L*86400000;
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private static Item item(String id,String title,String group){return new Item(Kind.LIVE,id,title,group.equals("UK News")?"2":"1",group,"https://images.test/logo.png","ts",SCOPE,"",0,0,"Description",title,2026);}
    private static Catalog raw(){return new Catalog(Kind.LIVE,Arrays.asList(item("1","TR | TRT 1 HD","TR: Ulusal"),item("2","TR | TRT 1 FHD","TR: Ulusal"),item("3","BBC News HD","UK News"),item("4","HD","TR: Ulusal")),Arrays.asList(new Category("1","TR: Ulusal"),new Category("2","UK News")));}
    private static LiveChannelCuration.Projection curate(Catalog raw){return LiveChannelCuration.curate(raw,Collections.emptySet());}
    private MetadataDiskCache cache(File directory){return new MetadataDiskCache(directory);}
    private static File rawFile(File directory)throws Exception{return file(directory,"catalog:LIVE:ts-default-v2");}
    private static File readyFile(File directory,MetadataDiskCache.Snapshot<Catalog> raw,String policy)throws Exception{return file(directory,"live-ready:v1:"+raw.format+":"+raw.payloadHash+":"+policy);}
    private static File file(File directory,String key)throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest((SCOPE+"\0"+key).getBytes(StandardCharsets.UTF_8));StringBuilder name=new StringBuilder();
        for(byte value:digest)name.append(String.format(Locale.ROOT,"%02x",value&255));return new File(directory,name+".bin");
    }

    @Test public void completeProjectionRestoresOrderRawAliasesAndAlreadyPrimedInfoAfterRestart()throws Exception {
        File directory=temporary.newFolder();MetadataDiskCache first=cache(directory);Catalog raw=raw();
        MetadataDiskCache.Snapshot<Catalog> committed=first.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true);assertNotNull(committed);assertSame(raw,committed.value);
        LiveChannelCuration.Projection expected=curate(raw);assertEquals(Arrays.asList("1","2"),expected.aliases("2"));assertNull(expected.resolve("4"));
        assertTrue(first.writeReadyLive(SCOPE,UNTIL,NOW+1,committed,POLICY,expected,()->true));
        MetadataDiskCache second=cache(directory);MetadataDiskCache.Snapshot<Catalog> read=second.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW+2);
        assertEquals(committed.payloadHash,read.payloadHash);assertEquals(committed.format,read.format);
        LiveChannelCuration.Projection actual=second.readReadyLive(SCOPE,UNTIL,NOW+2,read,POLICY,Collections.emptySet());assertNotNull(actual);
        assertEquals(expected.catalog.categories.size(),actual.catalog.categories.size());
        for(int i=0;i<expected.catalog.categories.size();i++){assertEquals(expected.catalog.categories.get(i).id,actual.catalog.categories.get(i).id);assertEquals(expected.catalog.categories.get(i).title,actual.catalog.categories.get(i).title);}
        for(int i=0;i<expected.catalog.items.size();i++){
            Item left=expected.catalog.items.get(i),right=actual.catalog.items.get(i);assertItem(left,right);
            LiveChannelLineup.Info a=LiveChannelLineup.snapshotInfo(left),b=LiveChannelLineup.snapshotInfo(right);assertNotNull("Restore must prime before any info() call",b);
            assertEquals(a.countryId,b.countryId);assertEquals(a.categoryId,b.categoryId);assertEquals(a.section,b.section);assertEquals(a.position,b.position,0);assertEquals(a.name,b.name);assertEquals(a.id,b.id);
        }
        for(Item original:read.value.items){assertSame(original,actual.original(original.id));assertEquals(expected.canonicalId(original.id),actual.canonicalId(original.id));assertEquals(expected.aliases(original.id),actual.aliases(original.id));}
        assertNull(second.readReadyLive("other:source",UNTIL,NOW+2,read,POLICY,Collections.emptySet()));
        assertNull(second.readReadyLive(SCOPE,UNTIL,NOW+2,read,"changed-policy",Collections.emptySet()));
        assertNull("Current exclusions remain mandatory even with a matching supplied policy key",second.readReadyLive(SCOPE,UNTIL,NOW+2,read,POLICY,Collections.singleton("2")));
    }

    @Test public void sameMillisecondChangedRawHasDifferentDigestAndCannotReuseReadyRecord()throws Exception {
        File directory=temporary.newFolder();MetadataDiskCache disk=cache(directory);Catalog first=raw();MetadataDiskCache.Snapshot<Catalog> a=disk.writeCatalog(SCOPE,UNTIL,NOW,first,()->true);
        assertTrue(disk.writeReadyLive(SCOPE,UNTIL,NOW,a,POLICY,curate(first),()->true));
        List<Item> items=new ArrayList<>(first.items);items.set(0,item("1","TR | Different Channel HD","TR: Ulusal"));Catalog changed=new Catalog(Kind.LIVE,items,first.categories);
        MetadataDiskCache.Snapshot<Catalog> b=disk.writeCatalog(SCOPE,UNTIL,NOW,changed,()->true);assertNotNull(b);assertEquals(a.savedAt,b.savedAt);assertNotEquals(a.payloadHash,b.payloadHash);
        MetadataDiskCache.Snapshot<Catalog> read=disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW);assertEquals(b.payloadHash,read.payloadHash);
        assertNull(disk.readReadyLive(SCOPE,UNTIL,NOW,read,POLICY,Collections.emptySet()));
        assertFalse("A projection cannot borrow another raw object's receipt",disk.writeReadyLive(SCOPE,UNTIL,NOW,b,POLICY,curate(first),()->true));
    }

    @Test public void networkReceiptRequiresExactRawRoundtripButDecodedRawCanSeed()throws Exception {
        File directory=temporary.newFolder();MetadataDiskCache disk=cache(directory);
        for(String field:Arrays.asList("sourceTitle","title","category","artwork","description","unicode")){
            Item source=item("1","TRT 1 HD","TR: Ulusal");
            Item changed=new Item(Kind.LIVE,"1",field.equals("title")?"TRT https://hidden.test/path":field.equals("unicode")?"TRT \ud800":source.title,"1",field.equals("category")?"TR https://hidden.test/path":source.categoryName,
                field.equals("artwork")?"https://images.test/logo.png?token=private":source.artwork,"ts",SCOPE,"",0,0,field.equals("description")?"https://hidden.test/path":source.description,
                field.equals("sourceTitle")?"Other original title":field.equals("title")?"TRT https://hidden.test/path":field.equals("unicode")?"TRT \ud800":source.title,2026);
            Catalog raw=new Catalog(Kind.LIVE,Collections.singletonList(changed),Collections.singletonList(new Category("1","TR: Ulusal")));
            assertNull(field,disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true));
            MetadataDiskCache.Snapshot<Catalog> restored=disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW+1);assertNotNull(field,restored);
            LiveChannelCuration.Projection projected=curate(restored.value);assertTrue(field,disk.writeReadyLive(SCOPE,UNTIL,NOW+1,restored,POLICY,projected,()->true));
            assertNotNull(disk.readReadyLive(SCOPE,UNTIL,NOW+2,restored,POLICY,Collections.emptySet()));
        }
        Catalog badCategory=new Catalog(Kind.LIVE,raw().items,Collections.singletonList(new Category("1","TR https://hidden.test/path")));
        assertNull(disk.writeCatalog(SCOPE,UNTIL,NOW,badCategory,()->true));
    }

    @Test public void readyRecordRetainsRawAgeAndCannotExtendShortenedAuthorityExpiry()throws Exception {
        File directory=temporary.newFolder();MetadataDiskCache disk=cache(directory);Catalog raw=raw();
        disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true);
        MetadataDiskCache.Snapshot<Catalog> shortLease=disk.readCatalog(SCOPE,Kind.LIVE,NOW+10000,NOW+1);
        assertTrue(disk.writeReadyLive(SCOPE,UNTIL,NOW+5000,shortLease,POLICY,curate(shortLease.value),()->true));
        byte[] record=Files.readAllBytes(readyFile(directory,shortLease,POLICY).toPath());assertEquals(NOW,ByteBuffer.wrap(record).getLong(36));assertEquals(NOW+10000,ByteBuffer.wrap(record).getLong(44));
        MetadataDiskCache.Snapshot<Catalog> renewed=disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW+6000);
        assertNotNull(disk.readReadyLive(SCOPE,UNTIL,NOW+6000,renewed,POLICY,Collections.emptySet()));
        assertNull(disk.readReadyLive(SCOPE,UNTIL,NOW+10000,renewed,POLICY,Collections.emptySet()));
        assertFalse(disk.writeReadyLive(SCOPE,UNTIL,NOW+MetadataDiskCache.MAX_AGE_MS,renewed,POLICY,curate(renewed.value),()->true));
        assertNull(disk.readReadyLive(SCOPE,UNTIL,NOW-1,renewed,POLICY,Collections.emptySet()));
    }

    @Test public void clearInvalidatesBothOldReadAndCommitReceiptsAndInFlightReadyWrites()throws Exception {
        File directory=temporary.newFolder();MetadataDiskCache disk=cache(directory);Catalog raw=raw();
        MetadataDiskCache.Snapshot<Catalog> committed=disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true),read=disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW);
        LiveChannelCuration.Projection projection=curate(raw);disk.clear();
        assertFalse(disk.writeReadyLive(SCOPE,UNTIL,NOW,committed,POLICY,projection,()->true));
        assertFalse(disk.writeReadyLive(SCOPE,UNTIL,NOW,read,POLICY,curate(read.value),()->true));assertEquals(0,directory.listFiles().length);
        MetadataDiskCache.Snapshot<Catalog> next=disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true);CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);AtomicBoolean written=new AtomicBoolean(true);
        Thread writer=new Thread(()->written.set(disk.writeReadyLive(SCOPE,UNTIL,NOW,next,POLICY,projection,()->{entered.countDown();try{return release.await(5,TimeUnit.SECONDS);}catch(InterruptedException stopped){return false;}})));
        writer.start();try{assertTrue(entered.await(5,TimeUnit.SECONDS));disk.clear();}finally{release.countDown();writer.join(5000);}
        assertFalse(writer.isAlive());assertFalse(written.get());assertEquals(0,directory.listFiles().length);
    }

    @Test public void corruptReadyRecordsNeverPartiallyRestoreOrPrimeItems()throws Exception {
        for(String mutation:Arrays.asList("checksum","version","saved","expiry","count","country","category","section","nan","infinity","position","utf8","duplicateSelected","danglingAlias","selfAlias","aliasCount","duplicateAlias","trailing")){
            File directory=temporary.newFolder();MetadataDiskCache disk=cache(directory);Catalog raw=raw();MetadataDiskCache.Snapshot<Catalog> receipt=disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true);
            assertTrue(disk.writeReadyLive(SCOPE,UNTIL,NOW,receipt,POLICY,curate(raw),()->true));File file=readyFile(directory,receipt,POLICY);byte[] bytes=Files.readAllBytes(file.toPath());Layout layout=new Layout(bytes);ByteBuffer buffer=ByteBuffer.wrap(bytes);
            switch(mutation){
                case "checksum":bytes[56]^=1;break;
                case "version":buffer.putInt(88,2);break;
                case "saved":buffer.putLong(92,NOW+1);break;
                case "expiry":buffer.putLong(100,UNTIL+1);break;
                case "count":buffer.putInt(108,50001);break;
                case "country":bytes[layout.country.get(0)+4]='z';break;
                case "category":bytes[layout.category.get(0)+4]='z';break;
                case "section":buffer.putInt(layout.section.get(0),13);break;
                case "nan":buffer.putDouble(layout.position.get(0),Double.NaN);break;
                case "infinity":buffer.putDouble(layout.position.get(0),Double.POSITIVE_INFINITY);break;
                case "position":buffer.putDouble(layout.position.get(0),1001);break;
                case "utf8":bytes[layout.title.get(0)+4]=(byte)255;break;
                case "duplicateSelected":bytes[layout.id.get(1)+4]=bytes[layout.id.get(0)+4];break;
                case "danglingAlias":bytes[layout.target.get(0)+4]='9';break;
                case "selfAlias":bytes[layout.target.get(1)+4]='3';break;
                case "aliasCount":buffer.putInt(layout.aliasCount,3);break;
                case "duplicateAlias":bytes[layout.alias.get(1)+4]=bytes[layout.alias.get(0)+4];break;
                case "trailing":bytes=Arrays.copyOf(bytes,bytes.length+1);break;
            }
            if(!mutation.equals("checksum"))checksum(bytes);Files.write(file.toPath(),bytes);
            assertNull(mutation,disk.readReadyLive(SCOPE,UNTIL,NOW,receipt,POLICY,Collections.emptySet()));assertFalse(mutation,file.exists());
            assertNotNull("Raw record survives ready corruption",disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW));
        }
    }

    @Test public void optionalReadyWritesHonorLowSpaceGuardAndSharedBudget()throws Exception {
        File directory=temporary.newFolder();AtomicLong free=new AtomicLong(1000000);MetadataDiskCache disk=new MetadataDiskCache(directory,4096,2048,1024,free::get);Catalog raw=raw();
        MetadataDiskCache.Snapshot<Catalog> receipt=disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->true);assertNotNull(receipt);LiveChannelCuration.Projection projection=curate(raw);
        assertFalse(disk.writeReadyLive(SCOPE,UNTIL,NOW,receipt,POLICY,projection,()->false));free.set(0);assertFalse(disk.writeReadyLive(SCOPE,UNTIL,NOW,receipt,POLICY,projection,()->true));free.set(1000000);
        for(int i=0;i<20;i++)assertTrue(disk.writeReadyLive(SCOPE,UNTIL,NOW,receipt,"policy-"+i,projection,()->true));
        long total=0;for(File file:directory.listFiles()){assertTrue(file.getName().endsWith(".bin"));assertTrue(file.length()<=2048);total+=file.length();}assertTrue(total<=4096);
        assertNull(disk.writeCatalog(SCOPE,UNTIL,NOW,raw,()->false));
    }

    @Test public void emptyCatalogAndLegacyRawRemainUsableWithoutChangingRawFormat()throws Exception {
        File directory=temporary.newFolder();MetadataDiskCache disk=cache(directory);Catalog empty=new Catalog(Kind.LIVE,Collections.emptyList(),Collections.emptyList());
        MetadataDiskCache.Snapshot<Catalog> receipt=disk.writeCatalog(SCOPE,UNTIL,NOW,empty,()->true);assertTrue(disk.writeReadyLive(SCOPE,UNTIL,NOW,receipt,POLICY,curate(empty),()->true));
        assertTrue(disk.readReadyLive(SCOPE,UNTIL,NOW,receipt,POLICY,Collections.emptySet()).catalog.items.isEmpty());
        byte[] raw=Files.readAllBytes(rawFile(directory).toPath());ByteBuffer.wrap(raw).putInt(0,0x46434d31);Files.write(rawFile(directory).toPath(),raw);
        MetadataDiskCache.Snapshot<Catalog> legacy=disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW+1);assertNotNull(legacy);assertEquals(0x46434d31,legacy.format);assertTrue(legacy.stale(NOW+1));assertEquals(NOW,legacy.originalSavedAt);
        assertNull("Raw format participates in ready identity",disk.readReadyLive(SCOPE,UNTIL,NOW+1,legacy,POLICY,Collections.emptySet()));
        assertTrue(disk.writeReadyLive(SCOPE,UNTIL,NOW+1,legacy,POLICY,curate(legacy.value),()->true));
        assertNotNull(disk.readReadyLive(SCOPE,UNTIL,NOW+2,disk.readCatalog(SCOPE,Kind.LIVE,UNTIL,NOW+2),POLICY,Collections.emptySet()));
        assertArrayEquals("Ready caching never rewrites legacy raw bytes",raw,Files.readAllBytes(rawFile(directory).toPath()));
    }

    private static final class Layout {
        final List<Integer> id=new ArrayList<>(),title=new ArrayList<>(),country=new ArrayList<>(),category=new ArrayList<>(),section=new ArrayList<>(),position=new ArrayList<>(),alias=new ArrayList<>(),target=new ArrayList<>();final int aliasCount;
        Layout(byte[] bytes){ByteBuffer b=ByteBuffer.wrap(bytes);b.position(108);int rows=b.getInt();for(int i=0;i<rows;i++){id.add(skip(b));title.add(skip(b));country.add(skip(b));category.add(skip(b));section.add(b.position());b.getInt();position.add(b.position());b.getDouble();}aliasCount=b.position();int aliases=b.getInt();for(int i=0;i<aliases;i++){alias.add(skip(b));target.add(skip(b));}}
        private static int skip(ByteBuffer b){int position=b.position(),size=b.getInt();b.position(b.position()+size);return position;}
    }
    private static void checksum(byte[] record)throws Exception{ByteBuffer.wrap(record).putInt(52,record.length-88);byte[] digest=MessageDigest.getInstance("SHA-256").digest(Arrays.copyOfRange(record,88,record.length));System.arraycopy(digest,0,record,56,32);}
    private static void assertItem(Item a,Item b){assertEquals(a.kind,b.kind);assertEquals(a.id,b.id);assertEquals(a.title,b.title);assertEquals(a.categoryId,b.categoryId);assertEquals(a.categoryName,b.categoryName);assertEquals(a.artwork,b.artwork);assertEquals(a.extension,b.extension);assertEquals(a.scope,b.scope);assertEquals(a.seriesId,b.seriesId);assertEquals(a.season,b.season);assertEquals(a.episode,b.episode);assertEquals(a.description,b.description);assertEquals(a.sourceTitle,b.sourceTitle);assertEquals(a.releaseYear,b.releaseYear);}
}
