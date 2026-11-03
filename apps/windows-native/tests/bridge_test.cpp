#include <QtTest>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QJsonDocument>
#include <QJsonArray>
#include <QDateTime>
#include <QQuickWindow>
#include <QQuickItem>
#include <QQmlProperty>
#include <algorithm>
#include "analytics.h"
#include "app_bridge.h"
#include "player.h"
#include "repository.h"
#include "fake_vlc_runtime.h"

class BridgeFixture final:public QTcpServer {
public:
    QList<QByteArray> requests;
    QList<QTcpSocket*> held;
    bool holdAccount=false;
    BridgeFixture(){listen(QHostAddress::LocalHost);connect(this,&QTcpServer::newConnection,this,[this]{while(hasPendingConnections()){auto socket=nextPendingConnection();connect(socket,&QTcpSocket::disconnected,socket,&QObject::deleteLater);connect(socket,&QTcpSocket::readyRead,socket,[this,socket]{auto bytes=socket->property("bytes").toByteArray()+socket->readAll();socket->setProperty("bytes",bytes);auto split=bytes.indexOf("\r\n\r\n");if(split<0||socket->property("answered").toBool())return;int size=0;for(const auto &line:bytes.left(split).split('\n'))if(line.toLower().startsWith("content-length:"))size=line.mid(15).trimmed().toInt();if(bytes.size()<split+4+size)return;socket->setProperty("answered",true);requests.append(bytes);const auto path=bytes.split(' ').value(1);socket->setProperty("path",path);if(path=="/me"&&holdAccount){held.append(socket);return;}respond(socket);});}});}
    QUrl base()const{return QUrl(QString("http://127.0.0.1:%1").arg(serverPort()));}
    void respond(QTcpSocket *socket,int status=200){
        auto path=socket->property("path").toByteArray();QJsonValue body=QJsonObject{};
        const auto expiry=QDateTime::currentDateTimeUtc().addSecs(3600).toString(Qt::ISODateWithMs);
        if(path=="/analytics/config")body=QJsonObject{{"schema",1},{"consentVersion",1},{"windows",QJsonObject{{"enabled",true},{"measurementId","G-FIXTURE1"}}}};
        else if(path=="/auth/login-by-code")body=QJsonObject{{"accessToken","fixture-access"},{"refreshToken","fixture-refresh"},{"user",QJsonObject{{"id","fixture-account"},{"codeSuffix","TEST"}}}};
        else if(path=="/me")body=QJsonObject{{"user",QJsonObject{{"id","fixture-account"},{"status","active"},{"hasAssignedLink",true},{"hasActiveSubscription",true},{"activePackage",QJsonObject{{"title","Fixture"},{"endsAt",expiry}}}}}};
        else if(path=="/me/provider-session")body=QJsonObject{{"accountId","fixture-account"},{"sourceVersion","fixture-v1"},{"providerOrigin",base().toString()},{"username","fixture-user"},{"password","fixture-secret"},{"expiresAt",expiry},{"moviePolicy","general-audience-only"}};
        else if(path=="/me/welcome-offer")body=QJsonObject{{"campaign","welcome-monthly-50-v1"},{"eligible",false},{"state","not_eligible"},{"offers",QJsonArray{}}};
        else if(path=="/me/personal-library")body=QJsonObject{{"favorites",QJsonArray{}},{"watched",QJsonArray{}}};
        else if(path.contains("get_vod_streams"))body=QJsonArray{QJsonObject{{"stream_id",1},{"name","Fixture film (2026)"},{"category_id","1"},{"container_extension","mp4"}}};
        else if(path.contains("categories"))body=QJsonArray{QJsonObject{{"category_id","1"},{"category_name","TR | Aksiyon (Yabancı)"}}};
        else if(path.contains("player_api"))body=QJsonArray{};
        else if(path=="/me/analytics/events"){const auto bytes=socket->property("bytes").toByteArray();const auto incoming=QJsonDocument::fromJson(bytes.mid(bytes.indexOf("\r\n\r\n")+4)).object();body=QJsonObject{{"accepted",incoming["events"].toArray().size()}};status=202;}
        QByteArray bytes=body.isArray()?QJsonDocument(body.toArray()).toJson(QJsonDocument::Compact):QJsonDocument(body.toObject()).toJson(QJsonDocument::Compact);socket->write("HTTP/1.1 "+QByteArray::number(status)+" Fixture\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: "+QByteArray::number(bytes.size())+"\r\n\r\n"+bytes);socket->disconnectFromHost();
    }
    QList<QJsonObject> events()const{QList<QJsonObject> result;for(const auto &request:requests)if(request.startsWith("POST /me/analytics/events ")){auto body=QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object();for(const auto &event:body["events"].toArray())result.append(event.toObject());}return result;}
    int count(QString name)const{int count=0;for(const auto &event:events())count+=event["name"]==name;return count;}
    void releaseAccount(int status=200){holdAccount=false;auto pending=held;held.clear();for(auto socket:pending)if(socket->state()==QAbstractSocket::ConnectedState)respond(socket,status);}
};

