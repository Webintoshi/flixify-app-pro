#pragma once
#include <QLibrary>
#include <QString>
#include <QtGlobal>

struct libvlc_instance_t;
struct libvlc_media_t;
struct libvlc_media_player_t;
struct libvlc_event_manager_t;
struct libvlc_track_description_t { int i_id; char *psz_name; libvlc_track_description_t *p_next; };
struct libvlc_event_t { int type; void *p_obj; };
using VlcCallback = void (*)(const libvlc_event_t *, void *);

class VlcRuntime {
 public:
  static VlcRuntime &instance();
  bool ready() const { return error_.isEmpty(); }
  QString error() const { return error_; }
  QString plugins() const { return plugins_; }

  libvlc_instance_t *(*create)(int, const char *const *) = nullptr;
  void (*release)(libvlc_instance_t *) = nullptr;
  libvlc_media_t *(*media)(libvlc_instance_t *, const char *) = nullptr;
  void (*releaseMedia)(libvlc_media_t *) = nullptr;
  void (*addOption)(libvlc_media_t *, const char *) = nullptr;
  libvlc_media_player_t *(*player)(libvlc_instance_t *) = nullptr;
  void (*releasePlayer)(libvlc_media_player_t *) = nullptr;
  void (*setMedia)(libvlc_media_player_t *, libvlc_media_t *) = nullptr;
  int (*play)(libvlc_media_player_t *) = nullptr;
  void (*stop)(libvlc_media_player_t *) = nullptr;
  void (*pause)(libvlc_media_player_t *, int) = nullptr;
  void (*setTime)(libvlc_media_player_t *, qint64) = nullptr;
  int (*setRate)(libvlc_media_player_t *, float) = nullptr;
  void (*setAspect)(libvlc_media_player_t *, const char *) = nullptr;
  qint64 (*time)(libvlc_media_player_t *) = nullptr;
  qint64 (*length)(libvlc_media_player_t *) = nullptr;
  int (*isPlaying)(libvlc_media_player_t *) = nullptr;
  int (*volume)(libvlc_media_player_t *) = nullptr;
  int (*setVolume)(libvlc_media_player_t *, int) = nullptr;
  int (*mute)(libvlc_media_player_t *) = nullptr;
  void (*setMute)(libvlc_media_player_t *, int) = nullptr;
  int (*audioTrack)(libvlc_media_player_t *) = nullptr;
  int (*setAudioTrack)(libvlc_media_player_t *, int) = nullptr;
  int (*subtitleTrack)(libvlc_media_player_t *) = nullptr;
  int (*setSubtitleTrack)(libvlc_media_player_t *, int) = nullptr;
  libvlc_track_description_t *(*audioTracks)(libvlc_media_player_t *) = nullptr;
  libvlc_track_description_t *(*subtitleTracks)(libvlc_media_player_t *) = nullptr;
  void (*releaseTracks)(libvlc_track_description_t *) = nullptr;
  int (*videoSize)(libvlc_media_player_t *, unsigned int, unsigned int *, unsigned int *) = nullptr;
  libvlc_event_manager_t *(*events)(libvlc_media_player_t *) = nullptr;
  int (*attach)(libvlc_event_manager_t *, int, VlcCallback, void *) = nullptr;
  void (*detach)(libvlc_event_manager_t *, int, VlcCallback, void *) = nullptr;
  void (*setHwnd)(libvlc_media_player_t *, void *) = nullptr;
  void (*setNSObject)(libvlc_media_player_t *, void *) = nullptr;
  void (*setXWindow)(libvlc_media_player_t *, quint32) = nullptr;

 private:
  VlcRuntime();
  template <typename T> bool resolve(T &target, const char *name) {
    target = reinterpret_cast<T>(library_.resolve(name));
    return target != nullptr;
  }
  QLibrary core_, library_;
  QString error_, plugins_;
};
