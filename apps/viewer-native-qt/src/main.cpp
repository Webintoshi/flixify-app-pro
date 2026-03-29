#include <QGuiApplication>
#include <QDebug>
#include <QIcon>
#include <QFile>
#include <QFileInfo>
#include <QScreen>
#include <QTextStream>
#include <QQuickWindow>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlError>
#include <QSGRendererInterface>
#include <QTimer>

#include "api_client.h"
#if !defined(Q_OS_ANDROID)
#include "native_video_surface.h"
#include "vod_playback_controller.h"
#include "live_playback_controller.h"
#endif

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

QSize chooseDesktopWindowSize(const QRect &availableGeometry) {
  static const QSize kProfiles[] = {
    QSize(1600, 900),
    QSize(1280, 720),
    QSize(1024, 576)
  };

  for (const QSize &profile : kProfiles) {
    if (profile.width() <= availableGeometry.width() && profile.height() <= availableGeometry.height()) {
      return profile;
    }
  }

  int fallbackWidth = availableGeometry.width();
  int fallbackHeight = (fallbackWidth * 9) / 16;
  if (fallbackHeight > availableGeometry.height()) {
    fallbackHeight = availableGeometry.height();
    fallbackWidth = (fallbackHeight * 16) / 9;
  }

  fallbackWidth = qMax(960, fallbackWidth);
  fallbackHeight = qMax(540, fallbackHeight);
  fallbackWidth = qMin(fallbackWidth, availableGeometry.width());
  fallbackHeight = qMin(fallbackHeight, availableGeometry.height());

  return QSize(fallbackWidth, fallbackHeight);
}

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
  const QString earlyStartupLogPath =
    QFileInfo(QString::fromLocal8Bit(argv[0])).absolutePath() + QStringLiteral("/flixify-startup.log");
  auto appendEarlyStartupLog = [earlyStartupLogPath](const QString &line) {
    QFile file(earlyStartupLogPath);
    if (file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
      QTextStream stream(&file);
      stream << line << Qt::endl;
    }
  };
  QFile::remove(earlyStartupLogPath);
  appendEarlyStartupLog(QStringLiteral("startup: enter-main"));

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
  appendEarlyStartupLog(QStringLiteral("startup: app-created"));
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

  ApiClient apiClient;
  apiClient.setApiBaseUrl(QStringLiteral(FLIXIFY_API_BASE_URL));

#if !defined(Q_OS_ANDROID)
  qmlRegisterType<NativeVideoSurface>("Flixify.Native", 1, 0, "NativeVideoSurface");
  VodPlaybackController moviePlaybackController(&apiClient);
  VodPlaybackController seriesPlaybackController(&apiClient);
  VodPlaybackController playbackController(&apiClient);
  LivePlaybackController livePlaybackController(&apiClient);
#endif

  QSize desktopWindowSize(1600, 600);
#if defined(Q_OS_WIN)
  if (QScreen *primaryScreen = app.primaryScreen()) {
    desktopWindowSize = chooseDesktopWindowSize(primaryScreen->availableGeometry());
  } else {
    desktopWindowSize = QSize(1280, 720);
  }
#endif

  QQmlApplicationEngine engine;
  const QString startupLogPath =
    QCoreApplication::applicationDirPath() + QStringLiteral("/flixify-startup.log");
  auto appendStartupLog = [startupLogPath](const QString &line) {
    QFile file(startupLogPath);
    if (file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
      QTextStream stream(&file);
      stream << line << Qt::endl;
    }
  };
  appendStartupLog(QStringLiteral("startup: engine-created"));
  QObject::connect(&engine, &QQmlApplicationEngine::warnings, &app, [](const QList<QQmlError> &warnings) {
    for (const QQmlError &warning : warnings) {
      qWarning().noquote() << warning.toString();
    }
  });
  QObject::connect(&engine, &QQmlApplicationEngine::warnings, &app, [appendStartupLog](const QList<QQmlError> &warnings) {
    for (const QQmlError &warning : warnings) {
      appendStartupLog(QStringLiteral("qml-warning: %1").arg(warning.toString()));
    }
  });
  engine.rootContext()->setContextProperty(QStringLiteral("apiClient"), &apiClient);
#if !defined(Q_OS_ANDROID)
  engine.rootContext()->setContextProperty(QStringLiteral("moviePlaybackController"), &moviePlaybackController);
  engine.rootContext()->setContextProperty(QStringLiteral("seriesPlaybackController"), &seriesPlaybackController);
  engine.rootContext()->setContextProperty(QStringLiteral("playbackController"), &playbackController);
  engine.rootContext()->setContextProperty(QStringLiteral("livePlaybackController"), &livePlaybackController);
  engine.rootContext()->setContextProperty(QStringLiteral("desktopWindowWidth"), desktopWindowSize.width());
  engine.rootContext()->setContextProperty(QStringLiteral("desktopWindowHeight"), desktopWindowSize.height());
#endif
  appendStartupLog(QStringLiteral("startup: loading-main-qml"));
#if defined(Q_OS_ANDROID)
  engine.load(QUrl(QStringLiteral("qrc:/qml/MainAndroidTv.qml")));
#else
  engine.load(QUrl(QStringLiteral("qrc:/qml/Main.qml")));
#endif
  appendStartupLog(QStringLiteral("startup: root-count=%1").arg(engine.rootObjects().size()));

  if (engine.rootObjects().isEmpty()) {
    appendStartupLog(QStringLiteral("startup: root-empty"));
    return 1;
  }

  auto *rootWindow = qobject_cast<QQuickWindow *>(engine.rootObjects().constFirst());
  if (!rootWindow) {
    appendStartupLog(QStringLiteral("startup: root-not-window"));
    return 1;
  }
  appendStartupLog(QStringLiteral("startup: root-window-ready visible=%1").arg(rootWindow->isVisible()));

#if defined(Q_OS_WIN)
  QTimer::singleShot(0, rootWindow, [rootWindow]() {
    applyWindowsCaptionStyle(rootWindow);
  });
  QObject::connect(rootWindow, &QQuickWindow::visibilityChanged, rootWindow, [rootWindow](QWindow::Visibility) {
    applyWindowsCaptionStyle(rootWindow);
  });
#endif

#if !defined(Q_OS_ANDROID)
  QTimer::singleShot(100, rootWindow, [rootWindow, desktopWindowSize]() {
#if defined(Q_OS_WIN)
    rootWindow->setMinimumSize(desktopWindowSize);
    rootWindow->setMaximumSize(desktopWindowSize);
    rootWindow->resize(desktopWindowSize);
#else
    rootWindow->resize(1600, 600);
#endif
    rootWindow->showNormal();
    rootWindow->raise();
  });
  QTimer::singleShot(250, rootWindow, [rootWindow, appendStartupLog]() {
    appendStartupLog(
      QStringLiteral("startup: post-show visible=%1 exposed=%2 width=%3 height=%4")
        .arg(rootWindow->isVisible())
        .arg(rootWindow->isExposed())
        .arg(rootWindow->width())
        .arg(rootWindow->height())
    );
  });
#endif

  return app.exec();
}
