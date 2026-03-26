#include "libvlc_runtime.h"

#include <QCoreApplication>
#include <QDir>
#include <QLibrary>
#include <QStringList>

namespace {

struct LibVlcRuntimeState {
  using NewFn = libvlc_instance_t *(*)(int, const char *const *);
  using ReleaseFn = void (*)(libvlc_instance_t *);
  using MediaNewLocationFn = libvlc_media_t *(*)(libvlc_instance_t *, const char *);
  using MediaReleaseFn = void (*)(libvlc_media_t *);
  using MediaAddOptionFn = void (*)(libvlc_media_t *, const char *);
  using MediaPlayerNewFn = libvlc_media_player_t *(*)(libvlc_instance_t *);
  using MediaPlayerReleaseFn = void (*)(libvlc_media_player_t *);
  using MediaPlayerSetMediaFn = void (*)(libvlc_media_player_t *, libvlc_media_t *);
  using MediaPlayerPlayFn = int (*)(libvlc_media_player_t *);
  using MediaPlayerStopFn = void (*)(libvlc_media_player_t *);
  using MediaPlayerSetPauseFn = void (*)(libvlc_media_player_t *, int);
  using MediaPlayerSetTimeFn = void (*)(libvlc_media_player_t *, libvlc_time_t);
  using MediaPlayerGetTimeFn = libvlc_time_t (*)(libvlc_media_player_t *);
  using MediaPlayerGetLengthFn = libvlc_time_t (*)(libvlc_media_player_t *);
  using MediaPlayerIsPlayingFn = int (*)(libvlc_media_player_t *);
  using MediaPlayerEventManagerFn = libvlc_event_manager_t *(*)(libvlc_media_player_t *);
  using EventAttachFn =
    int (*)(libvlc_event_manager_t *, libvlc_event_type_t, libvlc_callback_t, void *);
  using AudioGetVolumeFn = int (*)(libvlc_media_player_t *);
  using AudioSetVolumeFn = int (*)(libvlc_media_player_t *, int);
  using AudioGetMuteFn = int (*)(libvlc_media_player_t *);
  using AudioSetMuteFn = void (*)(libvlc_media_player_t *, int);
  using AudioOutputSetFn = int (*)(libvlc_media_player_t *, const char *);
  using MediaPlayerSetHwndFn = void (*)(libvlc_media_player_t *, void *);
  using MediaPlayerSetNSObjectFn = void (*)(libvlc_media_player_t *, void *);
  using MediaPlayerSetXWindowFn = void (*)(libvlc_media_player_t *, uint32_t);
  using VideoGetSizeFn = int (*)(libvlc_media_player_t *, unsigned int, unsigned int *, unsigned int *);
  using VideoGetAspectRatioFn = char *(*)(libvlc_media_player_t *);
  using VideoSetCropGeometryFn = void (*)(libvlc_media_player_t *, const char *);
  using FreeFn = void (*)(void *);

  QLibrary vlcLibrary;
  QLibrary coreLibrary;
  bool loadAttempted = false;
  QString loadError;
  QString rootDir;
  QString pluginDir;

  NewFn newInstance = nullptr;
  ReleaseFn releaseInstance = nullptr;
  MediaNewLocationFn mediaNewLocation = nullptr;
  MediaReleaseFn mediaRelease = nullptr;
  MediaAddOptionFn mediaAddOption = nullptr;
  MediaPlayerNewFn mediaPlayerNew = nullptr;
  MediaPlayerReleaseFn mediaPlayerRelease = nullptr;
  MediaPlayerSetMediaFn mediaPlayerSetMedia = nullptr;
  MediaPlayerPlayFn mediaPlayerPlay = nullptr;
  MediaPlayerStopFn mediaPlayerStop = nullptr;
  MediaPlayerSetPauseFn mediaPlayerSetPause = nullptr;
  MediaPlayerSetTimeFn mediaPlayerSetTime = nullptr;
  MediaPlayerGetTimeFn mediaPlayerGetTime = nullptr;
  MediaPlayerGetLengthFn mediaPlayerGetLength = nullptr;
  MediaPlayerIsPlayingFn mediaPlayerIsPlaying = nullptr;
  MediaPlayerEventManagerFn mediaPlayerEventManager = nullptr;
  EventAttachFn eventAttach = nullptr;
  AudioGetVolumeFn audioGetVolume = nullptr;
  AudioSetVolumeFn audioSetVolume = nullptr;
  AudioGetMuteFn audioGetMute = nullptr;
  AudioSetMuteFn audioSetMute = nullptr;
  AudioOutputSetFn audioOutputSet = nullptr;
  MediaPlayerSetHwndFn mediaPlayerSetHwnd = nullptr;
  MediaPlayerSetNSObjectFn mediaPlayerSetNSObject = nullptr;
  MediaPlayerSetXWindowFn mediaPlayerSetXWindow = nullptr;
  VideoGetSizeFn videoGetSize = nullptr;
  VideoGetAspectRatioFn videoGetAspectRatio = nullptr;
  VideoSetCropGeometryFn videoSetCropGeometry = nullptr;
  FreeFn freeFn = nullptr;

