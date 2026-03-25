#include <QGuiApplication>
#include <QDebug>
#include <QIcon>
#include <QQuickWindow>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlError>
#include <QSGRendererInterface>
#include <QTimer>

#include "api_client.h"
#include "native_video_surface.h"
#include "playback_controller.h"

#if defined(Q_OS_WIN)
#include <windows.h>
#include <dwmapi.h>
#endif

#if defined(Q_OS_WIN)
namespace {

constexpr DWORD kDwmUseImmersiveDarkMode = 20;
constexpr DWORD kDwmBorderColor = 34;
constexpr DWORD kDwmCaptionColor = 35;
constexpr DWORD kDwmTextColor = 36;

void applyWindowsCaptionStyle(QQuickWindow *window) {
  if (!window) {
    return;
  }

  HWND hwnd = reinterpret_cast<HWND>(window->winId());
  if (!hwnd) {
    return;
  }

  const BOOL darkModeEnabled = TRUE;
  const COLORREF captionColor = RGB(5, 7, 11);
  const COLORREF borderColor = RGB(15, 18, 27);
  const COLORREF textColor = RGB(247, 248, 251);

  DwmSetWindowAttribute(hwnd, kDwmUseImmersiveDarkMode, &darkModeEnabled, sizeof(darkModeEnabled));
  DwmSetWindowAttribute(hwnd, kDwmCaptionColor, &captionColor, sizeof(captionColor));
  DwmSetWindowAttribute(hwnd, kDwmBorderColor, &borderColor, sizeof(borderColor));
  DwmSetWindowAttribute(hwnd, kDwmTextColor, &textColor, sizeof(textColor));
}

}  // namespace
#endif

int main(int argc, char *argv[]) {
#if defined(Q_OS_WIN)
  const QString graphicsBackend = qEnvironmentVariable("FLIXIFY_GRAPHICS_BACKEND").trimmed().toLower();
  QByteArray effectiveGraphicsBackend = "d3d11";
  if (graphicsBackend == QStringLiteral("opengl")) {
    effectiveGraphicsBackend = "opengl";
    qputenv("QSG_RHI_BACKEND", "opengl");
  } else if (graphicsBackend == QStringLiteral("d3d11")) {
    effectiveGraphicsBackend = "d3d11";
    qputenv("QSG_RHI_BACKEND", "d3d11");
  } else if (graphicsBackend == QStringLiteral("software")) {
    effectiveGraphicsBackend = "software";
    qputenv("QSG_RHI_BACKEND", "software");
    qputenv("QT_OPENGL", "software");
  } else {
    qputenv("QSG_RHI_BACKEND", "d3d11");
  }
  qputenv("FLIXIFY_GRAPHICS_BACKEND_EFFECTIVE", effectiveGraphicsBackend);
#endif

  QGuiApplication app(argc, argv);
  QCoreApplication::setOrganizationName(QStringLiteral("Flixify"));
  QCoreApplication::setApplicationName(QStringLiteral("Flixify Pro"));
  QCoreApplication::setApplicationVersion(QStringLiteral(FLIXIFY_APP_VERSION));
  QGuiApplication::setWindowIcon(QIcon(QStringLiteral(":/branding/icon.png")));

#if defined(Q_OS_WIN)
  if (graphicsBackend == QStringLiteral("opengl")) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
  } else if (graphicsBackend == QStringLiteral("software")) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Software);
  } else {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
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

  auto *rootWindow = qobject_cast<QQuickWindow *>(engine.rootObjects().constFirst());
  if (!rootWindow) {
    return 1;
  }

#if defined(Q_OS_WIN)
  QTimer::singleShot(0, rootWindow, [rootWindow]() {
    applyWindowsCaptionStyle(rootWindow);
  });
  QObject::connect(rootWindow, &QQuickWindow::visibilityChanged, rootWindow, [rootWindow](QWindow::Visibility) {
    applyWindowsCaptionStyle(rootWindow);
  });
#endif

  QTimer::singleShot(100, rootWindow, [rootWindow]() {
#if defined(Q_OS_WIN)
    const QSize fixedWindowSize(1600, 900);
    rootWindow->setMinimumSize(fixedWindowSize);
    rootWindow->setMaximumSize(fixedWindowSize);
    rootWindow->resize(fixedWindowSize);
#else
    rootWindow->resize(1600, 600);
#endif
    rootWindow->showNormal();
    rootWindow->raise();
  });

  return app.exec();
}
