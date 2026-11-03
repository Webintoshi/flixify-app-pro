#include <QtTest>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QJsonDocument>
#include <QSignalSpy>
#include <QTimeZone>
#include <QUrlQuery>
#include <QTimer>
#include <QElapsedTimer>
#include <QSettings>
#include "catalog.h"
#include "repository.h"
#include "analytics.h"
#include "device_login_policy.h"
#include <QImage>
#include <QBuffer>
#include <QNetworkAccessManager>
#include <QNetworkReply>
class FixtureServer : public QTcpServer {
public:
    QList<QByteArray> requests;
    qint64 expiry=2000000000000;
    QString version="v1";
    QString providerUser="fixture-user",providerPassword="fixture-secret";
    QSet<QString> delayedPaths;
    QSet<QString> delayedUnauthorizedPaths;
    QSet<QString> delayedActions;
    int movieCount=1;
    QJsonArray favoriteRefs;
    QHash<QString,QJsonValue> overrides;
    QHash<QString,QByteArray> rawOverrides;
    QHash<QString,QJsonValue> actionOverrides;
    QList<QTcpSocket *> delayed;
    bool singleUseRefresh=false;
    QString currentAccess="fixture-access",currentRefresh="fixture-refresh";
    int issuedRotations=0;
    FixtureServer() { listen(QHostAddress::LocalHost);connect(this,&QTcpServer::newConnection,this,[this]{while(hasPendingConnections()){auto s=nextPendingConnection();connect(s,&QTcpSocket::readyRead,s,[this,s]{auto data=s->property("data").toByteArray()+s->readAll();s->setProperty("data",data);int split=data.indexOf("\r\n\r\n");if(split<0)return;int length=0;for(auto h:data.left(split).split('\n'))if(h.toLower().startsWith("content-length:"))length=h.mid(15).trimmed().toInt();if(data.size()<split+4+length)return;s->disconnect(SIGNAL(readyRead()));requests.append(data);auto path=QString::fromLatin1(data.split(' ').value(1));s->setProperty("path",path);
        if(singleUseRefresh){
            if(path=="/auth/refresh"){
                const auto body=QJsonDocument::fromJson(data.mid(split+4,length)).object();
                if(body.value("refreshToken").toString()!=currentRefresh){respondStatus(s,401);return;}
                issuedRotations++;currentAccess=QString("fixture-access-%1").arg(issuedRotations+1);currentRefresh=QString("fixture-refresh-%1").arg(issuedRotations+1);
                s->setProperty("issuedRotation",QVariantMap{{"accessToken",currentAccess},{"refreshToken",currentRefresh},{"user",QVariantMap{{"id","account"},{"codeSuffix","TEST"}}}});
            }else if(path.startsWith("/me")){
                QByteArray token;for(const auto &header:data.left(split).split('\n'))if(header.toLower().startsWith("authorization:"))token=header.mid(14).trimmed();
                if(token!="Bearer "+currentAccess.toUtf8()){if(delayedUnauthorizedPaths.contains(path)){s->setProperty("rejectedToken",token);delayed.append(s);return;}respondStatus(s,401);return;}
            }
        }
        bool delay=delayedPaths.contains(path);for(const auto &action:delayedActions)if(path.contains(action))delay=true;if(delay){delayed.append(s);return;}respond(s,path);});}}); }
    QUrl base() const {return QUrl(QString("http://127.0.0.1:%1").arg(serverPort()));}
    void respondStatus(QTcpSocket *s,int status) {
        const auto bytes=QJsonDocument(QJsonObject{{"ok",false}}).toJson(QJsonDocument::Compact);
        s->write("HTTP/1.1 "+QByteArray::number(status)+" Fixture\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+QByteArray::number(bytes.size())+"\r\n\r\n"+bytes);s->disconnectFromHost();
    }
    void respond(QTcpSocket *s,QString path) {
        QJsonValue body;
        if(path=="/auth/login-by-code"||path=="/auth/refresh")body=QJsonObject{{"accessToken","fixture-access"},{"refreshToken","fixture-refresh"},{"user",QJsonObject{{"id","account"},{"codeSuffix","TEST"}}}};
        else if(path=="/me")body=QJsonObject{{"user",QJsonObject{{"id","account"},{"codeSuffix","TEST"},{"status","active"},{"hasAssignedLink",true},{"hasActiveSubscription",true},{"activePackage",QJsonObject{{"title","Paket"},{"endsAt",QDateTime::fromMSecsSinceEpoch(expiry,QTimeZone::UTC).toString(Qt::ISODateWithMs)}}}}}};
        else if(path=="/me/provider-session")body=QJsonObject{{"accountId","account"},{"sourceVersion",version},{"providerOrigin",base().toString()},{"username",providerUser},{"password",providerPassword},{"expiresAt",QDateTime::fromMSecsSinceEpoch(expiry,QTimeZone::UTC).toString(Qt::ISODateWithMs)},{"moviePolicy","general-audience-only"}};
        else if(path=="/me/welcome-offer")body=QJsonObject{{"campaign","welcome-monthly-50-v1"},{"eligible",false},{"state","not_eligible"},{"offers",QJsonArray{}}};
        else if(path=="/me/personal-library/watched"||path=="/me/personal-library/favorites")body=QJsonObject{{"ok",true}};
        else if(path=="/me/personal-library")body=QJsonObject{{"favorites",favoriteRefs},{"watched",QJsonArray{}}};
        else if(path.contains("categories"))body=QJsonArray{QJsonObject{{"category_id","1"},{"category_name","TR | Aksiyon (Yabancı)"}}};
        else if(path.contains("get_vod_streams")){QJsonArray rows;for(int i=1;i<=movieCount;i++)rows.append(QJsonObject{{"stream_id",QString::number(i)},{"name",QString("%1 Işık %2 Özel (2026)").arg(version).arg(i)},{"category_id","1"},{"container_extension","mp4"}});body=rows;}
        else body=QJsonArray{};
        if(singleUseRefresh&&path=="/auth/refresh")body=QJsonObject::fromVariantMap(s->property("issuedRotation").toMap());
        auto action=QUrlQuery(QUrl("http://fixture"+path)).queryItemValue("action");if(actionOverrides.contains(action))body=actionOverrides.value(action);
        if(overrides.contains(path))body=overrides.value(path);
        QByteArray bytes=body.isArray()?QJsonDocument(body.toArray()).toJson(QJsonDocument::Compact):QJsonDocument(body.toObject()).toJson(QJsonDocument::Compact);
        if(rawOverrides.contains(path))bytes=rawOverrides[path];
        s->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+QByteArray::number(bytes.size())+"\r\n\r\n"+bytes);s->disconnectFromHost();
    }
};
class RepositoryTest : public QObject {
    Q_OBJECT
private:
    static QJsonObject challenge() {
        QImage image(128,128,QImage::Format_RGB32);image.fill(Qt::white);QByteArray png;QBuffer buffer(&png);buffer.open(QIODevice::WriteOnly);image.save(&buffer,"PNG");
        return {{"requestId","00000000-0000-0000-0000-000000000002"},{"deviceSecret",QString(43,'a')},{"userCode","BCDF-GHJK"},{"verificationUri","https://flixify.vip/cihaz"},{"verificationUriComplete","https://flixify.vip/cihaz?code=BCDF-GHJK"},{"qrPngBase64",QString::fromLatin1(png.toBase64())},{"expiresAt","2026-12-01T00:00:00.000Z"},{"expiresInSeconds",180},{"intervalSeconds",2}};
    }
private slots:
    void pairingAuthorizationAtFinalDeadlineNeverAdopts() {
        FixtureServer server;QTemporaryDir dir;qint64 monotonic=0;
        server.overrides["/auth/device/start"]=challenge();server.delayedPaths.insert("/auth/device/token");
        server.overrides["/auth/device/token"]=QJsonObject{{"status","authorized"},{"session",QJsonObject{{"accessToken","late-access"},{"refreshToken","late-refresh"},{"user",QJsonObject{{"id","late-account"},{"codeSuffix","LATE"}}}}}};
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.deviceLoginClock=[&]{return monotonic;};
        DesktopRepository repo(options);bool adopted=false;
        connect(&repo,&DesktopRepository::stateChanged,&repo,[&]{adopted=adopted||repo.authenticated();});
        repo.startDeviceLogin();QTRY_COMPARE(repo.pairingCode(),QString("BCDF-GHJK"));monotonic=239999;
        QTRY_VERIFY_WITH_TIMEOUT(!server.delayed.isEmpty(),6000);
        QNetworkReply *tokenReply=nullptr;
        for(auto *reply:repo.findChildren<QNetworkReply*>())if(reply->url().path()=="/auth/device/token")tokenReply=reply;
        QVERIFY(tokenReply);
        // Move the deadline during response delivery, after all countdown/preflight checks.
        connect(tokenReply,&QIODevice::readyRead,&repo,[&]{monotonic=240000;});
        server.respond(server.delayed.takeFirst(),"/auth/device/token");
        QTRY_COMPARE(repo.pairingStatus(),QString("expired"));
        QVERIFY(!repo.authenticated());QVERIFY(!adopted);QVERIFY(repo.pairingCode().isEmpty());
        QTRY_VERIFY(std::any_of(server.requests.begin(),server.requests.end(),[](const auto &r){return r.startsWith("POST /auth/device/cancel ");}));
        for(const auto &r:server.requests){QVERIFY(!r.startsWith("POST /auth/device/ack "));QVERIFY(!r.startsWith("GET /me "));}
        repo.restore();QTRY_VERIFY(!repo.bootstrapping());QVERIFY(!repo.authenticated());
    }

