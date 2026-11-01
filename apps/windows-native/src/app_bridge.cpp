#include "app_bridge.h"
#include "native_surface.h"
#include "player.h"
#include "repository.h"
#include <QDir>
#include <QImageReader>
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
  QObject::connect(&repository, &DesktopRepository::playbackReady, &player, &DesktopPlayer::open);
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