class BridgeTest:public QObject {
    Q_OBJECT
private slots:
    void init(){FakeVlc::reset();}
    void accessPageQueuesPairingVisibilityWithoutBindingLoopsOrDuplicateStarts(){
        BridgeFixture server;QTemporaryDir storage;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=storage.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);DesktopPlayer player;QQmlApplicationEngine engine;installDesktop(engine,repo,player);
        QSignalSpy warnings(&engine,&QQmlEngine::warnings);
        engine.load(QUrl("qrc:/qml/Root.qml"));QVERIFY(!engine.rootObjects().isEmpty());
        auto *window=qobject_cast<QQuickWindow*>(engine.rootObjects().first());QVERIFY(window);
        window->show();window->requestActivate();QTRY_COMPARE(QGuiApplication::applicationState(),Qt::ApplicationActive);
        repo.restore();QTRY_VERIFY(!repo.bootstrapping());
        auto starts=[&]{return std::count_if(server.requests.begin(),server.requests.end(),[](const auto &request){return request.startsWith("POST /auth/device/start ");});};
        QTRY_COMPARE(repo.pairingStatus(),QString("error"));QCOMPARE(starts(),1);
        QQuickItem *access=nullptr;
        for(auto *item:window->findChildren<QQuickItem*>())if(item->metaObject()->indexOfProperty("qrSurfaceVisible")>=0)access=item;
        QVERIFY(access);QVERIFY(access->property("qrSurfaceVisible").toBool());
        QQmlProperty visibility(access,"visible");
        QVERIFY(visibility.write(false));QVERIFY(visibility.write(true));
        QTest::qWait(50);QCOMPARE(starts(),1);
        QVERIFY(visibility.write(false));QTRY_VERIFY(repo.pairingStatus().isEmpty());
        QVERIFY(visibility.write(true));QTRY_COMPARE(repo.pairingStatus(),QString("error"));QCOMPARE(starts(),2);
        QVERIFY(window->findChild<QObject*>("loginCode"));QVERIFY(window->findChild<QObject*>("loginAction"));QVERIFY(window->findChild<QObject*>("pairingRenew"));
        QVERIFY2(warnings.isEmpty(),"Production AccessPage must emit no QML runtime warnings");
        window->hide();
    }
    void userTapIncludesPreflightAndPlayerReturnRestoresActualRoute(){
        BridgeFixture server;QTemporaryDir storage;qint64 now=1000;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=storage.path();options.allowLoopbackForTests=true;options.analyticsClock=[&]{return now;};
        DesktopRepository repo(options);DesktopPlayer player;QQmlApplicationEngine engine;installDesktop(engine,repo,player);player.setSurface(1);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.analyticsAvailable()&&!repo.scope().isEmpty()&&!repo.busy());repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);auto item=repo.items().first().toMap();repo.navigate("home");QTRY_VERIFY(!repo.busy());repo.setAnalyticsConsent(true);auto collector=repo.findChild<DesktopAnalytics*>();QVERIFY(collector);collector->flush();QTRY_COMPARE(collector->pendingCount(),0);
        server.holdAccount=true;repo.playItem(item);QTRY_VERIFY(!server.held.isEmpty());QVERIFY(!player.active());collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("playback_request"),1);QCOMPARE(server.count("video_start"),0);
        now=6500;server.releaseAccount();QTRY_VERIFY(player.hasCurrentVideoFrame());collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("video_start"),1);for(const auto &event:server.events())if(event["name"]=="video_start")QCOMPARE(event["params"].toObject()["startup_ms"].toInteger(),5500LL);
        player.close();collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QStringList screens;for(const auto &event:server.events())if(event["name"]=="app_screen_view")screens.append(event["params"].toObject()["screen_name"].toString());QVERIFY(screens.size()>=3);QCOMPARE(screens.mid(screens.size()-2),QStringList({"player","home"}));player.releaseSurface(1);
    }
    void awaitingPreflightCannotReuseOldPlayerFramesOrNewConsent(){
        BridgeFixture server;QTemporaryDir storage;qint64 now=1000;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=storage.path();options.allowLoopbackForTests=true;options.analyticsClock=[&]{return now;};DesktopRepository repo(options);DesktopPlayer player;QQmlApplicationEngine engine;installDesktop(engine,repo,player);player.setSurface(1);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.analyticsAvailable()&&!repo.scope().isEmpty()&&!repo.busy());repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);auto item=repo.items().first().toMap();repo.setAnalyticsConsent(true);auto collector=repo.findChild<DesktopAnalytics*>();repo.playItem(item);QTRY_VERIFY(player.hasCurrentVideoFrame());collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("video_start"),1);
        now=2000;server.holdAccount=true;repo.playItem(item);QTRY_VERIFY(!server.held.isEmpty());QTest::qWait(350);collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("playback_request"),2);QCOMPARE(server.count("video_start"),1);
        repo.setAnalyticsConsent(false);repo.setAnalyticsConsent(true);now=9000;server.releaseAccount();QTRY_VERIFY(player.hasCurrentVideoFrame());QTest::qWait(300);collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("playback_request"),2);QCOMPARE(server.count("video_start"),1);player.close();player.releaseSurface(1);
    }
    void forcedConsentMeasuresPlaybackStartedBeforeHeldPreflightReturns(){
        BridgeFixture server;QTemporaryDir storage;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=storage.path();options.allowLoopbackForTests=true;DesktopRepository repo(options);DesktopPlayer player;QQmlApplicationEngine engine;installDesktop(engine,repo,player);player.setSurface(1);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.analyticsAvailable()&&!repo.scope().isEmpty()&&!repo.busy());QCOMPARE(repo.analyticsChoice(),QString("accepted"));QVERIFY(!repo.analyticsPromptVisible());repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);server.holdAccount=true;repo.playItem(repo.items().first().toMap());QTRY_VERIFY(!server.held.isEmpty());auto collector=repo.findChild<DesktopAnalytics*>();collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("playback_request"),1);server.releaseAccount();QTRY_VERIFY(player.hasCurrentVideoFrame());collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("video_start"),1);player.close();player.releaseSurface(1);
    }
    void failedAccountPreflightReportsErrorAndEndWithoutStart(){
        BridgeFixture server;QTemporaryDir storage;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=storage.path();options.allowLoopbackForTests=true;DesktopRepository repo(options);DesktopPlayer player;QQmlApplicationEngine engine;installDesktop(engine,repo,player);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.analyticsAvailable()&&!repo.scope().isEmpty()&&!repo.busy());repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);repo.setAnalyticsConsent(true);server.holdAccount=true;repo.playItem(repo.items().first().toMap());QTRY_VERIFY(!server.held.isEmpty());server.releaseAccount(500);QTRY_VERIFY(!repo.busy());auto collector=repo.findChild<DesktopAnalytics*>();collector->flush();QTRY_COMPARE(collector->pendingCount(),0);QCOMPARE(server.count("playback_request"),1);QCOMPARE(server.count("playback_error"),1);QCOMPARE(server.count("playback_end"),1);QCOMPARE(server.count("video_start"),0);QVERIFY(!player.active());
    }
};
QTEST_MAIN(BridgeTest)
#include "bridge_test.moc"