    void pairingAuthorizationWithinFinalGraceStillAdopts() {
        FixtureServer server;QTemporaryDir dir;qint64 monotonic=0;
        server.overrides["/auth/device/start"]=challenge();server.delayedPaths.insert("/auth/device/token");
        server.overrides["/auth/device/token"]=QJsonObject{{"status","authorized"},{"session",QJsonObject{{"accessToken","grace-access"},{"refreshToken","grace-refresh"},{"user",QJsonObject{{"id","account"},{"codeSuffix","TEST"}}}}}};
        server.overrides["/auth/device/ack"]=QJsonObject{{"status","complete"}};
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.deviceLoginClock=[&]{return monotonic;};
        DesktopRepository repo(options);repo.startDeviceLogin();QTRY_COMPARE(repo.pairingCode(),QString("BCDF-GHJK"));monotonic=239999;
        QTRY_VERIFY_WITH_TIMEOUT(!server.delayed.isEmpty(),6000);server.respond(server.delayed.takeFirst(),"/auth/device/token");
        QTRY_VERIFY(repo.authenticated());QCOMPARE(repo.codeSuffix(),QString("TEST"));
    }

    void pairingAdoptsCodeLessTokensAndAcknowledgesOnce() {
        FixtureServer server;QTemporaryDir dir;server.overrides["/auth/device/start"]=challenge();
        server.overrides["/auth/device/token"]=QJsonObject{{"status","authorized"},{"session",QJsonObject{{"accessToken","paired-access"},{"refreshToken","paired-refresh"},{"user",QJsonObject{{"id","account"},{"codeSuffix","TEST"}}}}}};
        server.overrides["/auth/device/ack"]=QJsonObject{{"status","complete"}};
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.startDeviceLogin();QTRY_COMPARE(repo.pairingCode(),QString("BCDF-GHJK"));
        QTRY_VERIFY_WITH_TIMEOUT(repo.authenticated(),6000);
        QTRY_VERIFY(std::any_of(server.requests.begin(),server.requests.end(),[](const auto &r){return r.startsWith("POST /auth/device/ack ");}));
        QCOMPARE(repo.codeSuffix(),QString("TEST"));
        int polls=0;for(const auto &r:server.requests){polls+=r.startsWith("POST /auth/device/token ");QVERIFY(!r.startsWith("POST /auth/login-by-code "));}
        QCOMPARE(polls,1);QVERIFY(!repo.pairingQrSource().contains("paired-access"));
    }
    void pairingCancelFencesDelayedAuthorizedResponseBeforeSecureSave() {
        FixtureServer server;QTemporaryDir dir;server.overrides["/auth/device/start"]=challenge();
        server.delayedPaths.insert("/auth/device/token");
        server.overrides["/auth/device/token"]=QJsonObject{{"status","authorized"},{"session",QJsonObject{{"accessToken","stale-access"},{"refreshToken","stale-refresh"},{"user",QJsonObject{{"id","stale-account"},{"codeSuffix","OLDX"}}}}}};
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.startDeviceLogin();QTRY_VERIFY_WITH_TIMEOUT(!server.delayed.isEmpty(),6000);
        repo.cancelDeviceLogin();repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.authenticated());QCOMPARE(repo.codeSuffix(),QString("TEST"));
        for(const auto &request:server.requests)QVERIFY(!request.startsWith("POST /auth/device/ack "));
        QCOMPARE(repo.pairingCode(),QString());
    }
    void pairingBootstrapRetryUsesAdoptedSessionWithoutNewIssuance() {
        FixtureServer server;QTemporaryDir dir;server.overrides["/auth/device/start"]=challenge();server.overrides["/me"]=QJsonObject{};
        server.overrides["/auth/device/token"]=QJsonObject{{"status","authorized"},{"session",QJsonObject{{"accessToken","paired-access"},{"refreshToken","paired-refresh"},{"user",QJsonObject{{"id","account"},{"codeSuffix","TEST"}}}}}};
        server.overrides["/auth/device/ack"]=QJsonObject{{"status","complete"}};
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.startDeviceLogin();QTRY_COMPARE_WITH_TIMEOUT(repo.pairingStatus(),QString("bootstrap_error"),6000);QVERIFY(repo.authenticated());
        server.overrides.remove("/me");repo.retryDeviceBootstrap();QTRY_COMPARE(repo.pairingStatus(),QString("complete"));
        int polls=0;for(const auto &r:server.requests)polls+=r.startsWith("POST /auth/device/token ");QCOMPARE(polls,1);
    }
    void pairingRejectsForeignQRAndTerminalDenialStopsPolling() {
        FixtureServer server;QTemporaryDir dir;auto value=challenge();value["verificationUriComplete"]="https://evil.invalid/cihaz?code=BCDF-GHJK";server.overrides["/auth/device/start"]=value;
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.startDeviceLogin();QTRY_COMPARE(repo.pairingStatus(),QString("error"));QVERIFY(repo.pairingCode().isEmpty());
        server.overrides["/auth/device/start"]=challenge();server.overrides["/auth/device/token"]=QJsonObject{{"status","denied"}};
        repo.startDeviceLogin();QTRY_COMPARE(repo.pairingStatus(),QString("denied"));QVERIFY(!repo.authenticated());
    }
    void pairingPrivacyAndDeliveryGrace() {
        const auto &meta = DesktopRepository::staticMetaObject;
        QVERIFY(meta.indexOfProperty("pairingCode") >= 0);
        QVERIFY(meta.indexOfProperty("deviceSecret") < 0);
        QVERIFY(meta.indexOfProperty("pairingSecret") < 0);
        QVERIFY(DeviceLoginLifetime::canPoll(239999));
        QVERIFY(!DeviceLoginLifetime::canPoll(240000));
        QCOMPARE(DeviceLoginLifetime::remaining(180000), 0);
    }
    void cancelDelayedPairingAndPreserveManualLogin() {
        FixtureServer server; QTemporaryDir dir;
        server.delayedPaths.insert("/auth/device/start");
        RepositoryOptions options; options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.startDeviceLogin();
        QTRY_VERIFY(!server.delayed.isEmpty());repo.cancelDeviceLogin();repo.login("ABCDEFGHIJKLMNOP");
        QTRY_VERIFY(repo.authenticated());QCOMPARE(repo.pairingCode(),QString());
        QCOMPARE(repo.codeSuffix(),QString("TEST"));
    }
    void persistedConsentCountsCurrentScreenAfterDelayedConfiguration() {
        FixtureServer server;server.delayedPaths.insert("/analytics/config");server.overrides["/analytics/config"]=QJsonObject{{"schema",1},{"consentVersion",1},{"windows",QJsonObject{{"enabled",true},{"measurementId","G-FIXTURE1"}}}};
        QTemporaryDir dir;QSettings preferences(dir.path()+"/analytics.ini",QSettings::IniFormat);preferences.setValue("analytics/v1/choice","accepted");preferences.sync();
        RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));QTRY_VERIFY(!repo.busy());QTRY_VERIFY(!server.delayed.isEmpty());QVERIFY(!repo.analyticsAvailable());
        auto *collector=repo.findChild<DesktopAnalytics*>();QVERIFY(collector);QCOMPARE(collector->pendingCount(),0);
        auto *configuration=server.delayed.first();server.delayedPaths.remove("/analytics/config");server.respond(configuration,"/analytics/config");QTRY_VERIFY(repo.analyticsAvailable());collector->flush();
        QTRY_VERIFY(std::any_of(server.requests.begin(),server.requests.end(),[](const auto &r){return r.startsWith("POST /me/analytics/events ");}));
        int screens=0;for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events ")){const auto body=QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object();for(const auto &v:body["events"].toArray()){auto event=v.toObject();if(event["name"]=="app_screen_view"&&event["params"].toObject()["screen_name"]=="home")screens++;}}
        QCOMPARE(screens,1);QVERIFY(repo.account()["canPlay"].toBool());
    }
    void logoutUsesFinalOldAuthenticationWithoutDelayingNextLogin() {
        FixtureServer server;server.overrides["/analytics/config"]=QJsonObject{{"schema",1},{"consentVersion",1},{"windows",QJsonObject{{"enabled",true},{"measurementId","G-FIXTURE1"}}}};
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));QTRY_VERIFY(repo.analyticsAvailable());repo.setAnalyticsConsent(true);
        auto *collector=repo.findChild<DesktopAnalytics*>();QVERIFY(collector);const auto oldClient=collector->clientId();repo.recordAnalytics("search",{{"query_length",9},{"result_count",3}});
        repo.logout();QVERIFY(!repo.authenticated());
        server.overrides["/auth/login-by-code"]=QJsonObject{{"accessToken","fixture-next-access"},{"refreshToken","fixture-next-refresh"},{"user",QJsonObject{{"id","next-account"},{"codeSuffix","NEXT"}}}};
        repo.login("PONMLKJIHGFEDCBA");QTRY_VERIFY(repo.authenticated());QVERIFY(collector->clientId()!=oldClient);
        auto logouts=[&]{int count=0;for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events ")){const auto body=QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object();for(const auto &event:body["events"].toArray())if(event.toObject()["name"]=="logout")count++;}return count;};QTRY_COMPARE(logouts(),1);
        for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events ")){const auto body=QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object();if(body["clientId"].toString()!=oldClient)continue;QVERIFY(request.contains("Authorization: Bearer fixture-access\r\n"));QVERIFY(body["events"].toArray().size()<=20);int logout=0;for(const auto &event:body["events"].toArray())logout+=event.toObject()["name"]=="logout";QCOMPARE(logout,1);QVERIFY(!request.mid(request.indexOf("\r\n\r\n")+4).contains("fixture-access"));}
        const auto nextClient=collector->clientId();collector->flush();QTRY_VERIFY(std::any_of(server.requests.begin(),server.requests.end(),[&](const auto &request){return request.startsWith("POST /me/analytics/events ")&&QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object()["clientId"]==nextClient;}));
        for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events ")){const auto body=QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object();if(body["clientId"]!=nextClient)continue;QVERIFY(request.contains("Authorization: Bearer fixture-next-access\r\n"));for(const auto &event:body["events"].toArray())QVERIFY(event.toObject()["name"]!="search");}
    }
    void analyticsIsAcceptedWithoutAConsentPromptAndStaysSeparateFromContentAccess() {
        FixtureServer server;server.overrides["/analytics/config"]=QJsonObject{{"schema",1},{"consentVersion",1},{"windows",QJsonObject{{"enabled",true},{"measurementId","G-FIXTURE1"}}}};
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        QSettings preferences(dir.path()+"/analytics.ini",QSettings::IniFormat);preferences.setValue("analytics/v1/choice","rejected");preferences.sync();
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));QTRY_VERIFY(repo.analyticsAvailable());QTRY_VERIFY(!repo.busy());
        auto *collector=repo.findChild<DesktopAnalytics*>();QVERIFY(collector);QCOMPARE(repo.analyticsChoice(),QString("accepted"));QVERIFY(!repo.analyticsPromptVisible());QVERIFY(repo.account()["canPlay"].toBool());QVERIFY(collector->pendingCount()>0);
        const auto old=repo.analyticsGeneration();
        repo.setAnalyticsConsent(false);repo.setAnalyticsConsent(true);const auto pending=collector->pendingCount();repo.recordAnalytics("login",{{"method","code"}},old);QCOMPARE(collector->pendingCount(),pending);
        collector->flush();QTRY_VERIFY(std::any_of(server.requests.begin(),server.requests.end(),[](const auto &request){return request.startsWith("POST /me/analytics/events ");}));
        QByteArray body;for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events ")){QVERIFY(request.contains("Authorization: Bearer fixture-access"));body=request.mid(request.indexOf("\r\n\r\n")+4);}
        QVERIFY(!body.contains("ABCDEFGHIJKLMNOP"));QVERIFY(!body.contains("fixture-secret"));QVERIFY(!body.contains("fixture-access"));QVERIFY(!body.contains("account:v1"));
        QSignalSpy ready(&repo,&DesktopRepository::playbackReady);repo.navigate("movies");QTRY_VERIFY(!repo.items().isEmpty()&&repo.items().first().toMap()["kind"]=="movie");repo.playItem(repo.items().first().toMap());QTRY_COMPARE(ready.size(),1);QVERIFY(!ready.last().first().toMap()["analyticsContinuation"].toBool());
        repo.refreshPlayback(ready.last().first().toMap()["item"].toMap());QTRY_COMPARE(ready.size(),2);QVERIFY(ready.last().first().toMap()["analyticsContinuation"].toBool());
    }
    void fixtureTrafficUsesCurrentEndpointsAndViewerProvider() {
        FixtureServer server;QTemporaryDir dir; RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        DesktopRepository repo(options);QSignalSpy ready(&repo,&DesktopRepository::playbackReady);
        repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.authenticated());QTRY_VERIFY(!repo.busy());QCOMPARE(repo.scope(),QString("account:v1"));
        repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);repo.playItem(repo.items().first().toMap());QTRY_COMPARE(ready.size(),1);
        auto media=ready.first().first().toMap();QVERIFY(media.value("url").toString().contains("/movie/fixture-user/fixture-secret/1.mp4"));
        QByteArray traffic;for(auto request:server.requests)traffic+=request;
        QVERIFY(traffic.contains("/me/provider-session"));QVERIFY(traffic.contains("/player_api.php?"));QVERIFY(!traffic.contains("/me/native"));QVERIFY(!repo.error().contains("fixture-secret"));
    }
    void absoluteExpiryRevokesAndRejectsPlayback() {
        FixtureServer server;QTemporaryDir dir;qint64 time=1900000000000LL;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[&]{return time;};
        DesktopRepository repo(options);QSignalSpy ready(&repo,&DesktopRepository::playbackReady);QSignalSpy revoked(&repo,&DesktopRepository::accessRevoked);
        repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.authenticated());QTRY_VERIFY(!repo.busy());repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);auto item=repo.items().first().toMap();
        time=server.expiry;repo.playItem(item);QTRY_VERIFY(revoked.size()>0);QCOMPARE(ready.size(),0);QVERIFY(repo.scope().isEmpty());
    }
    void logoutRejectsLateAccountResponse() {
        FixtureServer server;server.delayedPaths.insert("/me");QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(!server.delayed.isEmpty());repo.logout();for(auto s:server.delayed)if(s->state()==QAbstractSocket::ConnectedState)server.respond(s,"/me");QTest::qWait(30);
        QVERIFY(!repo.authenticated());QVERIFY(repo.items().isEmpty());QVERIFY(repo.scope().isEmpty());
    }
    void sourceSwitchCancelsOldCatalogAndRejectsOldItem() {
        FixtureServer server;server.delayedActions.insert("get_vod_streams");QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        DesktopRepository repo(options);QSignalSpy ready(&repo,&DesktopRepository::playbackReady);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));QTRY_VERIFY(!server.delayed.isEmpty());
        QVariantMap stale{{"id","1"},{"kind","movie"},{"scope","account:v1"},{"extension","mp4"}};
        server.version="v2";server.delayedActions.clear();repo.refresh();QTRY_COMPARE(repo.scope(),QString("account:v2"));
        QTRY_COMPARE(server.delayed.first()->state(),QAbstractSocket::UnconnectedState);
        repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);QVERIFY(repo.items().first().toMap()["title"].toString().startsWith("v2"));
        repo.playItem(stale);QTest::qWait(30);QCOMPARE(ready.size(),0);
    }
    void allCatalogSearchIsIndependentOfVisibleSlice() {
        FixtureServer server;server.movieCount=220;QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.account().value("canPlay").toBool());repo.navigate("movies");QTRY_COMPARE(repo.items().size(),96);QVERIFY(repo.hasMore());repo.setQuery("isik 220 ozel");QTRY_COMPARE(repo.items().size(),1);QCOMPARE(repo.items().first().toMap()["id"].toString(),QString("220"));QVERIFY(!repo.hasMore());repo.setQuery("");QTRY_COMPARE(repo.items().size(),96);repo.loadMore();QTRY_COMPARE(repo.items().size(),192);
    }
    void posterSoundPreferenceSurvivesRepositoryLifetime() {
        QTemporaryDir dir;RepositoryOptions options;options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        {DesktopRepository repo(options);QVERIFY(repo.posterSoundEnabled());repo.setPosterSoundEnabled(false);}
        DesktopRepository restored(options);QVERIFY(!restored.posterSoundEnabled());
    }
    void malformedProviderFailsClosedWithoutLeakingSecrets() {
        FixtureServer server;server.overrides["/me/provider-session"]=QJsonObject{{"accountId","account"},{"sourceVersion","v1"},{"providerOrigin","http://untrusted.example"},{"username","fixture-user"},{"password","fixture-secret"},{"expiresAt","2099-01-01T00:00:00Z"},{"moviePolicy","general-audience-only"}};QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.authenticated());QTRY_VERIFY(!repo.busy());QVERIFY(repo.scope().isEmpty());QVERIFY(!repo.account().value("canPlay").toBool());QVERIFY(!repo.error().contains("fixture-secret"));for(const auto&r:server.requests)QVERIFY(!r.contains("player_api.php"));
    }

    void duplicateJsonKeysCannotAuthenticate() {
        FixtureServer server;server.rawOverrides["/auth/login-by-code"]=R"({"accessToken":"first","accessToken":"second","refreshToken":"fixture-refresh","user":{"id":"account","codeSuffix":"TEST"}})";QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;
        DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(!repo.busy());QVERIFY(!repo.authenticated());QVERIFY(!repo.error().isEmpty());
    }

    void watchedThresholdIsFinalFivePercentCappedAtTwoMinutes() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","Fixture Series (2026)"},{"category_id","1"}}};
        server.actionOverrides["get_series_info"]=QJsonObject{{"episodes",QJsonObject{{"1",QJsonArray{QJsonObject{{"id","11"},{"season",1},{"episode_num",1},{"container_extension","mp4"}},QJsonObject{{"id","12"},{"season",1},{"episode_num",2},{"container_extension","mp4"}}}},{"2",QJsonArray{QJsonObject{{"id","21"},{"season",2},{"episode_num",1},{"container_extension","mp4"}}}}}}};
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.account().value("canPlay").toBool());repo.navigate("series");
        QTRY_COMPARE(repo.items().value(0).toMap().value("kind").toString(),QString("series"));
        QCOMPARE(repo.items().size(),1);QCOMPARE(repo.items().first().toMap().value("id").toString(),QString("9"));
        repo.showSeries(repo.items().first().toMap());QTRY_VERIFY(!repo.seriesDetail().isEmpty());auto episodes=Catalog::episodes(repo.seriesDetail());QCOMPARE(episodes.size(),3);auto first=episodes[0].toMap(),second=episodes[1].toMap();
        QCOMPARE(repo.nextEpisode(first)["id"].toString(),QString("12"));QCOMPARE(repo.nextEpisode(second)["id"].toString(),QString("21"));QVERIFY(repo.nextEpisode(episodes[2].toMap()).isEmpty());
        auto writes=[&] {int n=0;for(const auto&r:server.requests)if(r.startsWith("PUT /me/personal-library/watched "))n++;return n;};
        auto unknown=first;unknown["id"]="999";repo.saveProgress(unknown,599000,600000);QTest::qWait(30);QCOMPARE(writes(),0);
        repo.saveProgress(first,540000,600000);QTest::qWait(30);QCOMPARE(writes(),0);repo.saveProgress(first,570000,600000);QTRY_COMPARE(writes(),1);repo.saveProgress(first,590000,600000);QTest::qWait(30);QCOMPARE(writes(),1);
        repo.saveProgress(second,6900000,7200000);QTest::qWait(30);QCOMPARE(writes(),1);repo.saveProgress(second,7080000,7200000);QTRY_COMPARE(writes(),2);
    }
    void favoritesAppearFromScopedCacheBeforeLibraryNetwork() {
        FixtureServer server;server.favoriteRefs=QJsonArray{QJsonObject{{"source","personal"},{"sourceVersion","v1"},{"kind","movie"},{"id","1"}}};QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};
        {DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.favorites().size(),1);}
        server.delayedPaths.insert("/me/personal-library");DesktopRepository restored(options);restored.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(restored.favorites().size(),1);QTRY_VERIFY(!server.delayed.isEmpty());QCOMPARE(restored.favorites().first().toMap().value("scope").toString(),QString("account:v1"));
        server.version="v2";restored.refresh();QTRY_COMPARE(restored.scope(),QString("account:v2"));QVERIFY(restored.favorites().isEmpty());
    }

    void olderBootstrapCannotReplaceNewerSource() {
        FixtureServer server;server.delayedPaths.insert("/me/provider-session");QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(!server.delayed.isEmpty());
        server.version="v2";server.delayedPaths.clear();repo.refresh();QTRY_COMPARE(repo.scope(),QString("account:v2"));server.version="v1";server.respond(server.delayed.first(),"/me/provider-session");QTest::qWait(100);QCOMPARE(repo.scope(),QString("account:v2"));
    }

    void providerCredentialsAreEncodedAsQueryValues() {
        FixtureServer server;server.providerUser="fixture+user";server.providerPassword="fixture+secret%value";QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));QTRY_VERIFY(!repo.busy());QByteArray providerRequest;for(const auto&r:server.requests)if(r.startsWith("GET /player_api.php?")){providerRequest=r;break;}QVERIFY(providerRequest.contains("username=fixture%2Buser"));QVERIFY(providerRequest.contains("password=fixture%2Bsecret%25value"));
    }

    void oldLibraryForbiddenCannotRevokeReplacementSource() {
        FixtureServer server;server.delayedPaths.insert("/me/personal-library");QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));QTRY_VERIFY(!server.delayed.isEmpty());auto *old=server.delayed.first();
        server.version="v2";server.delayedPaths.clear();repo.refresh();QTRY_COMPARE(repo.scope(),QString("account:v2"));QTRY_VERIFY(!repo.busy());QSignalSpy revoked(&repo,&DesktopRepository::accessRevoked);
        if(old->state()==QAbstractSocket::ConnectedState)server.respondStatus(old,403);QTest::qWait(100);
        QCOMPARE(repo.scope(),QString("account:v2"));QVERIFY(repo.account().value("canPlay").toBool());QCOMPARE(revoked.size(),0);
    }
    void oldFavoriteUnauthorizedCannotRotateOrRetryUnderNewSource() {
        FixtureServer server;QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);QTRY_VERIFY(!repo.busy());
        server.delayedPaths.insert("/me/personal-library/favorites");repo.toggleFavorite(repo.items().first().toMap());QTRY_VERIFY(!server.delayed.isEmpty());auto *old=server.delayed.first();
        server.version="v2";server.delayedPaths.clear();repo.refresh();QTRY_COMPARE(repo.scope(),QString("account:v2"));QTRY_VERIFY(!repo.busy());if(old->state()==QAbstractSocket::ConnectedState)server.respondStatus(old,401);QTest::qWait(150);
        int writes=0,rotations=0;for(const auto &r:server.requests){if(r.startsWith("PUT /me/personal-library/favorites "))writes++;if(r.startsWith("POST /auth/refresh "))rotations++;}QCOMPARE(writes,1);QCOMPARE(rotations,0);QCOMPARE(repo.scope(),QString("account:v2"));QVERIFY(repo.favorites().isEmpty());
    }
    void currentSourceUnauthorizedStillRotatesAndRetries() {
        FixtureServer server;QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);QTRY_VERIFY(!repo.busy());
        server.delayedPaths.insert("/me/personal-library/favorites");repo.toggleFavorite(repo.items().first().toMap());QTRY_VERIFY(!server.delayed.isEmpty());auto *current=server.delayed.first();server.delayedPaths.clear();server.respondStatus(current,401);QTRY_COMPARE(repo.favorites().size(),1);
        int writes=0,rotations=0;for(const auto &r:server.requests){if(r.startsWith("PUT /me/personal-library/favorites "))writes++;if(r.startsWith("POST /auth/refresh "))rotations++;}QCOMPARE(writes,2);QCOMPARE(rotations,1);QCOMPARE(repo.scope(),QString("account:v1"));
    }

    void successfulAccountRotationSurvivesProviderSourceChange() {
        FixtureServer server;server.singleUseRefresh=true;QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);QTRY_VERIFY(!repo.busy());const auto oldItem=repo.items().first().toMap();
        server.version="v2";server.delayedPaths.insert("/me/provider-session");repo.refresh();QTRY_VERIFY(!server.delayed.isEmpty());auto *authorizedBootstrap=server.delayed.first();
        server.delayedPaths.insert("/me/personal-library/favorites");server.delayedPaths.insert("/auth/refresh");repo.toggleFavorite(oldItem);QTRY_COMPARE(server.delayed.size(),2);auto *write=server.delayed.last();server.delayedPaths.remove("/me/personal-library/favorites");server.respondStatus(write,401);QTRY_COMPARE(server.delayed.size(),3);auto *rotation=server.delayed.last();QCOMPARE(server.issuedRotations,1);QCOMPARE(server.currentAccess,QString("fixture-access-2"));
        server.delayedPaths.clear();server.respond(authorizedBootstrap,"/me/provider-session");QTRY_COMPARE_WITH_TIMEOUT(repo.scope(),QString("account:v2"),3000);if(rotation->state()==QAbstractSocket::ConnectedState)server.respond(rotation,"/auth/refresh");QTRY_COMPARE_WITH_TIMEOUT(repo.scope(),QString("account:v2"),3000);QTRY_VERIFY_WITH_TIMEOUT(!repo.busy(),3000);QVERIFY(repo.authenticated());
        repo.restore();QTRY_VERIFY_WITH_TIMEOUT(!repo.busy(),3000);QVERIFY(repo.authenticated());QCOMPARE(repo.scope(),QString("account:v2"));
        int writes=0;bool newBearer=false;for(const auto &r:server.requests){if(r.startsWith("PUT /me/personal-library/favorites "))writes++;if(r.startsWith("GET /me ")&&r.contains("Authorization: Bearer fixture-access-2"))newBearer=true;}QCOMPARE(writes,1);QCOMPARE(server.issuedRotations,1);QVERIFY(newBearer);
    }
    void currentAccountRotationForbiddenLogsOutAfterSourceChange() {
        FixtureServer server;QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);QTRY_VERIFY(!repo.busy());
        server.delayedPaths.insert("/me/personal-library/favorites");repo.toggleFavorite(repo.items().first().toMap());QTRY_VERIFY(!server.delayed.isEmpty());auto *write=server.delayed.first();server.delayedPaths.remove("/me/personal-library/favorites");server.delayedPaths.insert("/auth/refresh");server.respondStatus(write,401);QTRY_COMPARE(server.delayed.size(),2);auto *rotation=server.delayed.last();server.version="v2";server.delayedPaths.clear();repo.refresh();QTRY_COMPARE(repo.scope(),QString("account:v2"));QTRY_VERIFY(!repo.busy());if(rotation->state()==QAbstractSocket::ConnectedState)server.respondStatus(rotation,403);QTRY_VERIFY_WITH_TIMEOUT(!repo.authenticated(),3000);QVERIFY(repo.scope().isEmpty());
    }
    void latestSeriesSelectionMustWin() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","A"},{"category_id","1"}},QJsonObject{{"series_id","10"},{"name","B"},{"category_id","1"}}};
        server.actionOverrides["get_series_info"]=QJsonObject{{"episodes",QJsonObject{{"1",QJsonArray{QJsonObject{{"id","11"},{"season",1},{"episode_num",1},{"container_extension","mp4"}}}}}}};
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("series");QTRY_COMPARE(repo.items().size(),2);
        auto a=repo.items()[0].toMap(),b=repo.items()[1].toMap();server.delayedActions.insert("get_series_info");repo.showSeries(a);QTRY_VERIFY(!server.delayed.isEmpty());auto *old=server.delayed.first();server.delayedActions.clear();repo.showSeries(b);QTRY_COMPARE(repo.seriesDetail().value("series").toMap().value("id"),b.value("id"));server.respond(old,old->property("path").toString());QTest::qWait(100);QCOMPARE(repo.seriesDetail().value("series").toMap().value("id"),b.value("id"));
    }
    void obsoleteSeriesErrorCannotReplaceSelectedSeriesState() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","A"},{"category_id","1"}},QJsonObject{{"series_id","10"},{"name","B"},{"category_id","1"}}};server.actionOverrides["get_series_info"]=QJsonObject{{"episodes",QJsonObject{}}};
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("series");QTRY_COMPARE(repo.items().size(),2);auto a=repo.items()[0].toMap(),b=repo.items()[1].toMap();server.delayedActions.insert("get_series_info");repo.showSeries(a);QTRY_VERIFY(!server.delayed.isEmpty());auto *old=server.delayed.first();server.delayedActions.clear();repo.showSeries(b);QTRY_COMPARE(repo.seriesDetail().value("series").toMap().value("id"),b.value("id"));QVERIFY(repo.error().isEmpty());server.respondStatus(old,500);QTest::qWait(100);QVERIFY(repo.error().isEmpty());QCOMPARE(repo.seriesDetail().value("series").toMap().value("id"),b.value("id"));
    }
    void epgRebindsImmediatelyAndRejectsObsoleteDataAndErrors() {
        FixtureServer server;server.actionOverrides["get_live_streams"]=QJsonArray{QJsonObject{{"stream_id","31"},{"name","TR | Kanal A FHD"},{"category_id","1"}},QJsonObject{{"stream_id","32"},{"name","TR | Kanal B FHD"},{"category_id","1"}},QJsonObject{{"stream_id","33"},{"name","TR | Kanal C FHD"},{"category_id","1"}}};
        auto programme=[](const char *title){return QJsonObject{{"epg_listings",QJsonArray{QJsonObject{{"title",QString::fromLatin1(QByteArray(title).toBase64())},{"start_timestamp","1900000000"},{"stop_timestamp","1900003600"}}}}};};server.actionOverrides["get_short_epg"]=programme("Current A");
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("live");QTRY_COMPARE(repo.items().size(),3);auto a=repo.items()[0].toMap(),b=repo.items()[1].toMap(),c=repo.items()[2].toMap();repo.loadEpg(a);QTRY_COMPARE(repo.programmes().size(),1);
        server.delayedActions.insert("get_short_epg");repo.loadEpg(b);QVERIFY(repo.programmes().isEmpty());QTRY_VERIFY(!server.delayed.isEmpty());auto *old=server.delayed.first();server.delayedActions.clear();server.actionOverrides["get_short_epg"]=programme("Current C");repo.loadEpg(c);QTRY_COMPARE(repo.programmes().value(0).toMap().value("title").toString(),QString("Current C"));server.actionOverrides["get_short_epg"]=programme("Obsolete B");server.respond(old,old->property("path").toString());QTest::qWait(100);QCOMPARE(repo.programmes().value(0).toMap().value("title").toString(),QString("Current C"));
        server.delayedActions.insert("get_short_epg");repo.loadEpg(b);QTRY_COMPARE(server.delayed.size(),2);old=server.delayed.last();server.delayedActions.clear();server.actionOverrides["get_short_epg"]=programme("Selected A");repo.loadEpg(a);QTRY_COMPARE(repo.programmes().value(0).toMap().value("title").toString(),QString("Selected A"));server.respondStatus(old,500);QTest::qWait(100);QCOMPARE(repo.programmes().value(0).toMap().value("title").toString(),QString("Selected A"));
    }

    void refreshRevalidatesFreshSeriesDetails() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","A"},{"category_id","1"}}};auto info=[](int count){QJsonArray episodes;for(int i=1;i<=count;i++)episodes.append(QJsonObject{{"id",QString::number(10+i)},{"season",1},{"episode_num",i},{"container_extension","mp4"}});return QJsonObject{{"episodes",QJsonObject{{"1",episodes}}}};};server.actionOverrides["get_series_info"]=info(1);
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("series");QTRY_COMPARE(repo.items().size(),1);auto series=repo.items().first().toMap();repo.showSeries(series);QTRY_COMPARE(Catalog::episodes(repo.seriesDetail()).size(),1);
        server.actionOverrides["get_series_info"]=info(2);repo.refresh();QTRY_VERIFY(!repo.busy());repo.showSeries(series);QTRY_COMPARE_WITH_TIMEOUT(Catalog::episodes(repo.seriesDetail()).size(),2,3000);
    }
    void staleDiskSeriesDetailsAppearBeforeRevalidation() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","A"},{"category_id","1"}}};auto info=[](int count){QJsonArray episodes;for(int i=1;i<=count;i++)episodes.append(QJsonObject{{"id",QString::number(10+i)},{"season",1},{"episode_num",i},{"container_extension","mp4"}});return QJsonObject{{"episodes",QJsonObject{{"1",episodes}}}};};server.actionOverrides["get_series_info"]=info(1);
        QTemporaryDir dir;qint64 time=1900000000000LL;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[&] {return time;};
        {DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("series");QTRY_COMPARE(repo.items().size(),1);repo.showSeries(repo.items().first().toMap());QTRY_COMPARE(Catalog::episodes(repo.seriesDetail()).size(),1);}
        time+=6LL*3600000+1;server.actionOverrides["get_series_info"]=info(2);server.delayedActions.insert("get_series_info");DesktopRepository restored(options);restored.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(restored.scope(),QString("account:v1"));restored.navigate("series");QTRY_COMPARE(restored.items().size(),1);restored.showSeries(restored.items().first().toMap());QTRY_COMPARE(Catalog::episodes(restored.seriesDetail()).size(),1);QTRY_VERIFY_WITH_TIMEOUT(!server.delayed.isEmpty(),3000);auto *pending=server.delayed.first();server.delayedActions.clear();server.respond(pending,pending->property("path").toString());QTRY_COMPARE(Catalog::episodes(restored.seriesDetail()).size(),2);
    }

    void largeFavoriteCatalogDoesNotBlockMainThread() {
        FixtureServer server;QJsonArray rows;for(int i=1;i<=50000;i++)rows.append(QJsonObject{{"stream_id",QString::number(i)},{"name",QString("Film %1 (2026)").arg(i)},{"category_id","1"},{"container_extension","mp4"}});
        server.movieCount=0;server.rawOverrides["/player_api.php?username=fixture-user&password=fixture-secret&action=get_vod_streams"]=QJsonDocument(rows).toJson(QJsonDocument::Compact);
        for(int i=49501;i<=50000;i++)server.favoriteRefs.append(QJsonObject{{"source","personal"},{"sourceVersion","v1"},{"kind","movie"},{"id",QString::number(i)}});
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);
        QElapsedTimer clock;clock.start();qint64 previous=0,longest=0;QTimer heartbeat;heartbeat.setInterval(10);connect(&heartbeat,&QTimer::timeout,&repo,[&]{const auto current=clock.elapsed();longest=qMax(longest,current-previous);previous=current;});heartbeat.start();repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE_WITH_TIMEOUT(repo.favorites().size(),500,60000);QTest::qWait(30);qInfo()<<"mainThreadLongestGapMs"<<longest<<"totalMs"<<clock.elapsed();
