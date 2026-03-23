#pragma once

#include <QtGlobal>
#include <QString>

struct libvlc_instance_t;
struct libvlc_media_t;
struct libvlc_media_player_t;
struct libvlc_event_manager_t;

using libvlc_time_t = qint64;
using libvlc_event_type_t = int;

enum libvlc_event_e : libvlc_event_type_t {
  libvlc_MediaPlayerMediaChanged = 0x100,
  libvlc_MediaPlayerNothingSpecial,
  libvlc_MediaPlayerOpening,
  libvlc_MediaPlayerBuffering,
  libvlc_MediaPlayerPlaying,
  libvlc_MediaPlayerPaused,
  libvlc_MediaPlayerStopped,
  libvlc_MediaPlayerForward,
  libvlc_MediaPlayerBackward,
  libvlc_MediaPlayerEndReached,
  libvlc_MediaPlayerEncounteredError
};

struct libvlc_event_t {
  libvlc_event_type_t type;
  void *p_obj;
  union {
    struct {
      float new_cache;
    } media_player_buffering;
  } u;
};

using libvlc_callback_t = void (*)(const libvlc_event_t *event, void *opaque);

QString flixifyLibVlcRuntimeError();
QString flixifyLibVlcRuntimeRoot();
QString flixifyLibVlcPluginPath();
bool flixifyLibVlcRuntimeReady();

libvlc_instance_t *libvlc_new(int argc, const char *const *argv);
void libvlc_release(libvlc_instance_t *instance);

libvlc_media_t *libvlc_media_new_location(libvlc_instance_t *instance, const char *location);
void libvlc_media_release(libvlc_media_t *media);
void libvlc_media_add_option(libvlc_media_t *media, const char *option);

libvlc_media_player_t *libvlc_media_player_new(libvlc_instance_t *instance);
void libvlc_media_player_release(libvlc_media_player_t *player);
void libvlc_media_player_set_media(libvlc_media_player_t *player, libvlc_media_t *media);
int libvlc_media_player_play(libvlc_media_player_t *player);
void libvlc_media_player_stop(libvlc_media_player_t *player);
void libvlc_media_player_set_pause(libvlc_media_player_t *player, int paused);
void libvlc_media_player_set_time(libvlc_media_player_t *player, libvlc_time_t time);
libvlc_time_t libvlc_media_player_get_time(libvlc_media_player_t *player);
libvlc_time_t libvlc_media_player_get_length(libvlc_media_player_t *player);
int libvlc_media_player_is_playing(libvlc_media_player_t *player);
libvlc_event_manager_t *libvlc_media_player_event_manager(libvlc_media_player_t *player);
int libvlc_event_attach(
  libvlc_event_manager_t *eventManager,
  libvlc_event_type_t eventType,
  libvlc_callback_t callback,
  void *opaque
);
int libvlc_audio_get_volume(libvlc_media_player_t *player);
int libvlc_audio_set_volume(libvlc_media_player_t *player, int volume);
int libvlc_audio_get_mute(libvlc_media_player_t *player);
void libvlc_audio_set_mute(libvlc_media_player_t *player, int mute);
int libvlc_audio_output_set(libvlc_media_player_t *player, const char *name);

void libvlc_media_player_set_hwnd(libvlc_media_player_t *player, void *windowHandle);
void libvlc_media_player_set_nsobject(libvlc_media_player_t *player, void *objectHandle);
void libvlc_media_player_set_xwindow(libvlc_media_player_t *player, uint32_t windowId);

int libvlc_video_get_size(libvlc_media_player_t *player, unsigned int num, unsigned int *px, unsigned int *py);
void libvlc_video_set_crop_geometry(libvlc_media_player_t *player, const char *geometry);
