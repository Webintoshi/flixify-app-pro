package vip.flixify.tv;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class ArtworkDiskCacheTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private final AtomicLong now=new AtomicLong(1000);
    private final AtomicLong free=new AtomicLong(1024*1024);
    private static final String ADDRESS="https://art.example/personal-user/personal-password/poster.jpg?token=private";
    private ArtworkDiskCache cache(File directory,long budget) {return new ArtworkDiskCache(directory,budget,7000,512,now::get,free::get);}
    private byte[] bytes(int value) {byte[] result=new byte[16];Arrays.fill(result,(byte)value);return result;}

    @Test public void survivesColdReopenWithoutPersistingIdentityOrUrl() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache first=cache(directory,1024);
        assertTrue(first.write("account-one:source-one",ADDRESS,bytes(1),()->true));
        assertArrayEquals(bytes(1),cache(directory,1024).read("account-one:source-one",ADDRESS));
        File[] files=directory.listFiles();assertNotNull(files);assertEquals(1,files.length);
        assertTrue(files[0].getName().matches("[0-9a-f]{64}\\.art"));
        String stored=new String(Files.readAllBytes(files[0].toPath()),StandardCharsets.ISO_8859_1);
        for(String secret:new String[]{"account-one","source-one","personal-user","personal-password","https://","token="})assertFalse(stored.contains(secret));
    }
    @Test public void sameAddressCannotReadAnotherAccountOrSource() throws Exception {
        ArtworkDiskCache cache=cache(temporary.newFolder(),1024);
        assertTrue(cache.write("account-a:source-a",ADDRESS,bytes(1),()->true));
        assertNull(cache.read("account-b:source-a",ADDRESS));assertNull(cache.read("account-a:source-b",ADDRESS));
        assertTrue(cache.write("account-b:source-a",ADDRESS,bytes(2),()->true));
        assertArrayEquals(bytes(1),cache.read("account-a:source-a",ADDRESS));assertArrayEquals(bytes(2),cache.read("account-b:source-a",ADDRESS));
    }
    @Test public void expiredAndFutureDatedEntriesAreDiscardedAcrossReopen() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache cache=cache(directory,1024);
        assertTrue(cache.write("scope",ADDRESS,bytes(1),()->true));now.set(8000);
        assertNull(cache(directory,1024).read("scope",ADDRESS));assertEquals(0,directory.listFiles().length);
        now.set(9000);assertTrue(cache.write("scope",ADDRESS,bytes(1),()->true));now.set(8999);
        assertNull(cache.read("scope",ADDRESS));
    }
    @Test public void corruptBytesBecomeAMissAndInterruptedFilesAreRemoved() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache cache=cache(directory,1024);
        assertTrue(cache.write("scope",ADDRESS,bytes(1),()->true));File stored=directory.listFiles()[0];
        try(RandomAccessFile file=new RandomAccessFile(stored,"rw")){file.seek(file.length()-1);file.write(99);}
        assertNull(cache.read("scope",ADDRESS));assertFalse(stored.exists());
        File interrupted=new File(directory,"uncommitted.tmp");Files.write(interrupted.toPath(),bytes(7));
        cache(directory,1024);assertFalse(interrupted.exists());
    }
    @Test public void diskBudgetEvictsLeastRecentlyReadEntryAndPersistsRecency() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache cache=cache(directory,160);
        assertTrue(cache.write("scope","a",bytes(1),()->true));now.incrementAndGet();
        assertTrue(cache.write("scope","b",bytes(2),()->true));now.incrementAndGet();
        assertArrayEquals(bytes(1),cache.read("scope","a"));now.incrementAndGet();
        assertTrue(cache(directory,160).write("scope","c",bytes(3),()->true));
        assertNull(cache.read("scope","b"));assertArrayEquals(bytes(1),cache.read("scope","a"));assertArrayEquals(bytes(3),cache.read("scope","c"));
        long total=0;for(File file:directory.listFiles())total+=file.length();assertTrue(total<=160);
    }
    @Test public void lowFreeSpaceAndInvalidatedWritesPreserveLastGoodEntry() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache cache=cache(directory,1024);
        assertTrue(cache.write("scope",ADDRESS,bytes(1),()->true));free.set(520);
        assertFalse(cache.write("scope",ADDRESS,bytes(2),()->true));assertArrayEquals(bytes(1),cache.read("scope",ADDRESS));
        free.set(4096);assertFalse(cache.write("scope",ADDRESS,bytes(2),()->false));assertArrayEquals(bytes(1),cache.read("scope",ADDRESS));
        Thread.currentThread().interrupt();try {assertFalse(cache.write("scope",ADDRESS,bytes(3),()->true));}finally {Thread.interrupted();}
        assertArrayEquals(bytes(1),cache.read("scope",ADDRESS));assertEquals(1,directory.listFiles().length);
    }
    @Test public void oversizedEmptyAndUnscopedWritesAreNeverPersisted() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache cache=cache(directory,4*1024*1024);
        assertFalse(cache.write("scope",ADDRESS,new byte[2*1024*1024+1],()->true));
        assertFalse(cache.write("scope",ADDRESS,new byte[0],()->true));assertFalse(cache.write("",ADDRESS,bytes(1),()->true));
        assertNull(cache.read("",ADDRESS));assertEquals(0,directory.listFiles().length);
    }
    @Test public void removingOneEntryAndLogoutClearDoNotLeavePrivateArtwork() throws Exception {
        File directory=temporary.newFolder();ArtworkDiskCache cache=cache(directory,1024);
        assertTrue(cache.write("scope-a",ADDRESS,bytes(1),()->true));assertTrue(cache.write("scope-b",ADDRESS,bytes(2),()->true));
        cache.remove("scope-a",ADDRESS);assertNull(cache.read("scope-a",ADDRESS));assertArrayEquals(bytes(2),cache.read("scope-b",ADDRESS));
        cache.clear();assertNull(cache(directory,1024).read("scope-b",ADDRESS));assertEquals(0,directory.listFiles().length);
    }
}