#ifdef QT_NO_DEBUG
        QVERIFY2(longest<250,"Main event loop stalled at least250ms resolving legal50k catalog/500favorites");
#else
        QVERIFY2(longest<500,"Debug main event loop stalled at least500ms resolving legal50k catalog/500favorites");
#endif
    }

    void reopenedStaleSeriesStillReceivesRevalidation() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","A"},{"category_id","1"}}};auto info=[](int count){QJsonArray episodes;for(int i=1;i<=count;i++)episodes.append(QJsonObject{{"id",QString::number(10+i)},{"season",1},{"episode_num",i},{"container_extension","mp4"}});return QJsonObject{{"episodes",QJsonObject{{"1",episodes}}}};};server.actionOverrides["get_series_info"]=info(1);
        QTemporaryDir dir;qint64 time=1900000000000LL;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[&] {return time;};
        {DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("series");QTRY_COMPARE(repo.items().size(),1);repo.showSeries(repo.items().first().toMap());QTRY_COMPARE(Catalog::episodes(repo.seriesDetail()).size(),1);}
        time+=6LL*3600000+1;server.actionOverrides["get_series_info"]=info(2);server.delayedActions.insert("get_series_info");DesktopRepository restored(options);restored.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(restored.scope(),QString("account:v1"));restored.navigate("series");QTRY_COMPARE(restored.items().size(),1);const auto same=restored.items().first().toMap();restored.showSeries(same);QTRY_COMPARE(Catalog::episodes(restored.seriesDetail()).size(),1);QTRY_VERIFY(!server.delayed.isEmpty());restored.showSeries(same);QCOMPARE(Catalog::episodes(restored.seriesDetail()).size(),1);auto *pending=server.delayed.first();server.delayedActions.clear();server.respond(pending,pending->property("path").toString());QTRY_COMPARE_WITH_TIMEOUT(Catalog::episodes(restored.seriesDetail()).size(),2,3000);QCOMPARE(server.delayed.size(),1);
    }
    void staleSeriesPlaybackDoesNotEmitAgainAfterRevalidation() {
        FixtureServer server;server.actionOverrides["get_series"]=QJsonArray{QJsonObject{{"series_id","9"},{"name","A"},{"category_id","1"}}};auto info=[](int count){QJsonArray episodes;for(int i=1;i<=count;i++)episodes.append(QJsonObject{{"id",QString::number(10+i)},{"season",1},{"episode_num",i},{"container_extension","mp4"}});return QJsonObject{{"episodes",QJsonObject{{"1",episodes}}}};};server.actionOverrides["get_series_info"]=info(1);QTemporaryDir dir;qint64 time=1900000000000LL;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[&] {return time;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("series");QTRY_COMPARE(repo.items().size(),1);const auto series=repo.items().first().toMap();repo.showSeries(series);QTRY_COMPARE(Catalog::episodes(repo.seriesDetail()).size(),1);
        time+=6LL*3600000+1;server.actionOverrides["get_series_info"]=info(2);server.delayedActions.insert("get_series_info");QSignalSpy ready(&repo,&DesktopRepository::playbackReady);repo.playItem(series);QTRY_COMPARE(ready.size(),1);QTRY_VERIFY(!server.delayed.isEmpty());auto *pending=server.delayed.first();server.delayedActions.clear();server.respond(pending,pending->property("path").toString());QTest::qWait(100);QCOMPARE(ready.size(),1);QCOMPARE(ready.first().first().toMap().value("item").toMap().value("id").toString(),QString("11"));
    }

    void lateUnauthorizedForOldAccessReusesAlreadyRotatedToken() {
        FixtureServer server;server.singleUseRefresh=true;QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_COMPARE(repo.scope(),QString("account:v1"));repo.navigate("movies");QTRY_COMPARE(repo.items().size(),1);QTRY_VERIFY(!repo.busy());
        server.delayedPaths.insert("/me/personal-library/favorites");server.delayedPaths.insert("/auth/refresh");repo.toggleFavorite(repo.items().first().toMap());QTRY_COMPARE(server.delayed.size(),1);auto *write=server.delayed.first();server.delayedPaths.remove("/me/personal-library/favorites");server.respondStatus(write,401);QTRY_COMPARE(server.delayed.size(),2);auto *rotation=server.delayed.last();QCOMPARE(server.issuedRotations,1);
        server.delayedUnauthorizedPaths.insert("/me");repo.refresh();QTRY_COMPARE(server.delayed.size(),3);auto *late=server.delayed.last();QCOMPARE(late->property("rejectedToken").toByteArray(),QByteArray("Bearer fixture-access"));server.delayedPaths.clear();server.respond(rotation,"/auth/refresh");QTRY_COMPARE(repo.favorites().size(),1);QCOMPARE(server.currentAccess,QString("fixture-access-2"));
        server.delayedUnauthorizedPaths.clear();server.respondStatus(late,401);QTRY_VERIFY(!repo.busy());QVERIFY(repo.authenticated());QCOMPARE(repo.scope(),QString("account:v1"));QCOMPARE(server.issuedRotations,1);bool currentBearer=false;for(const auto &r:server.requests)if(r.startsWith("GET /me ")&&r.contains("Authorization: Bearer fixture-access-2"))currentBearer=true;QVERIFY(currentBearer);
    }

};
QTEST_GUILESS_MAIN(RepositoryTest)
#include "repository_test.moc"
