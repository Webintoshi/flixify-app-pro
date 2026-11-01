package vip.flixify.tv.data;

import java.io.IOException;
import java.io.Reader;

/** Oversized strings become a non-null invalid scalar before JsonReader can allocate them. */
final class BoundedJsonInput extends Reader {
    private static final int MAX_STRING=64*1024,MAX_PRIMITIVE=1024;
    private final Reader input;
    private final char[] buffer=new char[8192];
    private int position,limit,pushed=-2,pendingAt;
    private String pending;
    private boolean closed;
    BoundedJsonInput(Reader input){if(input==null)throw new NullPointerException("input");this.input=input;}
    @Override public int read(char[] target,int offset,int length)throws IOException {
        if(target==null)throw new NullPointerException("target");
        if(offset<0 || length<0 || offset>target.length-length)throw new IndexOutOfBoundsException();
        if(closed)throw new IOException("Reader closed");if(length==0)return 0;
        int written=0;
        while(written<length) {
            if(pending==null || pendingAt==pending.length()) {
                pending=null;pendingAt=0;int next=nextInput();
                if(next<0)return written==0?-1:written;
                if(next=='"')pending=quoted();
                else if(!delimiter(next))pending=primitive(next);
                else{target[offset+written++]=(char)next;continue;}
            }
            int count=Math.min(length-written,pending.length()-pendingAt);
            pending.getChars(pendingAt,pendingAt+count,target,offset+written);pendingAt+=count;written+=count;
        }
        return written;
    }
    private int nextInput()throws IOException {
        if(pushed!=-2){int result=pushed;pushed=-2;return result;}
        while(position>=limit){if(limit<0)return -1;limit=input.read(buffer,0,buffer.length);position=0;if(limit<0)return -1;}
        return buffer[position++];
    }
    private String quoted()throws IOException {
        StringBuilder token=new StringBuilder(256);token.append('"');
        int raw=0,unicode=0;boolean escaped=false;
        while(true) {
            int next=nextInput();if(next<0)throw new IOException("Unterminated JSON string");
            if(next<0x20)throw new IOException("Invalid JSON string control");
            if(unicode>0){if(!hex(next))throw new IOException("Invalid JSON unicode escape");unicode--;}
            else if(escaped){
                if(next=='u')unicode=4;
                else if(next!='"' && next!='\\' && next!='/' && next!='b' && next!='f' && next!='n' && next!='r' && next!='t')throw new IOException("Invalid JSON escape");
                escaped=false;
            } else if(next=='"'){if(token==null)return "false";return token.append('"').toString();}
            else if(next=='\\')escaped=true;
            if(token!=null){if(++raw>MAX_STRING)token=null;else token.append((char)next);}
        }
    }
    private String primitive(int first)throws IOException {
        StringBuilder token=new StringBuilder(32);token.append((char)first);
        while(true){int next=nextInput();if(next<0)return token.toString();if(delimiter(next)){pushed=next;return token.toString();}if(token.length()==MAX_PRIMITIVE)throw new IOException("JSON primitive too long");token.append((char)next);}
    }
    private static boolean delimiter(int value){return value=='"' || value=='{' || value=='}' || value=='[' || value==']' || value==',' || value==':' || value==' ' || value=='\t' || value=='\r' || value=='\n';}
    private static boolean hex(int value){return value>='0' && value<='9' || value>='a' && value<='f' || value>='A' && value<='F';}
    @Override public void close()throws IOException{if(!closed){closed=true;pending=null;input.close();}}
}
