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
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
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
    private static final int MAGIC=0x46434d31,MAX_ROWS=50000,MAX_EPISODES=5000,MAX_RECORDS=128;
    private static final long BUDGET=64L*1024*1024,ENTRY=16L*1024*1024,FLOOR=32L*1024*1024;
    interface Valid {boolean get();}
    interface FreeSpace {long get();}
    private interface Encoder {void write(DataOutputStream output) throws Exception;}
    private interface Decoder<T> {T read(DataInputStream input) throws Exception;}
    private final File root;
    private final long budget,maxEntry,floor;
    private final FreeSpace free;
    private final AtomicLong epoch=new AtomicLong();
    static final class Snapshot<T> {
        final T value;final long savedAt,expiresAt;
        Snapshot(T value,long savedAt,long expiresAt){this.value=value;this.savedAt=savedAt;this.expiresAt=expiresAt;}
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
        return read(scope,"library:refs-v1",expiry,now,input->{
            Set<String> favorites=references(input,false),watched=references(input,true);java.util.Map<String,Item> resolved=new java.util.LinkedHashMap<>();int size=count(input,500);
            for(int n=0;n<size;n++){String key=string(input,64);Item value=item(input,scope);if(!resolvedFavorite(key,value,favorites) || resolved.put(key,value)!=null)throw new IOException();}
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
    private static boolean reference(String value,boolean watched){return value!=null && value.matches(watched?"EPISODE:[1-9][0-9]{0,14}:[1-9][0-9]{0,14}":"(?:LIVE|MOVIE|SERIES)::[1-9][0-9]{0,14}");}
    private static Set<String> references(DataInputStream input,boolean watched)throws IOException{
        Set<String> values=new HashSet<>();int size=count(input,watched?20000:500);for(int n=0;n<size;n++){String value=string(input,64);if(!reference(value,watched) || !values.add(value))throw new IOException();}return values;
    }
    private static void references(DataOutputStream output,Set<String> values,boolean watched)throws IOException{
        count(output,values.size(),watched?20000:500);for(String value:new java.util.TreeSet<>(values)){if(!reference(value,watched))throw new IOException();string(output,value,64);}
    }
    MetadataDiskCache(File root){this(root,BUDGET,ENTRY,FLOOR,root::getUsableSpace);}
    MetadataDiskCache(File root,long budget,long maxEntry,long floor,FreeSpace free){
        this.root=root;this.budget=budget;this.maxEntry=maxEntry;this.floor=floor;this.free=free;
        File[] abandoned=root.listFiles(file->file.getName().endsWith(".tmp"));if(abandoned!=null)for(File file:abandoned)file.delete();
    }
    private static String catalogKey(Kind kind){return kind==Kind.LIVE?"catalog:LIVE:ts-default-v2":"catalog:"+kind.name();}
    Snapshot<Catalog> readCatalog(String scope,Kind kind,long expiry,long now){
        if(kind==null || kind==Kind.EPISODE)return null;
        return read(scope,catalogKey(kind),expiry,now,input->{
            List<Category> categories=new ArrayList<>();int groups=count(input,MAX_ROWS);
            for(int i=0;i<groups;i++)categories.add(new Category(string(input,15),string(input,256)));
            List<Item> items=new ArrayList<>();Set<String> ids=new HashSet<>();int size=count(input,MAX_ROWS);
            for(int i=0;i<size;i++){Item value=item(input,scope);if(value.kind!=kind || !ids.add(value.id))throw new IOException();items.add(value);}
            return new Catalog(kind,items,categories);
        });
    }
    Snapshot<SeriesDetail> readSeries(String scope,String id,long expiry,long now){
        if(!id(id))return null;
        return read(scope,"series:"+id,expiry,now,input->{
            Item parent=item(input,scope);if(parent.kind!=Kind.SERIES || !parent.id.equals(id))throw new IOException();
            List<Season> seasons=new ArrayList<>();Set<String> seen=new HashSet<>();int total=0,size=count(input,MAX_EPISODES);
            for(int i=0;i<size;i++){
                int number=input.readInt(),length=count(input,MAX_EPISODES);if(number<1 || number>999 || (total+=length)>MAX_EPISODES)throw new IOException();
                List<Item> episodes=new ArrayList<>();for(int j=0;j<length;j++){Item value=item(input,scope);if(value.kind!=Kind.EPISODE || !id.equals(value.seriesId) || value.season!=number || !seen.add(value.id))throw new IOException();episodes.add(value);}
                seasons.add(new Season(number,episodes));
            }
            return new SeriesDetail(parent,seasons);
        });
    }
    void writeCatalog(String scope,long expiry,long now,Catalog value,Valid valid){
        if(value==null || value.kind==null || value.kind==Kind.EPISODE)return;
        write(scope,catalogKey(value.kind),expiry,now,valid,output->{
            count(output,value.categories.size(),MAX_ROWS);for(Category category:value.categories){if(!id(category.id))throw new IOException();string(output,category.id,15);string(output,display(category.title),256);}
            count(output,value.items.size(),MAX_ROWS);Set<String> seen=new HashSet<>();
            for(Item entry:value.items){if(entry.kind!=value.kind || !seen.add(entry.id))throw new IOException();item(output,entry,scope);}
        });
    }
    void writeSeries(String scope,long expiry,long now,SeriesDetail value,Valid valid){
        if(value==null || value.series==null || value.series.kind!=Kind.SERIES)return;
        write(scope,"series:"+value.series.id,expiry,now,valid,output->{
            item(output,value.series,scope);count(output,value.seasons.size(),MAX_EPISODES);int total=0;Set<String> seen=new HashSet<>();
            for(Season season:value.seasons){if(season.number<1 || season.number>999 || (total+=season.episodes.size())>MAX_EPISODES)throw new IOException();output.writeInt(season.number);count(output,season.episodes.size(),MAX_EPISODES);
                for(Item entry:season.episodes){if(entry.kind!=Kind.EPISODE || !entry.seriesId.equals(value.series.id) || entry.season!=season.number || !seen.add(entry.id))throw new IOException();item(output,entry,scope);}}
        });
    }
    private synchronized <T> Snapshot<T> read(String scope,String key,long expiry,long now,Decoder<T> decoder){
        File file=null;
        try {
            if(!scope(scope) || expiry<=now)return null;byte[] hash=hash(scope+"\u0000"+key);file=file(hash);
            if(!file.isFile() || file.length()<92 || file.length()>maxEntry)return null;
            try(DataInputStream input=new DataInputStream(new BufferedInputStream(new FileInputStream(file)))){
                if(input.readInt()!=MAGIC)throw new IOException();byte[] storedKey=new byte[32];input.readFully(storedKey);if(!Arrays.equals(hash,storedKey))throw new IOException();
                long saved=input.readLong(),until=input.readLong();if(saved>now || saved<0 || now-saved>=MAX_AGE_MS || Math.min(until,expiry)<=now)return null;
                int size=input.readInt();if(size<0 || size>maxEntry-88 || file.length()!=size+88L)throw new IOException();
                byte[] checksum=new byte[32];input.readFully(checksum);MessageDigest digest=MessageDigest.getInstance("SHA-256");
                FilterInputStream bounded=new FilterInputStream(input){
                    private int remaining=size;
                    @Override public int read()throws IOException{if(remaining==0)return -1;int value=in.read();if(value<0)throw new IOException();remaining--;return value;}
                    @Override public int read(byte[] bytes,int offset,int length)throws IOException{if(length==0)return 0;if(remaining==0)return -1;int count=in.read(bytes,offset,Math.min(length,remaining));if(count<0)throw new IOException();remaining-=count;return count;}
                };
                DataInputStream data=new DataInputStream(new DigestInputStream(bounded,digest));T value=decoder.read(data);
                if(data.read()!=-1 || !MessageDigest.isEqual(checksum,digest.digest()))throw new IOException();
                file.setLastModified(System.currentTimeMillis());return new Snapshot<>(value,saved,Math.min(until,expiry));
            }
        }catch(Exception ignored){if(file!=null)file.delete();return null;}
    }
    private synchronized void write(String scope,String key,long expiry,long now,Valid valid,Encoder encoder){
        File temporary=null;long lease=epoch.get();
        try {
            if(!scope(scope) || expiry<=now || !valid.get() || (!root.isDirectory() && !root.mkdirs()) || free.get()<floor+88)return;
            byte[] hash=hash(scope+"\u0000"+key);temporary=File.createTempFile("metadata-",".tmp",root);MessageDigest digest=MessageDigest.getInstance("SHA-256");long[] size={0};
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
            if(lease!=epoch.get() || !valid.get() || free.get()<floor)return;
            try(RandomAccessFile header=new RandomAccessFile(temporary,"rw")){header.seek(52);header.writeInt((int)size[0]);header.write(digest.digest());header.getFD().sync();}
            if(lease!=epoch.get() || !valid.get() || !temporary.renameTo(file(hash)))return;
            temporary=null;trim(file(hash));
        }catch(Exception ignored){ /* Metadata caching never changes network admission or its result. */ }
        finally{if(temporary!=null)temporary.delete();}
    }
    void clear(){epoch.incrementAndGet();synchronized(this){File[] files=root.listFiles();if(files!=null)for(File file:files)if(file.getName().endsWith(".bin") || file.getName().endsWith(".tmp"))file.delete();}}
    private void trim(File keep){File[] files=root.listFiles(file->file.getName().endsWith(".bin"));if(files==null)return;Arrays.sort(files,(a,b)->Long.compare(a.lastModified(),b.lastModified()));long total=0;int count=files.length;for(File file:files)total+=file.length();for(File file:files)if((total>budget || count>MAX_RECORDS) && !file.equals(keep)){long size=file.length();if(file.delete()){total-=size;count--;}}}
    private File file(byte[] hash){StringBuilder name=new StringBuilder();for(byte value:hash)name.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return new File(root,name+".bin");}
    private static byte[] hash(String value)throws Exception{return hash(value.getBytes(StandardCharsets.UTF_8));}
    private static byte[] hash(byte[] value)throws Exception{return MessageDigest.getInstance("SHA-256").digest(value);}
    private static boolean scope(String value){return value!=null && value.length()<=512 && value.indexOf(':')>0;}
    private static boolean id(String value){return value!=null && value.matches("[1-9][0-9]{0,14}");}
    private static int count(DataInputStream input,int max)throws IOException{int value=input.readInt();if(value<0 || value>max)throw new IOException();return value;}
    private static void count(DataOutputStream output,int value,int max)throws IOException{if(value<0 || value>max)throw new IOException();output.writeInt(value);}
    private static String string(DataInputStream input,int max)throws IOException{
        int count=count(input,max*4);byte[] bytes=new byte[count];input.readFully(bytes);
        try{String value=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();if(value.length()>max)throw new IOException();return value;}catch(java.nio.charset.CharacterCodingException e){throw new IOException();}
    }
    private static void string(DataOutputStream output,String value,int max)throws IOException{if(value==null || value.length()>max)throw new IOException();byte[] bytes=value.getBytes(StandardCharsets.UTF_8);output.writeInt(bytes.length);output.write(bytes);}
    private static String display(String value){return value.replaceAll("(?i)https?://\\S+","");}
    private static String artwork(String value){try{URI uri=new URI(value);String path=uri.getPath();return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost()!=null && uri.getRawUserInfo()==null && uri.getRawQuery()==null && uri.getRawFragment()==null && path!=null && !path.toLowerCase(java.util.Locale.ROOT).matches(".*/(live|movie|series)/.*")?value:"";}catch(Exception ignored){return "";}}
    private static void item(DataOutputStream output,Item value,String scope)throws IOException{
        if(value==null || value.kind==null || !scope.equals(value.scope) || !id(value.id) || (value.kind==Kind.EPISODE?!id(value.seriesId):!value.seriesId.isEmpty()))throw new IOException();
        output.writeByte(value.kind.ordinal());string(output,value.id,15);string(output,display(value.title),512);string(output,value.categoryId,15);string(output,display(value.categoryName),256);string(output,artwork(value.artwork),2048);string(output,value.extension,5);string(output,value.seriesId,15);output.writeInt(value.season);output.writeInt(value.episode);string(output,display(value.description),8192);
    }
    private static Item item(DataInputStream input,String scope)throws IOException{
        int type=input.readUnsignedByte();if(type>=Kind.values().length)throw new IOException();Kind kind=Kind.values()[type];
        Item value=new Item(kind,string(input,15),string(input,512),string(input,15),string(input,256),artwork(string(input,2048)),string(input,5),scope,string(input,15),input.readInt(),input.readInt(),string(input,8192));
        if(!id(value.id) || value.title.isEmpty() || (kind==Kind.EPISODE?(!id(value.seriesId) || value.season<1 || value.season>999 || value.episode<1 || value.episode>9999):!value.seriesId.isEmpty()) || (!value.extension.isEmpty() && !Arrays.asList("mp4","mkv","avi","m3u8","ts").contains(value.extension)))throw new IOException();return value;
    }
}
