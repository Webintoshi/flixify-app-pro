package android.util;
/** Host-only framework adapter. Device tests use Android's actual JsonReader. */
public enum JsonToken {BEGIN_ARRAY,END_ARRAY,BEGIN_OBJECT,END_OBJECT,NAME,STRING,NUMBER,BOOLEAN,NULL,END_DOCUMENT}
