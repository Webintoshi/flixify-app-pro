#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>

#include "api_client.h"
#include "native_video_surface.h"
#include "playback_controller.h"

int main(int argc, char *argv[]) {
  QGuiApplication app(argc, argv);
  QCoreApplication::setOrganizationName(QStringLiteral("Flixify"));
  QCoreApplication::setApplicationName(QStringLiteral("Flixify Native Qt"));
  QCoreApplication::setApplicationVersion(QStringLiteral(FLIXIFY_APP_VERSION));

  qmlRegisterType<NativeVideoSurface>("Flixify.Native", 1, 0, "NativeVideoSurface");

  ApiClient apiClient;
  apiClient.setApiBaseUrl(QStringLiteral(FLIXIFY_API_BASE_URL));

  PlaybackController playbackController(&apiClient);

  QQmlApplicationEngine engine;
  engine.rootContext()->setContextProperty(QStringLiteral("apiClient"), &apiClient);
  engine.rootContext()->setContextProperty(QStringLiteral("playbackController"), &playbackController);
  engine.load(QUrl(QStringLiteral("qrc:/qml/Main.qml")));

  if (engine.rootObjects().isEmpty()) {
    return 1;
  }

  return app.exec();
}
