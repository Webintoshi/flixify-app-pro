package vip.flixify.tv.update;

public final class UpdateInfo {
    public final String packageName,versionName,apkUrl,sha256,notes;
    public final long versionCode,sizeBytes;
    public final int minSdk;
    public UpdateInfo(String packageName,String versionName,long versionCode,int minSdk,String apkUrl,String sha256,long sizeBytes,String notes) {
        this.packageName=packageName;this.versionName=versionName;this.versionCode=versionCode;this.minSdk=minSdk;this.apkUrl=apkUrl;this.sha256=sha256;this.sizeBytes=sizeBytes;this.notes=notes;
    }
}
