#include <QGuiApplication>
#include <QDebug>
#include <QIcon>
#include <QQuickWindow>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlError>
#include <QSGRendererInterface>

#include "api_client.h"
#include "native_video_surface.h"
#include "playback_controller.h"

int main(int argc, char *argv[]) {
#if defined(Q_OS_WIN)
  const QString graphicsBackend = qEnvironmentVariable("FLIXIFY_GRAPHICS_BACKEND").trimmed().toLower();
  if (graphicsBackend == QStringLiteral("opengl")) {
    qputenv("QSG_RHI_BACKEND", "opengl");
  } else if (graphicsBackend == QStringLiteral("d3d11")) {
    qputenv("QSG_RHI_BACKEND", "d3d11");
  } else {
    qputenv("QSG_RHI_BACKEND", "software");
    qputenv("QT_OPENGL", "software");
  }
#endif

  QGuiApplication app(argc, argv);
  QCoreApplication::setOrganizationName(QStringLiteral("Flixify"));
  QCoreApplication::setApplicationName(QStringLiteral("Flixify Pro"));
  QCoreApplication::setApplicationVersion(QStringLiteral(FLIXIFY_APP_VERSION));
  QGuiApplication::setWindowIcon(QIcon(QStringLiteral(":/branding/icon.png")));

#if defined(Q_OS_WIN)
  if (graphicsBackend == QStringLiteral("opengl")) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
  } else if (graphicsBackend == QStringLiteral("d3d11")) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
  } else {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Software);
  }
#endif

  qmlRegisterType<NativeVideoSurface>("Flixify.Native", 1, 0, "NativeVideoSurface");

  ApiClient apiClient;
  apiClient.setApiBaseUrl(QStringLiteral(FLIXIFY_API_BASE_URL));

  PlaybackController playbackController(&apiClient);

  QQmlApplicationEngine engine;
  QObject::connect(&engine, &QQmlApplicationEngine::warnings, &app, [](const QList<QQmlError> &warnings) {
    for (const QQmlError &warning : warnings) {
      qWarning().noquote() << warning.toString();
    }
  });
  engine.rootContext()->setContextProperty(QStringLiteral("apiClient"), &apiClient);
  engine.rootContext()->setContextProperty(QStringLiteral("playbackController"), &playbackController);
  engine.load(QUrl(QStringLiteral("qrc:/qml/Main.qml")));

  if (engine.rootObjects().isEmpty()) {
    return 1;
  }

  return app.exec();
}