  template <typename T>
  bool resolve(const char *symbol, T &target) {
    target = reinterpret_cast<T>(vlcLibrary.resolve(symbol));
    return target != nullptr;
  }

  QStringList candidateRoots() const {
    QStringList roots;

    auto appendRoot = [&roots](const QString &value) {
      const QString cleaned = QDir::fromNativeSeparators(value.trimmed());
      if (!cleaned.isEmpty() && !roots.contains(cleaned)) {
        roots.push_back(cleaned);
      }
    };

    appendRoot(qEnvironmentVariable("LIBVLC_ROOT"));

    if (QCoreApplication::instance()) {
      const QString appDir = QCoreApplication::applicationDirPath();
      appendRoot(appDir);
      appendRoot(QDir(appDir).filePath(QStringLiteral("vlc")));
    }

#if defined(Q_OS_WIN)
    appendRoot(QStringLiteral("C:/Program Files/VideoLAN/VLC"));
    appendRoot(QStringLiteral("C:/Program Files (x86)/VideoLAN/VLC"));
#endif

    return roots;
  }

  QString resolveLibraryPath(const QString &root) const {
#if defined(Q_OS_WIN)
    const QString direct = QDir(root).filePath(QStringLiteral("libvlc.dll"));
    if (QLibrary::isLibrary(direct)) {
      return direct;
    }
    const QString nested = QDir(root).filePath(QStringLiteral("lib/libvlc.dll"));
    if (QLibrary::isLibrary(nested)) {
      return nested;
    }
#elif defined(Q_OS_MACOS)
    const QString framework = QDir(root).filePath(QStringLiteral("lib/libvlc.dylib"));
    if (QLibrary::isLibrary(framework)) {
      return framework;
    }
#else
    const QString sharedObject = QDir(root).filePath(QStringLiteral("lib/libvlc.so"));
    if (QLibrary::isLibrary(sharedObject)) {
      return sharedObject;
    }
#endif
    return {};
  }

  QString resolveCoreLibraryPath(const QString &root) const {
#if defined(Q_OS_WIN)
    const QString direct = QDir(root).filePath(QStringLiteral("libvlccore.dll"));
    if (QLibrary::isLibrary(direct)) {
      return direct;
    }
    const QString nested = QDir(root).filePath(QStringLiteral("lib/libvlccore.dll"));
    if (QLibrary::isLibrary(nested)) {
      return nested;
    }
#elif defined(Q_OS_MACOS)
    const QString direct = QDir(root).filePath(QStringLiteral("lib/libvlccore.dylib"));
    if (QLibrary::isLibrary(direct)) {
      return direct;
    }
#else
    const QString direct = QDir(root).filePath(QStringLiteral("lib/libvlccore.so"));
    if (QLibrary::isLibrary(direct)) {
      return direct;
    }
#endif
    return {};
  }

  QString resolvePluginDirectory(const QString &root) const {
    const QStringList candidates = {
      QDir(root).filePath(QStringLiteral("plugins")),
      QDir(root).filePath(QStringLiteral("lib/vlc/plugins"))
    };

    for (const QString &candidate : candidates) {
      if (QDir(candidate).exists()) {
        return candidate;
      }
    }

    return {};
  }

  void unload() {
    if (vlcLibrary.isLoaded()) {
      vlcLibrary.unload();
    }
    if (coreLibrary.isLoaded()) {
      coreLibrary.unload();
    }
  }

  bool loadFromRoot(const QString &root) {
    const QString libraryPath = resolveLibraryPath(root);
    if (libraryPath.isEmpty()) {
      return false;
    }

    const QString normalizedRoot = QDir::toNativeSeparators(QFileInfo(libraryPath).absolutePath());
    const QByteArray currentPath = qgetenv("PATH");
    const QByteArray normalizedRootBytes = normalizedRoot.toUtf8();
    if (!currentPath.contains(normalizedRootBytes)) {
      qputenv("PATH", normalizedRootBytes + QByteArray(";") + currentPath);
    }

    const QString corePath = resolveCoreLibraryPath(root);
    if (!corePath.isEmpty()) {
      coreLibrary.setFileName(corePath);
      coreLibrary.load();
    }

    vlcLibrary.setFileName(libraryPath);
    if (!vlcLibrary.load()) {
      loadError = QStringLiteral("libVLC yuklenemedi: %1").arg(vlcLibrary.errorString());
      unload();
      return false;
    }

    rootDir = normalizedRoot;
    pluginDir = resolvePluginDirectory(root);
    if (!pluginDir.isEmpty()) {
      qputenv("VLC_PLUGIN_PATH", QDir::toNativeSeparators(pluginDir).toUtf8());
    }

    return true;
  }

