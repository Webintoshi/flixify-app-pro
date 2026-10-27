package vip.flixify.tv.player;

import android.content.Context;
import android.view.View;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import vip.flixify.tv.TvModels.Playback;
import vip.flixify.tv.TvModels.Kind;

/** Platform decoders only: no bundled ABI-specific codec extension. */
@androidx.media3.common.util.UnstableApi
public final class Media3PlayerEngine implements PlayerEngine {
    private final ExoPlayer player;
    private final PlayerView view;
    private final Listener listener;
    private boolean released;
    public Media3PlayerEngine(Context context,Listener listener) {
        this.listener=listener;
        // Media source failures can contain the ephemeral URI in their cause chain.
        androidx.media3.common.util.Log.setLogLevel(androidx.media3.common.util.Log.LOG_LEVEL_OFF);
        player=new ExoPlayer.Builder(context).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
        player.setHandleAudioBecomingNoisy(true);
        view=new PlayerView(context);
        view.setUseController(false);
        view.setFocusable(false);
        view.setKeepScreenOn(true);
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {if(!released)listener.onStateChanged(state);}
            @Override public void onIsPlayingChanged(boolean playing) {if(!released)listener.onStateChanged(player.getPlaybackState());}
            @Override public void onRenderedFirstFrame() {if(!released)listener.onFirstFrame();}
            @Override public void onTracksChanged(Tracks tracks) {if(!released)listener.onTracksChanged();}
            @Override public void onPlayerError(PlaybackException error) {if(!released)listener.onError();}
        });
    }
    @Override public View view() {return view;}
    @Override public void prepare(Playback playback,long start,boolean play) {
        MediaItem.Builder item=new MediaItem.Builder().setUri(playback.url);
        if(playback.mime!=null && !playback.mime.isEmpty())item.setMimeType(playback.mime);
        if(playback.item.kind==Kind.LIVE)player.setMediaItem(item.build());
        else player.setMediaItem(item.build(),Math.max(0,start));
        player.setPlayWhenReady(play);
        player.prepare();
    }
    @Override public void play() {player.play();}
    @Override public void pause() {player.pause();}
    @Override public void seek(long position) {player.seekTo(Math.max(0,position));}
    @Override public long position() {return Math.max(0,player.getCurrentPosition());}
    @Override public long duration() {long duration=player.getDuration();return duration==C.TIME_UNSET?-1:duration;}
    @Override public boolean playing() {return player.isPlaying();}
    @Override public boolean wantsToPlay() {return player.getPlayWhenReady();}
    @Override public int state() {return player.getPlaybackState();}
    @Override public List<Track> tracks(boolean subtitles) {
        int type=subtitles?C.TRACK_TYPE_TEXT:C.TRACK_TYPE_AUDIO;
        List<Track> result=new ArrayList<>();
        List<Tracks.Group> groups=player.getCurrentTracks().getGroups();
        for(int groupIndex=0;groupIndex<groups.size();groupIndex++) {
            Tracks.Group group=groups.get(groupIndex);
            if(group.getType()!=type)continue;
            for(int index=0;index<group.length;index++) {
                if(!group.isTrackSupported(index))continue;
                Format format=group.getTrackFormat(index);
                String label=format.label;
                if(label==null || label.isEmpty()) {
                    String language=format.language;
                    label=language==null || language.isEmpty() || "und".equals(language)?"Parça "+(index+1):Locale.forLanguageTag(language).getDisplayLanguage(new Locale("tr"));
                }
                if(!subtitles && format.channelCount>0)label+=" · "+format.channelCount+" kanal";
                result.add(new Track(groupIndex+":"+index,label,group.isTrackSelected(index)));
            }
        }
        return result;
    }
    @Override public void selectTrack(boolean subtitles,String id) {
        int type=subtitles?C.TRACK_TYPE_TEXT:C.TRACK_TYPE_AUDIO;
        TrackSelectionParameters.Builder builder=player.getTrackSelectionParameters().buildUpon().clearOverridesOfType(type);
        if(id.isEmpty())builder.setTrackTypeDisabled(type,subtitles);
        else {
            String[] parts=id.split(":");
            if(parts.length!=2)return;
            try {
                int groupIndex=Integer.parseInt(parts[0]),trackIndex=Integer.parseInt(parts[1]);
                List<Tracks.Group> groups=player.getCurrentTracks().getGroups();
                if(groupIndex<0 || groupIndex>=groups.size())return;
                Tracks.Group group=groups.get(groupIndex);
                if(group.getType()!=type || trackIndex<0 || trackIndex>=group.length || !group.isTrackSupported(trackIndex))return;
                builder.setTrackTypeDisabled(type,false).setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(),trackIndex));
            } catch(NumberFormatException ignored) {return;}
        }
        player.setTrackSelectionParameters(builder.build());
    }
    @Override public void release() {
        if(released)return;
        released=true;
        view.setPlayer(null);
        view.setKeepScreenOn(false);
        player.release();
    }
}
