#include "app_bridge.h"
#include "player.h"
#include "repository.h"
#include <QGuiApplication>
#include <QIcon>
#include <QQmlApplicationEngine>
#include <QTimer>
#if defined(Q_OS_WIN)
#include <windows.h>
#endif

int main(int argc, char **argv) {
#if defined(Q_OS_WIN)
  SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_USER_DIRS);
#endif
  QGuiApplication app(argc, argv);
  QCoreApplication::setOrganizationName("Flixify");
  QCoreApplication::setOrganizationDomain("flixify.vip");
  QCoreApplication::setApplicationName("Flixify Pro");
  QCoreApplication::setApplicationVersion(QStringLiteral(FLIXIFY_APP_VERSION));
#if defined(Q_OS_WIN)
  AddDllDirectory(reinterpret_cast<LPCWSTR>(QCoreApplication::applicationDirPath().utf16()));
#endif
  DesktopRepository repository;
  DesktopPlayer player;
  QQmlApplicationEngine engine;
  installDesktop(engine, repository, player);
  app.setWindowIcon(QIcon("qrc:/brand/icon-512.png"));
  QObject::connect(&app, &QCoreApplication::aboutToQuit, &player, &DesktopPlayer::close);
  engine.load(QUrl("qrc:/qml/Root.qml"));
  if (engine.rootObjects().isEmpty()) return 1;
  QTimer::singleShot(0, &repository, &DesktopRepository::restore);
  return app.exec();
}
