#include "app_bridge.h"
#include "native_surface.h"
#include "player.h"
#include "repository.h"
#include "playback_analytics.h"
#include <QDir>
#include <QImageReader>
#include <QGuiApplication>
#include <QWindow>
#include <QNetworkAccessManager>
#include <QNetworkDiskCache>
#include <QNetworkReply>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlNetworkAccessManagerFactory>
#include <QQuickStyle>
#include <QStandardPaths>

namespace {
class ArtworkNetwork final : public QNetworkAccessManager {
 public:
  explicit ArtworkNetwork(QObject *parent) : QNetworkAccessManager(parent) {
    auto *disk = new QNetworkDiskCache(this);
    disk->setCacheDirectory(QDir(QStandardPaths::writableLocation(QStandardPaths::CacheLocation)).filePath("artwork"));
    disk->setMaximumCacheSize(160LL * 1024 * 1024); setCache(disk);
    setTransferTimeout(20000);
  }
 protected:
  QNetworkReply *createRequest(Operation operation, const QNetworkRequest &original, QIODevice *data) override {
    QNetworkRequest request(original);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    auto *reply = QNetworkAccessManager::createRequest(operation, request, data);
    QObject::connect(reply, &QNetworkReply::downloadProgress, reply, [reply](qint64 received, qint64 total) {
      if (received > 8 * 1024 * 1024 || total > 8 * 1024 * 1024) reply->abort();
    });
    return reply;
  }
};
class ArtworkFactory final : public QQmlNetworkAccessManagerFactory {
 public:
  QNetworkAccessManager *create(QObject *parent) override { return new ArtworkNetwork(parent); }
};
}

void installDesktop(QQmlApplicationEngine &engine, DesktopRepository &repository, DesktopPlayer &player) {
  Q_INIT_RESOURCE(desktop_resources);
  QImageReader::setAllocationLimit(48);
  QQuickStyle::setStyle("Basic");
  static ArtworkFactory artwork;
  engine.setNetworkAccessManagerFactory(&artwork);
  qmlRegisterType<NativeVideoSurface>("Flixify.Native", 1, 0, "NativeVideoSurface");
  engine.rootContext()->setContextProperty("repository", &repository);
  engine.rootContext()->setContextProperty("player", &player);
  engine.rootContext()->setContextProperty("appVersion", QStringLiteral(FLIXIFY_APP_VERSION));
  auto *context = engine.rootContext();
  context->setContextProperty("desktopFocusedWindow", QGuiApplication::focusWindow());
  QObject::connect(qGuiApp, &QGuiApplication::focusWindowChanged, context, [context](QWindow *window) {
    context->setContextProperty("desktopFocusedWindow", window);
  });
  auto measurementGeneration = std::make_shared<quint64>(repository.analyticsGeneration());
  auto measurementAttempt=std::make_shared<quint64>(0);
  auto measurement = std::make_shared<PlaybackAnalytics>([&repository,measurementGeneration](QString event,QVariantMap values){repository.recordAnalytics(event,std::move(values),*measurementGeneration);},[&repository]{return repository.analyticsMonotonicNow();});
  auto consent = [&repository,measurement]{measurement->setEnabled(repository.authenticated()&&repository.analyticsAvailable()&&repository.analyticsChoice()=="accepted");};
  consent();
  QObject::connect(&repository,&DesktopRepository::stateChanged,context,consent);
  QObject::connect(&repository,&DesktopRepository::analyticsPlaybackRequested,context,[&repository,measurement,measurementGeneration,measurementAttempt](QVariantMap item,quint64 attempt,quint64 epoch,qint64 startedAt){
    if(epoch!=repository.analyticsGeneration()||!repository.authenticated()||!repository.analyticsAvailable()||repository.analyticsChoice()!="accepted")return;
    *measurementGeneration=epoch;*measurementAttempt=attempt;measurement->request(item,startedAt,true);
  });
  QObject::connect(&repository,&DesktopRepository::analyticsPlaybackFailed,context,[&repository,measurement,measurementGeneration,measurementAttempt](quint64 attempt,quint64 epoch,QString reason){if(attempt==*measurementAttempt&&epoch==*measurementGeneration&&epoch==repository.analyticsGeneration()){measurement->preflightFailed(reason);*measurementAttempt=0;}});
  QObject::connect(&repository, &DesktopRepository::playbackReady, &player, [&repository,&player,measurement,measurementGeneration,measurementAttempt](const QVariantMap &media){
    if(!media.value("analyticsContinuation").toBool()&&media.value("analyticsAttempt").toULongLong()==*measurementAttempt&&*measurementAttempt&&media.value("analyticsEpoch").toULongLong()==repository.analyticsGeneration()&&*measurementGeneration==repository.analyticsGeneration())measurement->admit(media.value("item").toMap());
    player.open(media);
  });
  QObject::connect(&player,&DesktopPlayer::stateChanged,context,[&repository,&player,measurement]{repository.setAnalyticsPlayerVisible(player.active());measurement->observe({player.active(),player.hasCurrentVideoFrame(),player.playing(),player.loading(),!player.error().isEmpty(),player.positionMs(),player.live()?0:player.durationMs(),player.wantsPlayback(),player.recovering(),player.buffering()});});
  QObject::connect(&player,&DesktopPlayer::progress,context,[measurement](const QVariantMap &,qint64,qint64,bool ended){if(ended)measurement->complete();});
  QObject::connect(&repository, &DesktopRepository::sourceChanged, &player, &DesktopPlayer::close);
  QObject::connect(&repository, &DesktopRepository::accessRevoked, &player, &DesktopPlayer::close);
  QObject::connect(&repository, &DesktopRepository::accessExtended, &player, &DesktopPlayer::extendAccess);
  QObject::connect(&player, &DesktopPlayer::progress, &repository, &DesktopRepository::saveProgress);
  QObject::connect(&player, &DesktopPlayer::refreshRequested, &repository, &DesktopRepository::refreshPlayback);
  QObject::connect(&player, &DesktopPlayer::playRequested, &repository, &DesktopRepository::playItem);
  QObject::connect(&player, &DesktopPlayer::channelRequested, &repository, [&repository, &player](int direction) {
    repository.playAdjacentLive(player.item(), direction);
  });
}