  bool resolveSymbols() {
    const bool requiredResolved =
      resolve("libvlc_new", newInstance) && resolve("libvlc_release", releaseInstance) &&
      resolve("libvlc_media_new_location", mediaNewLocation) &&
      resolve("libvlc_media_release", mediaRelease) &&
      resolve("libvlc_media_add_option", mediaAddOption) &&
      resolve("libvlc_media_player_new", mediaPlayerNew) &&
      resolve("libvlc_media_player_release", mediaPlayerRelease) &&
      resolve("libvlc_media_player_set_media", mediaPlayerSetMedia) &&
      resolve("libvlc_media_player_play", mediaPlayerPlay) &&
      resolve("libvlc_media_player_stop", mediaPlayerStop) &&
      resolve("libvlc_media_player_set_pause", mediaPlayerSetPause) &&
      resolve("libvlc_media_player_set_time", mediaPlayerSetTime) &&
      resolve("libvlc_media_player_get_time", mediaPlayerGetTime) &&
      resolve("libvlc_media_player_get_length", mediaPlayerGetLength) &&
      resolve("libvlc_media_player_is_playing", mediaPlayerIsPlaying) &&
      resolve("libvlc_media_player_event_manager", mediaPlayerEventManager) &&
      resolve("libvlc_event_attach", eventAttach) &&
      resolve("libvlc_audio_get_volume", audioGetVolume) &&
      resolve("libvlc_audio_set_volume", audioSetVolume) &&
      resolve("libvlc_audio_get_mute", audioGetMute) &&
      resolve("libvlc_audio_set_mute", audioSetMute) &&
      resolve("libvlc_audio_output_set", audioOutputSet) &&
      resolve("libvlc_media_player_set_hwnd", mediaPlayerSetHwnd) &&
      resolve("libvlc_media_player_set_nsobject", mediaPlayerSetNSObject) &&
      resolve("libvlc_media_player_set_xwindow", mediaPlayerSetXWindow) &&
      resolve("libvlc_video_get_size", videoGetSize) &&
      resolve("libvlc_video_set_crop_geometry", videoSetCropGeometry);

    resolve("libvlc_video_get_aspect_ratio", videoGetAspectRatio);
    resolve("libvlc_free", freeFn);

    return requiredResolved;
  }

  bool ensureLoaded() {
    if (loadAttempted) {
      return vlcLibrary.isLoaded();
    }

    loadAttempted = true;

    for (const QString &candidate : candidateRoots()) {
      if (!loadFromRoot(candidate)) {
        continue;
      }

      if (resolveSymbols()) {
        loadError.clear();
        return true;
      }

      loadError = QStringLiteral("libVLC sembolleri tam cozulmedi.");
      unload();
    }

    if (loadError.isEmpty()) {
      loadError = QStringLiteral("libVLC runtime bulunamadi.");
    }
    return false;
  }
};

LibVlcRuntimeState &runtime() {
  static LibVlcRuntimeState instance;
  return instance;
}

}

QString flixifyLibVlcRuntimeError() {
  runtime().ensureLoaded();
  return runtime().loadError;
}

QString flixifyLibVlcRuntimeRoot() {
  runtime().ensureLoaded();
  return runtime().rootDir;
}

QString flixifyLibVlcPluginPath() {
  runtime().ensureLoaded();
  return runtime().pluginDir;
}

bool flixifyLibVlcRuntimeReady() {
  return runtime().ensureLoaded();
}

libvlc_instance_t *libvlc_new(int argc, const char *const *argv) {
  auto &state = runtime();
  return state.ensureLoaded() && state.newInstance ? state.newInstance(argc, argv) : nullptr;
}

void libvlc_release(libvlc_instance_t *instance) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.releaseInstance && instance) {
    state.releaseInstance(instance);
  }
}

libvlc_media_t *libvlc_media_new_location(libvlc_instance_t *instance, const char *location) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaNewLocation && instance && location
           ? state.mediaNewLocation(instance, location)
           : nullptr;
}

void libvlc_media_release(libvlc_media_t *media) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaRelease && media) {
    state.mediaRelease(media);
  }
}

