package vip.flixify.tv;

import java.io.File;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

final class ArtworkDiskCache {
    interface Allowed {boolean getAsBoolean();}
    interface LongValue {long getAsLong();}
    static final int MAX_RESPONSE=2*1024*1024;
    static final long TTL_MS=7L*24*60*60*1000;
    private static final int MAGIC=0x46584131, HEADER=48;
    private final File directory;
    private final long budget,ttl,reserve;
    private final LongValue clock,freeSpace;
    private final Object state=new Object();
    private final Object[] entryLocks=new Object[32];
    private final ThreadPoolExecutor writer=new ThreadPoolExecutor(1,1,15,TimeUnit.SECONDS,new ArrayBlockingQueue<>(2));
    private boolean initialized;
    private long epoch;
    private int activeWrites;
    static final class Entry {
        final byte[] bytes;final long expiresAt;
        Entry(byte[] bytes,long expiresAt) {this.bytes=bytes;this.expiresAt=expiresAt;}
    }
    ArtworkDiskCache(File directory) {this(directory,64L*1024*1024,TTL_MS,32L*1024*1024,System::currentTimeMillis,directory::getUsableSpace);}
    ArtworkDiskCache(File directory,long budget,long ttl,long reserve,LongValue clock,LongValue freeSpace) {
        this.directory=directory;this.budget=budget;this.ttl=ttl;this.reserve=reserve;this.clock=clock;this.freeSpace=freeSpace;
        for(int index=0;index<entryLocks.length;index++)entryLocks[index]=new Object();
        writer.allowCoreThreadTimeOut(true);
    }
    private void initialize() {if(!initialized && ready()){for(File file:files())if(file.getName().endsWith(".tmp"))file.delete();trim();initialized=true;}}
    static String key(String scope,String address) {
        if(scope==null || scope.isEmpty() || address==null || address.isEmpty())return null;
        byte[] hash=digest((scope.length()+":"+scope+address).getBytes(StandardCharsets.UTF_8));
        StringBuilder text=new StringBuilder(64);for(byte value:hash)text.append(Character.forDigit((value>>>4)&15,16)).append(Character.forDigit(value&15,16));
        return text.toString();
    }
    byte[] read(String scope,String address) {Entry entry=readEntry(scope,address);return entry==null?null:entry.bytes;}
    Entry readEntry(String scope,String address) {
        String key=key(scope,address);if(key==null)return null;
        synchronized(state){initialize();}
        synchronized(entryLock(key)) {
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
    }
    boolean write(String scope,String address,byte[] bytes,Allowed valid) {
        String key=key(scope,address);
        if(!writable(key,bytes,valid))return false;
        final long writingEpoch;
        synchronized(state){if(!ready())return false;initialize();writingEpoch=epoch;activeWrites++;}
        try{return writeEntry(key,bytes,valid,writingEpoch);}
        finally{writeFinished();}
    }
    boolean writeLater(String scope,String address,byte[] bytes,Allowed valid) {
        String key=key(scope,address);if(!writable(key,bytes,valid))return false;
        final long writingEpoch;
        synchronized(state){writingEpoch=epoch;activeWrites++;}
        try {
            writer.execute(()->{try{writeEntry(key,bytes,valid,writingEpoch);}finally{writeFinished();}});
            return true;
        } catch(RejectedExecutionException ignored){writeFinished();return false;}
    }
    private boolean writable(String key,byte[] bytes,Allowed valid) {
        return key!=null && bytes!=null && bytes.length>0 && bytes.length<=MAX_RESPONSE && HEADER+(long)bytes.length<=budget && permitted(valid);
    }
    private boolean current(long writingEpoch,Allowed valid) {
        synchronized(state){return epoch==writingEpoch && permitted(valid);}
    }
    private boolean writeEntry(String key,byte[] bytes,Allowed valid,long writingEpoch) {
        synchronized(state){if(epoch!=writingEpoch || !permitted(valid) || !ready())return false;initialize();}
        File temporary=null;
        try {
            if(freeSpace.getAsLong()-reserve<HEADER+(long)bytes.length)return false;
            final FileOutputStream staging;
            synchronized(state) {
                if(epoch!=writingEpoch || !permitted(valid))return false;
                temporary=File.createTempFile(key,".tmp",directory);staging=new FileOutputStream(temporary);
            }
            // Clear can unlink staging, but an old epoch can never recreate or publish it.
            try(FileOutputStream file=staging;DataOutputStream output=new DataOutputStream(file)) {
                output.writeInt(MAGIC);output.writeLong(clock.getAsLong());output.writeInt(bytes.length);output.write(digest(bytes));
                for(int offset=0;offset<bytes.length;) {
                    if(!current(writingEpoch,valid) || freeSpace.getAsLong()-reserve<bytes.length-offset)return false;
                    int count=Math.min(8192,bytes.length-offset);output.write(bytes,offset,count);offset+=count;
                }
                output.flush();file.getFD().sync();
            }
            if(freeSpace.getAsLong()<reserve)return false;
            synchronized(state) {
                if(epoch!=writingEpoch || !permitted(valid))return false;
                synchronized(entryLock(key)) {
                    File target=new File(directory,key+".art");
                    if(!temporary.renameTo(target))return false;
                    temporary=null;target.setLastModified(clock.getAsLong());trim();
                    if(size()>budget) {target.delete();return false;}
                    return true;
                }
            }
        } catch(Exception ignored) {return false;}
        finally {if(temporary!=null)temporary.delete();}
    }
    private Object entryLock(String key) {return entryLocks[(key.hashCode()&Integer.MAX_VALUE)%entryLocks.length];}
    private void writeFinished() {synchronized(state){activeWrites--;state.notifyAll();}}
    void remove(String scope,String address) {String key=key(scope,address);if(key!=null)synchronized(state){synchronized(entryLock(key)){new File(directory,key+".art").delete();}}}
    void clear() {synchronized(state){epoch++;for(File file:files())file.delete();}}
    void finishWrites() {
        boolean interrupted=false;
        synchronized(state){while(activeWrites!=0)try{state.wait();}catch(InterruptedException ignored){interrupted=true;}}
        if(interrupted)Thread.currentThread().interrupt();
    }
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
