package vip.flixify.tv;

import java.io.File;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

final class ArtworkDiskCache {
    interface Allowed {boolean getAsBoolean();}
    interface LongValue {long getAsLong();}
    static final int MAX_RESPONSE=2*1024*1024;
    static final long TTL_MS=7L*24*60*60*1000;
    private static final int MAGIC=0x46584131, HEADER=48;
    private final File directory;
    private final long budget,ttl,reserve;
    private final LongValue clock,freeSpace;
    static final class Entry {
        final byte[] bytes;final long expiresAt;
        Entry(byte[] bytes,long expiresAt) {this.bytes=bytes;this.expiresAt=expiresAt;}
    }
    ArtworkDiskCache(File directory) {this(directory,64L*1024*1024,TTL_MS,32L*1024*1024,System::currentTimeMillis,directory::getUsableSpace);}
    ArtworkDiskCache(File directory,long budget,long ttl,long reserve,LongValue clock,LongValue freeSpace) {
        this.directory=directory;this.budget=budget;this.ttl=ttl;this.reserve=reserve;this.clock=clock;this.freeSpace=freeSpace;
        if(ready()) {for(File file:files())if(file.getName().endsWith(".tmp"))file.delete();trim();}
    }
    static String key(String scope,String address) {
        if(scope==null || scope.isEmpty() || address==null || address.isEmpty())return null;
        byte[] hash=digest((scope.length()+":"+scope+address).getBytes(StandardCharsets.UTF_8));
        StringBuilder text=new StringBuilder(64);for(byte value:hash)text.append(Character.forDigit((value>>>4)&15,16)).append(Character.forDigit(value&15,16));
        return text.toString();
    }
    synchronized byte[] read(String scope,String address) {Entry entry=readEntry(scope,address);return entry==null?null:entry.bytes;}
    synchronized Entry readEntry(String scope,String address) {
        String key=key(scope,address);if(key==null)return null;
        File file=new File(directory,key+".art");if(!file.isFile())return null;
        try(DataInputStream input=new DataInputStream(new FileInputStream(file))) {
            if(input.readInt()!=MAGIC)throw new java.io.IOException();
            long created=input.readLong(),now=clock.getAsLong();int size=input.readInt();
            if(created<0 || created>now || created>Long.MAX_VALUE-ttl || now-created>=ttl || size<=0 || size>MAX_RESPONSE || file.length()!=HEADER+(long)size)throw new java.io.IOException();
            byte[] expected=new byte[32];input.readFully(expected);byte[] data=new byte[size];input.readFully(data);
            if(!MessageDigest.isEqual(expected,digest(data)))throw new java.io.IOException();
            file.setLastModified(clock.getAsLong());return new Entry(data,created+ttl);
        } catch(Exception ignored) {file.delete();return null;}
    }
    synchronized boolean write(String scope,String address,byte[] bytes,Allowed valid) {
        String key=key(scope,address);
        if(key==null || bytes==null || bytes.length==0 || bytes.length>MAX_RESPONSE || HEADER+(long)bytes.length>budget || !permitted(valid) || !ready())return false;
        File temporary=null;
        try {
            if(freeSpace.getAsLong()-reserve<HEADER+(long)bytes.length)return false;
            temporary=File.createTempFile(key,".tmp",directory);
            try(FileOutputStream file=new FileOutputStream(temporary);DataOutputStream output=new DataOutputStream(file)) {
                output.writeInt(MAGIC);output.writeLong(clock.getAsLong());output.writeInt(bytes.length);output.write(digest(bytes));
                for(int offset=0;offset<bytes.length;) {
                    if(!permitted(valid) || freeSpace.getAsLong()-reserve<bytes.length-offset)return false;
                    int count=Math.min(8192,bytes.length-offset);output.write(bytes,offset,count);offset+=count;
                }
                output.flush();file.getFD().sync();
            }
            if(!permitted(valid) || freeSpace.getAsLong()<reserve)return false;
            File target=new File(directory,key+".art");
            if(!temporary.renameTo(target))return false;
            temporary=null;target.setLastModified(clock.getAsLong());trim();
            if(size()>budget) {target.delete();return false;}
            return true;
        } catch(Exception ignored) {return false;}
        finally {if(temporary!=null)temporary.delete();}
    }
    synchronized void remove(String scope,String address) {String key=key(scope,address);if(key!=null)new File(directory,key+".art").delete();}
    synchronized void clear() {for(File file:files())file.delete();}
    synchronized void finishWrites() {}
    private boolean permitted(Allowed valid) {return !Thread.currentThread().isInterrupted() && valid.getAsBoolean();}
    private boolean ready() {return directory.isDirectory() || directory.mkdirs();}
    private File[] files() {File[] files=directory.listFiles();return files==null?new File[0]:files;}
    private long size() {long total=0;for(File file:files())if(file.getName().matches("[0-9a-f]{64}\\.art"))total+=file.length();return total;}
    private void trim() {
        File[] entries=files();Arrays.sort(entries,(first,second)->Long.compare(first.lastModified(),second.lastModified()));long total=size();
        for(File entry:entries)if(total>budget && entry.getName().matches("[0-9a-f]{64}\\.art")) {long length=entry.length();if(entry.delete())total-=length;}
    }
    private static byte[] digest(byte[] data) {
        try {return MessageDigest.getInstance("SHA-256").digest(data);}catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
}
