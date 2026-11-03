package vip.flixify.tv;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

/** Decode bounds first: untrusted start replies must not allocate arbitrary images. */
public final class DeviceLoginQr {
    private DeviceLoginQr() {}
    public static Bitmap decode(String encoded){
        if(encoded==null || encoded.length()<24 || encoded.length()>350000)return null;
        try{
            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
            if(bytes.length>262144 || bytes.length<24 || bytes[0]!=(byte)137 || bytes[1]!=80 || bytes[2]!=78 || bytes[3]!=71 || bytes[4]!=13 || bytes[5]!=10 || bytes[6]!=26 || bytes[7]!=10)return null;
            BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
            if(bounds.outWidth<64 || bounds.outWidth>1024 || bounds.outHeight!=bounds.outWidth || !"image/png".equals(bounds.outMimeType))return null;
            BitmapFactory.Options options=new BitmapFactory.Options();options.inScaled=false;
            return BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        }catch(IllegalArgumentException ignored){return null;}
    }
}