void libvlc_media_add_option(libvlc_media_t *media, const char *option) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaAddOption && media && option) {
    state.mediaAddOption(media, option);
  }
}

libvlc_media_player_t *libvlc_media_player_new(libvlc_instance_t *instance) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaPlayerNew && instance ? state.mediaPlayerNew(instance) : nullptr;
}

void libvlc_media_player_release(libvlc_media_player_t *player) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerRelease && player) {
    state.mediaPlayerRelease(player);
  }
}

void libvlc_media_player_set_media(libvlc_media_player_t *player, libvlc_media_t *media) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerSetMedia && player) {
    state.mediaPlayerSetMedia(player, media);
  }
}

int libvlc_media_player_play(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaPlayerPlay && player ? state.mediaPlayerPlay(player) : -1;
}

void libvlc_media_player_stop(libvlc_media_player_t *player) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerStop && player) {
    state.mediaPlayerStop(player);
  }
}

void libvlc_media_player_set_pause(libvlc_media_player_t *player, int paused) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerSetPause && player) {
    state.mediaPlayerSetPause(player, paused);
  }
}

void libvlc_media_player_set_time(libvlc_media_player_t *player, libvlc_time_t time) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerSetTime && player) {
    state.mediaPlayerSetTime(player, time);
  }
}

libvlc_time_t libvlc_media_player_get_time(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaPlayerGetTime && player ? state.mediaPlayerGetTime(player) : 0;
}

libvlc_time_t libvlc_media_player_get_length(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaPlayerGetLength && player ? state.mediaPlayerGetLength(player) : 0;
}

int libvlc_media_player_is_playing(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaPlayerIsPlaying && player ? state.mediaPlayerIsPlaying(player) : 0;
}

libvlc_event_manager_t *libvlc_media_player_event_manager(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.mediaPlayerEventManager && player
           ? state.mediaPlayerEventManager(player)
           : nullptr;
}

int libvlc_event_attach(
  libvlc_event_manager_t *eventManager,
  libvlc_event_type_t eventType,
  libvlc_callback_t callback,
  void *opaque
) {
  auto &state = runtime();
  return state.ensureLoaded() && state.eventAttach && eventManager && callback
           ? state.eventAttach(eventManager, eventType, callback, opaque)
           : -1;
}

int libvlc_audio_get_volume(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.audioGetVolume && player ? state.audioGetVolume(player) : -1;
}

int libvlc_audio_set_volume(libvlc_media_player_t *player, int volume) {
  auto &state = runtime();
  return state.ensureLoaded() && state.audioSetVolume && player ? state.audioSetVolume(player, volume) : -1;
}

int libvlc_audio_get_mute(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.audioGetMute && player ? state.audioGetMute(player) : 0;
}

void libvlc_audio_set_mute(libvlc_media_player_t *player, int mute) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.audioSetMute && player) {
    state.audioSetMute(player, mute);
  }
}

int libvlc_audio_output_set(libvlc_media_player_t *player, const char *name) {
  auto &state = runtime();
  return state.ensureLoaded() && state.audioOutputSet && player && name
           ? state.audioOutputSet(player, name)
           : -1;
}

void libvlc_media_player_set_hwnd(libvlc_media_player_t *player, void *windowHandle) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerSetHwnd && player) {
    state.mediaPlayerSetHwnd(player, windowHandle);
  }
}

void libvlc_media_player_set_nsobject(libvlc_media_player_t *player, void *objectHandle) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerSetNSObject && player) {
    state.mediaPlayerSetNSObject(player, objectHandle);
  }
}

void libvlc_media_player_set_xwindow(libvlc_media_player_t *player, uint32_t windowId) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.mediaPlayerSetXWindow && player) {
    state.mediaPlayerSetXWindow(player, windowId);
  }
}

int libvlc_video_get_size(libvlc_media_player_t *player, unsigned int num, unsigned int *px, unsigned int *py) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.videoGetSize && player && px && py) {
    return state.videoGetSize(player, num, px, py);
  }
  return -1;
}

char *libvlc_video_get_aspect_ratio(libvlc_media_player_t *player) {
  auto &state = runtime();
  return state.ensureLoaded() && state.videoGetAspectRatio && player ? state.videoGetAspectRatio(player) : nullptr;
}

void libvlc_video_set_crop_geometry(libvlc_media_player_t *player, const char *geometry) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.videoSetCropGeometry && player) {
    state.videoSetCropGeometry(player, geometry);
  }
}

void libvlc_free(void *ptr) {
  auto &state = runtime();
  if (state.ensureLoaded() && state.freeFn && ptr) {
    state.freeFn(ptr);
  }
}
