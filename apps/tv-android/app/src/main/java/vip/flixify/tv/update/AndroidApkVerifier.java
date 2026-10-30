package vip.flixify.tv.update;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.io.File;

final class AndroidApkVerifier implements PackageChecks {
    static final class Identity {
        final String packageName,versionName;final long versionCode;final int minSdk;final byte[][] signers;
        Identity(String packageName,String versionName,long versionCode,int minSdk,byte[][] signers){this.packageName=packageName;this.versionName=versionName;this.versionCode=versionCode;this.minSdk=minSdk;this.signers=signers;}
    }
    private final Context context;
    AndroidApkVerifier(Context context){this.context=context.getApplicationContext();}
    @Override public UpdatePolicy policy() throws UpdateFailure {Identity installed=installed();return new UpdatePolicy(context.getPackageName(),installed.versionCode,Build.VERSION.SDK_INT);}
    @SuppressWarnings("deprecation")
    Identity installed() throws UpdateFailure {
        try{return identity(context.getPackageManager().getPackageInfo(context.getPackageName(),flags()),23);}catch(Exception error){throw new UpdateFailure();}
    }
    Identity archive(File file,int fallbackMinimum) throws UpdateFailure {
        try{PackageInfo info=context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),flags());if(info==null)throw new UpdateFailure();return identity(info,fallbackMinimum);}catch(Exception error){throw new UpdateFailure();}
    }
    @SuppressWarnings("deprecation")
    private static int flags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    @SuppressWarnings("deprecation")
    private static Identity identity(PackageInfo info,int fallbackMinimum) throws UpdateFailure {
        Signature[] signatures=Build.VERSION.SDK_INT>=28?(info.signingInfo==null?null:info.signingInfo.getApkContentsSigners()):info.signatures;
        if(signatures==null || signatures.length==0 || info.applicationInfo==null)throw new UpdateFailure();
        byte[][] signers=new byte[signatures.length][];for(int i=0;i<signatures.length;i++){if(signatures[i]==null)throw new UpdateFailure();signers[i]=signatures[i].toByteArray();}
        long version=Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;
        int minimum=Build.VERSION.SDK_INT>=24?info.applicationInfo.minSdkVersion:fallbackMinimum;
        return new Identity(info.packageName,info.versionName,version,minimum,signers);
    }
    @Override public void verify(File file,UpdateInfo info) throws UpdateFailure {
        Identity installed=installed(),archive=archive(file,info.minSdk);
        new UpdatePolicy(context.getPackageName(),installed.versionCode,Build.VERSION.SDK_INT).verifyIdentity(info,archive.packageName,archive.versionName,archive.versionCode,archive.minSdk,installed.signers,archive.signers);
    }
}
