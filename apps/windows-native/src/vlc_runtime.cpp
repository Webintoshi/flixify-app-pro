#include "vlc_runtime.h"
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>

VlcRuntime &VlcRuntime::instance() { static VlcRuntime runtime; return runtime; }

VlcRuntime::VlcRuntime() {
  const QDir root(QCoreApplication::applicationDirPath());
#if defined(Q_OS_WIN)
  const QString library = root.filePath(QStringLiteral("libvlc.dll"));
  const QString core = root.filePath(QStringLiteral("libvlccore.dll"));
#elif defined(Q_OS_MACOS)
  const QString library = root.filePath("lib/libvlc.dylib");
  const QString core = root.filePath("lib/libvlccore.dylib");
#else
  const QString library = root.filePath("lib/libvlc.so");
  const QString core = root.filePath("lib/libvlccore.so");
#endif
  plugins_ = root.filePath("plugins");
  if (!QFileInfo::exists(library) || !QFileInfo::exists(core) || !QDir(plugins_).exists()) {
    error_ = QStringLiteral("Video bileşenleri eksik. Flixify Pro’yu resmi indirme sayfasından yeniden kur.");
    return;
  }
  core_.setFileName(core); library_.setFileName(library);
  core_.setLoadHints(QLibrary::ResolveAllSymbolsHint | QLibrary::PreventUnloadHint);
  library_.setLoadHints(QLibrary::ResolveAllSymbolsHint | QLibrary::PreventUnloadHint);
  bool ok = core_.load() && library_.load();
#define VLC(member, symbol) ok = resolve(member, symbol) && ok
  VLC(create, "libvlc_new"); VLC(release, "libvlc_release");
  VLC(media, "libvlc_media_new_location"); VLC(releaseMedia, "libvlc_media_release");
  VLC(addOption, "libvlc_media_add_option"); VLC(player, "libvlc_media_player_new");
  VLC(releasePlayer, "libvlc_media_player_release"); VLC(setMedia, "libvlc_media_player_set_media");
  VLC(play, "libvlc_media_player_play"); VLC(stop, "libvlc_media_player_stop");
  VLC(pause, "libvlc_media_player_set_pause"); VLC(setTime, "libvlc_media_player_set_time");
  VLC(time, "libvlc_media_player_get_time"); VLC(length, "libvlc_media_player_get_length");
  VLC(setRate, "libvlc_media_player_set_rate"); VLC(setAspect, "libvlc_video_set_aspect_ratio");
  VLC(isPlaying, "libvlc_media_player_is_playing"); VLC(volume, "libvlc_audio_get_volume");
  VLC(setVolume, "libvlc_audio_set_volume"); VLC(mute, "libvlc_audio_get_mute");
  VLC(setMute, "libvlc_audio_set_mute"); VLC(audioTrack, "libvlc_audio_get_track");
  VLC(setAudioTrack, "libvlc_audio_set_track"); VLC(subtitleTrack, "libvlc_video_get_spu");
  VLC(setSubtitleTrack, "libvlc_video_set_spu"); VLC(audioTracks, "libvlc_audio_get_track_description");
  VLC(subtitleTracks, "libvlc_video_get_spu_description");
  VLC(releaseTracks, "libvlc_track_description_list_release");
  VLC(videoSize, "libvlc_video_get_size"); VLC(events, "libvlc_media_player_event_manager");
  VLC(attach, "libvlc_event_attach"); VLC(detach, "libvlc_event_detach");
#if defined(Q_OS_WIN)
  VLC(setHwnd, "libvlc_media_player_set_hwnd");
#elif defined(Q_OS_MACOS)
  VLC(setNSObject, "libvlc_media_player_set_nsobject");
#else
  VLC(setXWindow, "libvlc_media_player_set_xwindow");
#endif
#undef VLC
  if (!ok) error_ = QStringLiteral("Video bileşenleri doğrulanamadı. Flixify Pro’yu yeniden kur.");
}
