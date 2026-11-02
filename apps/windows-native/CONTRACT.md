# Desktop QObject contract

This document fixes integration names for parallel implementation. QML context properties: `repository` (DesktopRepository), `player` (DesktopPlayer), `appVersion` string, `desktopFocusedWindow` (the exact QGuiApplication focus window, updated on focus changes). Item maps use `id` numeric-string provider ID, `kind` live/movie/series/episode, `title`, `sourceTitle`, `categoryID`, `categoryName`, `artworkURL`, `extension`, `scope`, `seriesID`, `season`, `episode`, `description`, `releaseYear`. Key is kind:seriesID:id. Maps never persist a playable URL or provider password.

## DesktopRepository

Properties (NOTIFY): bool `bootstrapping`, `authenticated`, `busy`, `loadingMore`, `hasMore`, `welcomeVisible`, `posterSoundEnabled`; QString `error`, `route`, `query`, `category`, `country`, `sectionTitle`, `codeSuffix`, `scope`; QVariantMap `account`, `hero`, `seriesDetail`, `welcome`; QVariantList `shelves`, `items`, `categories`, `countries`, `favorites`, `programmes`; int `libraryRevision`; qint64 `expiresAt` (UTC milliseconds).

Invokables: `restore()`, `login(QString code)`, `logout()`, `navigate(QString route)`, `setQuery(QString)`, `setCategory(QString)`, `setCountry(QString)`, `loadMore()`, `refresh()`, `playItem(QVariantMap)`, `showSeries(QVariantMap)`, `toggleFavorite(QVariantMap)`, `bool isFavorite(QVariantMap) const`, `QVariantMap nextEpisode(QVariantMap) const`, `saveProgress(QVariantMap,qint64 positionMs,qint64 durationMs,bool ended=false)`, `refreshPlayback(QVariantMap)`, `loadEpg(QVariantMap)`, `chooseWelcome(bool monthly,int users=1)`, `openWebsite(QString destination)` (allowlisted destination names register/packages/support/downloads only), `setPosterSoundEnabled(bool)`.

Signals: `playbackReady(QVariantMap media)`, `accessRevoked()`, `sourceChanged()`. Media map is `{item:Item,url:QString,expiresAt:qint64,scope:QString,resumeMs:qint64,next:Item}`. Credentials in URL remain ephemeral. `refreshPlayback` returns the same signal and same item only after current access/source checks. Series `playItem` resolves resume/first-unwatched, whereas `showSeries` sets detail without playback. `seriesDetail` is `{series:Item,seasons:[{number:int,episodes:[Item]}]}`. `shelves` is `[{id,title,items:[Item]}]`; category/country entries are `[{id,title}]`. Programme entries are `{title,startsAt:qint64,endsAt:qint64}`. `account` includes `packageTitle`, `canPlay`, `trial`, `expiresAt`, `message`; `welcome` includes counts and minor-unit monthly prices.

Constructor supports injected options for test-only loopback API/provider transport and test storage; production defaults use fixed HTTPS Flixify API, no insecure TLS override. No production fixture flag or account is compiled into the app.

## DesktopPlayer

Properties (NOTIFY): bool `active`, `playing`, `loading`, `live`, `controlsVisible`, `muted`, `fullScreen`; QString `error`, `title`, `aspect`; double `rate`; qint64 `positionMs`, `durationMs`; int `volume`, `nextCountdown`; QVariantMap `item`, `nextItem`; QVariantList `audioTracks`, `subtitleTracks`; int `audioTrack`, `subtitleTrack`.

Invokables: `open(QVariantMap media)`, `close()`, `togglePause()`, `seekBy(int seconds)`, `seek(qint64 positionMs)`, `setVolume(int)`, `setMuted(bool)`, `setRate(double)`, `setAspect(QString)`, `selectAudio(int)`, `selectSubtitle(int)`, `interact()`, `holdControls(bool)`, `setFullScreen(bool)`, `cancelNext()`, `playNext()`, `setSurface(qulonglong handle)`, `switchChannel(int direction)`. Rates are 0.5, 0.75, 1, 1.25, 1.5 or 2; live playback stays at 1. Aspect values are Otomatik, 16:9 or 4:3.

Signals: `progress(QVariantMap item,qint64 positionMs,qint64 durationMs,bool ended)`, `refreshRequested(QVariantMap item)`, `playRequested(QVariantMap item)`, `channelRequested(int direction)`.

An optimistic resume or seek position may be displayed immediately, but progress signals use duration zero until the decoder confirms it; the repository ignores those unconfirmed writes. Completion and next-episode claims require decoder-confirmed progress. All VLC calls run on the serialized worker; QML reads cached GUI-thread properties.

App connects repository playbackReady -> player.open; sourceChanged/accessRevoked -> player.close; player progress -> repository.saveProgress; refreshRequested/playRequested -> repository.refreshPlayback/playItem; channelRequested selects adjacent repository live item. Repository regular access refresh may extend same-source media without restarting eligible video: app updates player expiry through `extendAccess(qint64,QString scope)`.

## Native surface

Register `NativeVideoSurface` in `Flixify.Native 1.0`: QQuickPaintedItem `surfaceHandle`, `mousePassthrough`, `frontSurface`; `pointerActivity(QPointF globalPosition)` signal, using Qt global cursor coordinates. Host window owns native surface, a separate transparent transient QML controls window stays above native child video. Never render decoded frames through a CPU image-copy loop. Physical HWND coordinates must account for devicePixelRatio.

Root sets `shuttingDown` before application exit. The secondary player and overlay accept close events during owner shutdown; ordinary player-window closure stops playback and returns to the root. Hidden secondary native windows must not veto Qt’s application Quit event.
