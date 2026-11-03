package vip.flixify.tv.data;

import java.io.File;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.FilterInputStream;
import java.io.FilterOutputStream;
import java.io.RandomAccessFile;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.DigestInputStream;
import java.security.DigestOutputStream;
import java.util.Collections;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import vip.flixify.tv.TvModels.*;

final class MetadataDiskCache {
    static final long FRESH_MS=6L*60*60*1000,MAX_AGE_MS=7L*24*60*60*1000;
    private static final int MAGIC=0x46434d32,LEGACY_MAGIC=0x46434d31,MAX_ROWS=50000,MAX_EPISODES=5000,MAX_RECORDS=128;
    private static final java.util.regex.Pattern REFERENCE=java.util.regex.Pattern.compile("(?:LIVE|MOVIE|SERIES)::[1-9][0-9]{0,14}"),WATCHED_REFERENCE=java.util.regex.Pattern.compile("EPISODE:[1-9][0-9]{0,14}:[1-9][0-9]{0,14}"),DISPLAY_URL=java.util.regex.Pattern.compile("(?i)https?://\\S+"),MEDIA_PATH=java.util.regex.Pattern.compile(".*/(live|movie|series)/.*");
    private static final long BUDGET=64L*1024*1024,ENTRY=16L*1024*1024,FLOOR=32L*1024*1024;
    interface Valid {boolean get();}
    interface FreeSpace {long get();}
    private interface Encoder {void write(DataOutputStream output) throws Exception;}
    private interface Decoder<T> {T read(DataInputStream input,boolean legacy) throws Exception;}
    private final File root;
    private final long budget,maxEntry,floor;
    private final FreeSpace free;
    private final AtomicLong epoch=new AtomicLong();
    private final Object[] entryLocks=new Object[64];
    static final class Snapshot<T> {
        final T value;final long savedAt,expiresAt,originalSavedAt,originalExpiresAt,cacheEpoch;final int format;final String payloadHash;final MetadataDiskCache owner;
        Snapshot(T value,long savedAt,long expiresAt,int format,String payloadHash,long originalSavedAt,long originalExpiresAt,MetadataDiskCache owner,long cacheEpoch){
            this.value=value;this.savedAt=savedAt;this.expiresAt=expiresAt;this.format=format;this.payloadHash=payloadHash;this.originalSavedAt=originalSavedAt;this.originalExpiresAt=originalExpiresAt;this.owner=owner;this.cacheEpoch=cacheEpoch;
        }
        boolean stale(long now){return now-savedAt>=FRESH_MS;}
    }
    static final class Library {
        final Set<String> favorites,watched;final List<Item> items;final java.util.Map<String,Item> resolved;
        Library(Set<String> favorites,Set<String> watched,List<Item> items){
            this(favorites,watched,index(items));
        }
        Library(Set<String> favorites,Set<String> watched,java.util.Map<String,Item> resolved){
            this.favorites=Collections.unmodifiableSet(new HashSet<>(favorites));this.watched=Collections.unmodifiableSet(new HashSet<>(watched));this.resolved=Collections.unmodifiableMap(new java.util.LinkedHashMap<>(resolved));
            java.util.Map<String,Item> unique=new java.util.LinkedHashMap<>();for(Item item:resolved.values())unique.put(reference(item),item);this.items=Collections.unmodifiableList(new ArrayList<>(unique.values()));
        }
        private static java.util.Map<String,Item> index(List<Item> items){java.util.Map<String,Item> result=new java.util.LinkedHashMap<>();for(Item item:items)result.put(reference(item),item);return result;}
    }
    Snapshot<Library> readLibrary(String scope,long expiry,long now){
        return read(scope,"library:refs-v1",expiry,now,(input,legacy)->{
            Set<String> favorites=references(input,false),watched=references(input,true);java.util.Map<String,Item> resolved=new java.util.LinkedHashMap<>();int size=count(input,500);
            for(int n=0;n<size;n++){String key=string(input,64);Item value=item(input,scope,legacy);if(!resolvedFavorite(key,value,favorites) || resolved.put(key,value)!=null)throw new IOException();}
            return new Library(favorites,watched,resolved);
        });
    }
    void writeLibrary(String scope,long expiry,long now,Library value,Valid valid){
        if(value==null)return;
        write(scope,"library:refs-v1",expiry,now,valid,output->{
            references(output,value.favorites,false);references(output,value.watched,true);count(output,value.resolved.size(),500);
            for(java.util.Map.Entry<String,Item> resolved:value.resolved.entrySet()){String key=resolved.getKey();Item entry=resolved.getValue();if(!resolvedFavorite(key,entry,value.favorites))throw new IOException();string(output,key,64);item(output,entry,scope);}
        });
    }
    private static boolean resolvedFavorite(String key,Item value,Set<String> favorites){return value!=null && value.kind!=Kind.EPISODE && favorites.contains(key) && (key.equals(reference(value)) || (value.kind==Kind.LIVE && key.startsWith("LIVE::")));}
    private static String reference(Item value){return value.kind.name()+":"+value.seriesId+":"+value.id;}
    private static boolean reference(String value,boolean watched){return value!=null && (watched?WATCHED_REFERENCE:REFERENCE).matcher(value).matches();}
    private static Set<String> references(DataInputStream input,boolean watched)throws IOException{
        Set<String> values=new HashSet<>();int size=count(input,watched?20000:500);for(int n=0;n<size;n++){String value=string(input,64);if(!reference(value,watched) || !values.add(value))throw new IOException();}return values;
    }
    private static void references(DataOutputStream output,Set<String> values,boolean watched)throws IOException{
        count(output,values.size(),watched?20000:500);for(String value:new java.util.TreeSet<>(values)){if(!reference(value,watched))throw new IOException();string(output,value,64);}
    }
    MetadataDiskCache(File root){this(root,BUDGET,ENTRY,FLOOR,root::getUsableSpace);}
    MetadataDiskCache(File root,long budget,long maxEntry,long floor,FreeSpace free){
        for(int n=0;n<entryLocks.length;n++)entryLocks[n]=new Object();
        this.root=root;this.budget=budget;this.maxEntry=maxEntry;this.floor=floor;this.free=free;
        File[] abandoned=root.listFiles(file->file.getName().endsWith(".tmp"));if(abandoned!=null)for(File file:abandoned)file.delete();
    }
    private static String catalogKey(Kind kind){return kind==Kind.LIVE?"catalog:LIVE:ts-default-v2":"catalog:"+kind.name();}
    Snapshot<Catalog> readCatalog(String scope,Kind kind,long expiry,long now){
        if(kind==null || kind==Kind.EPISODE)return null;
        return read(scope,catalogKey(kind),expiry,now,(input,legacy)->{
            List<Category> categories=new ArrayList<>();int groups=count(input,MAX_ROWS);
            for(int i=0;i<groups;i++)categories.add(new Category(string(input,15),string(input,256)));
            List<Item> items=new ArrayList<>();Set<String> ids=new HashSet<>();int size=count(input,MAX_ROWS);
            for(int i=0;i<size;i++){Item value=item(input,scope,legacy);if(value.kind!=kind || !ids.add(value.id))throw new IOException();items.add(value);}
            return new Catalog(kind,items,categories);
        });
    }
    private static String readyKey(Snapshot<Catalog> raw,String policy){return "live-ready:v1:"+raw.format+":"+raw.payloadHash+":"+policy;}
    private boolean readyRaw(String scope,Snapshot<Catalog> raw,long expiry,long now){
        if(raw==null || raw.owner!=this || raw.cacheEpoch!=epoch.get() || raw.value.kind!=Kind.LIVE || raw.originalSavedAt<0 || raw.originalSavedAt>now || now-raw.originalSavedAt>=MAX_AGE_MS
                || Math.min(expiry,raw.expiresAt)<=now || raw.payloadHash.length()!=64)return false;
        for(Item item:raw.value.items)if(item.kind!=Kind.LIVE || !scope.equals(item.scope))return false;
        return true;
    }
    private static final class ReadyData {
        final LiveChannelCuration.Projection projection;final List<LiveChannelCuration.ReadyItem> rows;
        ReadyData(LiveChannelCuration.Projection projection,List<LiveChannelCuration.ReadyItem> rows){this.projection=projection;this.rows=rows;}
    }
    LiveChannelCuration.Projection readReadyLive(String scope,long expiry,long now,Snapshot<Catalog> raw,String policy,Set<String> excluded){
        if(!readyRaw(scope,raw,expiry,now))return null;
        Snapshot<ReadyData> stored=read(scope,readyKey(raw,policy),Math.min(expiry,raw.expiresAt),now,(input,legacy)->{
            if(legacy || input.readInt()!=1 || input.readLong()!=raw.originalSavedAt || input.readLong()!=raw.originalExpiresAt)throw new IOException();
            int size=count(input,Math.min(MAX_ROWS,raw.value.items.size()));List<LiveChannelCuration.ReadyItem> rows=new ArrayList<>(size);
            for(int i=0;i<size;i++){
                String id=string(input,15),title=string(input,512),country=string(input,16),category=string(input,32);int section=input.readInt();double position=input.readDouble();
                if(!id(id) || !title.equals(display(title)))throw new IOException();
                rows.add(new LiveChannelCuration.ReadyItem(id,title,new LiveChannelLineup.Info(country,category,title,id,section,position)));
            }
            int aliases=count(input,MAX_ROWS);if(aliases!=raw.value.items.size())throw new IOException();
            java.util.Map<String,String> complete=new java.util.LinkedHashMap<>();
            for(int i=0;i<aliases;i++){
                String id=string(input,15),target=string(input,15);
                if(!id(id) || !target.isEmpty() && !id(target) || complete.put(id,target)!=null)throw new IOException();
            }
            return new ReadyData(LiveChannelCuration.restore(raw.value,rows,complete,excluded),rows);
        });
        if(stored==null || stored.originalSavedAt!=raw.originalSavedAt || stored.originalExpiresAt>raw.originalExpiresAt || !readyRaw(scope,raw,expiry,now))return null;
        LiveChannelCuration.prime(stored.value.projection,stored.value.rows);return stored.value.projection;
    }
    boolean writeReadyLive(String scope,long expiry,long now,Snapshot<Catalog> raw,String policy,LiveChannelCuration.Projection projection,Valid valid){
        if(!readyRaw(scope,raw,expiry,now) || projection==null || projection.catalog.kind!=Kind.LIVE)return false;
        return write(scope,readyKey(raw,policy),Math.min(expiry,raw.expiresAt),raw.originalSavedAt,()->raw.cacheEpoch==epoch.get() && valid.get(),output->{
            output.writeInt(1);output.writeLong(raw.originalSavedAt);output.writeLong(raw.originalExpiresAt);
            count(output,projection.catalog.items.size(),Math.min(MAX_ROWS,raw.value.items.size()));
            for(Item item:projection.catalog.items){
                LiveChannelLineup.Info info=LiveChannelLineup.snapshotInfo(item);
                if(!id(item.id) || !item.title.equals(display(item.title)) || !wellFormed(item.title) || !LiveChannelLineup.validSnapshot(info,item.id,item.title))throw new IOException();
                string(output,item.id,15);string(output,item.title,512);string(output,info.countryId,16);string(output,info.categoryId,32);output.writeInt(info.section);output.writeDouble(info.position);
            }
            count(output,raw.value.items.size(),MAX_ROWS);
            for(Item item:raw.value.items){
                if(projection.original(item.id)!=item)throw new IOException();String target=projection.canonicalId(item.id);
                string(output,item.id,15);string(output,target==null?"":target,15);
            }
        })!=null;
    }
    Snapshot<SeriesDetail> readSeries(String scope,String id,long expiry,long now){
        if(!id(id))return null;
        return read(scope,"series:"+id,expiry,now,(input,legacy)->{
            Item parent=item(input,scope,legacy);if(parent.kind!=Kind.SERIES || !parent.id.equals(id))throw new IOException();
            List<Season> seasons=new ArrayList<>();Set<String> seen=new HashSet<>();int total=0,size=count(input,MAX_EPISODES);
            for(int i=0;i<size;i++){
                int number=input.readInt(),length=count(input,MAX_EPISODES);if(number<1 || number>999 || (total+=length)>MAX_EPISODES)throw new IOException();
                List<Item> episodes=new ArrayList<>();for(int j=0;j<length;j++){Item value=item(input,scope,legacy);if(value.kind!=Kind.EPISODE || !id.equals(value.seriesId) || value.season!=number || !seen.add(value.id))throw new IOException();episodes.add(value);}
                seasons.add(new Season(number,episodes));
            }
            return new SeriesDetail(parent,seasons);
        });
    }
    Snapshot<Catalog> writeCatalog(String scope,long expiry,long now,Catalog value,Valid valid){
        if(value==null || value.kind==null || value.kind==Kind.EPISODE)return null;
        boolean[] compatible={true};long lease=epoch.get();
        String digest=write(scope,catalogKey(value.kind),expiry,now,()->lease==epoch.get() && valid.get(),output->{
            count(output,value.categories.size(),MAX_ROWS);for(Category category:value.categories){
                if(!id(category.id))throw new IOException();String title=display(category.title);
                compatible[0]&=title.equals(category.title) && wellFormed(title);string(output,category.id,15);string(output,title,256);
            }
            count(output,value.items.size(),MAX_ROWS);Set<String> seen=new HashSet<>();
            for(Item entry:value.items){if(entry.kind!=value.kind || !seen.add(entry.id))throw new IOException();item(output,entry,scope,compatible);}
        });
        return digest==null || !compatible[0] || lease!=epoch.get()?null:new Snapshot<>(value,now,expiry,MAGIC,digest,now,expiry,this,lease);
    }
    void writeSeries(String scope,long expiry,long now,SeriesDetail value,Valid valid){
        if(value==null || value.series==null || value.series.kind!=Kind.SERIES)return;
        write(scope,"series:"+value.series.id,expiry,now,valid,output->{
            item(output,value.series,scope);count(output,value.seasons.size(),MAX_EPISODES);int total=0;Set<String> seen=new HashSet<>();
            for(Season season:value.seasons){if(season.number<1 || season.number>999 || (total+=season.episodes.size())>MAX_EPISODES)throw new IOException();output.writeInt(season.number);count(output,season.episodes.size(),MAX_EPISODES);
                for(Item entry:season.episodes){if(entry.kind!=Kind.EPISODE || !entry.seriesId.equals(value.series.id) || entry.season!=season.number || !seen.add(entry.id))throw new IOException();item(output,entry,scope);}}
        });
    }
    private <T> Snapshot<T> read(String scope,String key,long expiry,long now,Decoder<T> decoder){
        try{
            byte[] identity=hash(scope+"\u0000"+key);
            synchronized(entryLock(identity)){return readEntry(scope,key,expiry,now,decoder);}
        }catch(Exception ignored){return null;}
    }
    private Object entryLock(byte[] identity){return entryLocks[(identity[0]&255)%entryLocks.length];}
    private <T> Snapshot<T> readEntry(String scope,String key,long expiry,long now,Decoder<T> decoder){
        File file=null;long lease=epoch.get();
        try {
            if(!scope(scope) || expiry<=now)return null;byte[] hash=hash(scope+"\u0000"+key);file=file(hash);
            if(!file.isFile() || file.length()<92 || file.length()>maxEntry)return null;
            try(DataInputStream input=new DataInputStream(new BufferedInputStream(new FileInputStream(file)))){
                int magic=input.readInt();if(magic!=MAGIC && magic!=LEGACY_MAGIC)throw new IOException();boolean legacy=magic==LEGACY_MAGIC;byte[] storedKey=new byte[32];input.readFully(storedKey);if(!Arrays.equals(hash,storedKey))throw new IOException();
                long saved=input.readLong(),until=input.readLong();if(saved>now || saved<0 || now-saved>=MAX_AGE_MS || Math.min(until,expiry)<=now)return null;
                int size=input.readInt();if(size<0 || size>maxEntry-88 || file.length()!=size+88L)throw new IOException();
                byte[] checksum=new byte[32];input.readFully(checksum);MessageDigest digest=MessageDigest.getInstance("SHA-256");
                FilterInputStream bounded=new FilterInputStream(input){
                    private int remaining=size;
                    @Override public int read()throws IOException{if(remaining==0)return -1;int value=in.read();if(value<0)throw new IOException();remaining--;return value;}
                    @Override public int read(byte[] bytes,int offset,int length)throws IOException{if(length==0)return 0;if(remaining==0)return -1;int count=in.read(bytes,offset,Math.min(length,remaining));if(count<0)throw new IOException();remaining-=count;return count;}
                };
                // Hash payload chunks while primitive decoding consumes the buffer.
                DataInputStream data=new DataInputStream(new BufferedInputStream(new DigestInputStream(bounded,digest),32768));T value=decoder.read(data,legacy);
                if(data.read()!=-1 || !MessageDigest.isEqual(checksum,digest.digest()))throw new IOException();
                if(lease!=epoch.get())return null;
                file.setLastModified(System.currentTimeMillis());return new Snapshot<>(value,legacy?Math.min(saved,now-FRESH_MS):saved,Math.min(until,expiry),magic,hex(checksum),saved,until,this,lease);
            }
        }catch(Exception ignored){if(file!=null && lease==epoch.get())file.delete();return null;}
    }
    private String write(String scope,String key,long expiry,long now,Valid valid,Encoder encoder){
        File temporary=null;long lease=epoch.get();
        try {
            if(!scope(scope) || expiry<=now || !valid.get())return null;
            byte[] hash=hash(scope+"\u0000"+key);
            synchronized(this){
                if(lease!=epoch.get() || (!root.isDirectory() && !root.mkdirs()))return null;
                temporary=File.createTempFile("metadata-",".tmp",root);
            }
            if(free.get()<floor+88)return null;
            MessageDigest digest=MessageDigest.getInstance("SHA-256");long[] size={0};
            try(FileOutputStream stream=new FileOutputStream(temporary)){
                DataOutputStream header=new DataOutputStream(stream);header.writeInt(MAGIC);header.write(hash);header.writeLong(now);header.writeLong(expiry);header.writeInt(0);header.write(new byte[32]);header.flush();
                FilterOutputStream bounded=new FilterOutputStream(stream){
                    @Override public void write(int value)throws IOException{byte[] one={(byte)value};write(one,0,1);}
                    @Override public void write(byte[] bytes,int offset,int length)throws IOException{
                        if(length<0 || size[0]+length>maxEntry-88 || size[0]+length+88>budget || lease!=epoch.get() || !valid.get() || free.get()<floor+length)throw new IOException();
                        out.write(bytes,offset,length);size[0]+=length;
                    }
                };
                DataOutputStream output=new DataOutputStream(new DigestOutputStream(new BufferedOutputStream(bounded),digest));encoder.write(output);output.flush();
            }
            if(lease!=epoch.get() || !valid.get() || free.get()<floor)return null;
            byte[] checksum=digest.digest();
            try(RandomAccessFile header=new RandomAccessFile(temporary,"rw")){header.seek(52);header.writeInt((int)size[0]);header.write(checksum);header.getFD().sync();}
            synchronized(entryLock(hash)){
                synchronized(this){
                    if(lease!=epoch.get() || !valid.get() || !temporary.renameTo(file(hash)))return null;
                    temporary=null;trim(file(hash));
                }
            }
            return hex(checksum);
        }catch(Exception ignored){ /* Metadata caching never changes network admission or its result. */ }
        finally{if(temporary!=null)temporary.delete();}
        return null;
    }
    void clear(){synchronized(this){epoch.incrementAndGet();File[] files=root.listFiles();if(files!=null)for(File file:files)if(file.getName().endsWith(".bin") || file.getName().endsWith(".tmp"))file.delete();}}
    private void trim(File keep){File[] files=root.listFiles(file->file.getName().endsWith(".bin"));if(files==null)return;Arrays.sort(files,(a,b)->Long.compare(a.lastModified(),b.lastModified()));long total=0;int count=files.length;for(File file:files)total+=file.length();for(File file:files)if((total>budget || count>MAX_RECORDS) && !file.equals(keep)){long size=file.length();if(file.delete()){total-=size;count--;}}}
    private File file(byte[] hash){StringBuilder name=new StringBuilder();for(byte value:hash)name.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return new File(root,name+".bin");}
    private static String hex(byte[] bytes){char[] result=new char[bytes.length*2];String digits="0123456789abcdef";for(int i=0;i<bytes.length;i++){result[i*2]=digits.charAt((bytes[i]&255)>>>4);result[i*2+1]=digits.charAt(bytes[i]&15);}return new String(result);}
    private static byte[] hash(String value)throws Exception{return hash(value.getBytes(StandardCharsets.UTF_8));}
    private static byte[] hash(byte[] value)throws Exception{return MessageDigest.getInstance("SHA-256").digest(value);}
    private static boolean scope(String value){return value!=null && value.length()<=512 && value.indexOf(':')>0;}
    private static boolean id(String value){
        if(value==null || value.isEmpty() || value.length()>15 || value.charAt(0)<'1' || value.charAt(0)>'9')return false;
        for(int n=1;n<value.length();n++)if(value.charAt(n)<'0' || value.charAt(n)>'9')return false;
        return true;
    }
    private static int count(DataInputStream input,int max)throws IOException{int value=input.readInt();if(value<0 || value>max)throw new IOException();return value;}
    private static void count(DataOutputStream output,int value,int max)throws IOException{if(value<0 || value>max)throw new IOException();output.writeInt(value);}
    private static String string(DataInputStream input,int max)throws IOException{
        int count=count(input,max*4);if(count==0)return "";byte[] bytes=new byte[count];input.readFully(bytes);return decodeUtf8(bytes,max);
    }
    static String decodeUtf8(byte[] bytes,int max)throws IOException{
        if(max<0)throw new IOException();
        // Native decoding is safe only after rejecting replacement-producing byte sequences.
        int chars=0;
        for(int n=0;n<bytes.length;){
            int first=bytes[n++]&255;
            if(first<128){chars++;}
            else if(first>=194 && first<=223){
                if(n>=bytes.length || !continuation(bytes[n++]))throw new IOException();chars++;
            }else if(first>=224 && first<=239){
                if(n+1>=bytes.length)throw new IOException();int second=bytes[n++]&255;
                if(second<128 || second>191 || (first==224 && second<160) || (first==237 && second>159) || !continuation(bytes[n++]))throw new IOException();chars++;
            }else if(first>=240 && first<=244){
                if(n+2>=bytes.length)throw new IOException();int second=bytes[n++]&255;
                if(second<128 || second>191 || (first==240 && second<144) || (first==244 && second>143) || !continuation(bytes[n++]) || !continuation(bytes[n++]))throw new IOException();chars+=2;
            }else throw new IOException();
            if(chars>max)throw new IOException();
        }
        return new String(bytes,StandardCharsets.UTF_8);
    }
    private static boolean continuation(byte value){return (value&192)==128;}
    private static void string(DataOutputStream output,String value,int max)throws IOException{if(value==null || value.length()>max)throw new IOException();byte[] bytes=value.getBytes(StandardCharsets.UTF_8);output.writeInt(bytes.length);output.write(bytes);}
    private static String display(String value){return DISPLAY_URL.matcher(value).replaceAll("");}
    private static String artwork(String value){if(value==null || value.isEmpty())return "";try{URI uri=new URI(value);String path=uri.getPath();return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost()!=null && uri.getRawUserInfo()==null && uri.getRawQuery()==null && uri.getRawFragment()==null && path!=null && !MEDIA_PATH.matcher(path.toLowerCase(java.util.Locale.ROOT)).matches()?value:"";}catch(Exception ignored){return "";}}
    private static boolean wellFormed(String value){
        for(int i=0;i<value.length();i++){char c=value.charAt(i);if(Character.isHighSurrogate(c)){if(++i>=value.length() || !Character.isLowSurrogate(value.charAt(i)))return false;}else if(Character.isLowSurrogate(c))return false;}return true;
    }
    private static void item(DataOutputStream output,Item value,String scope)throws IOException{item(output,value,scope,null);}
    private static void item(DataOutputStream output,Item value,String scope,boolean[] compatible)throws IOException{
        if(value==null || value.kind==null || !scope.equals(value.scope) || !id(value.id) || (value.kind==Kind.EPISODE?!id(value.seriesId):!value.seriesId.isEmpty()))throw new IOException();
        String title=display(value.title),group=display(value.categoryName),art=artwork(value.artwork),description=display(value.description);
        if(compatible!=null)compatible[0]&=!title.isEmpty() && title.equals(value.title) && title.equals(value.sourceTitle) && group.equals(value.categoryName) && art.equals(value.artwork) && description.equals(value.description)
            && wellFormed(title) && wellFormed(group) && wellFormed(art) && wellFormed(description) && wellFormed(value.categoryId)
            && (value.extension.isEmpty() || extension(value.extension)) && (value.releaseYear==0 || value.releaseYear>=1900 && value.releaseYear<=2099);
        output.writeByte(value.kind.ordinal());string(output,value.id,15);string(output,title,512);string(output,value.categoryId,15);string(output,group,256);string(output,art,2048);string(output,value.extension,5);string(output,value.seriesId,15);output.writeInt(value.season);output.writeInt(value.episode);string(output,description,8192);output.writeInt(value.releaseYear);
    }
    private static boolean extension(String value){return "mp4".equals(value) || "mkv".equals(value) || "avi".equals(value) || "m3u8".equals(value) || "ts".equals(value);}
    private static Item item(DataInputStream input,String scope,boolean legacy)throws IOException{
        int type=input.readUnsignedByte();if(type>=Kind.values().length)throw new IOException();Kind kind=Kind.values()[type];
        String id=string(input,15),title=string(input,512),categoryId=string(input,15),categoryName=string(input,256),art=artwork(string(input,2048)),extension=string(input,5),seriesId=string(input,15);int season=input.readInt(),episode=input.readInt();String description=string(input,8192);
        int releaseYear=legacy?vip.flixify.tv.CatalogReleaseYear.title(title):input.readInt();if(releaseYear!=0 && (releaseYear<1900 || releaseYear>2099))throw new IOException();
        Item value=new Item(kind,id,title,categoryId,categoryName,art,extension,scope,seriesId,season,episode,description,releaseYear);
        if(!id(value.id) || value.title.isEmpty() || (kind==Kind.EPISODE?(!id(value.seriesId) || value.season<1 || value.season>999 || value.episode<1 || value.episode>9999):!value.seriesId.isEmpty()) || (!value.extension.isEmpty() && !extension(value.extension)))throw new IOException();return value;
    }
}
