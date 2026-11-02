#include <QtTest>
#include <QTemporaryDir>
#include <QTcpServer>
#include <QTcpSocket>
#include <QJsonDocument>
#include <QJsonArray>
#if __has_include("analytics.h")
#include "analytics.h"
#define HAS_ANALYTICS 1
#endif
#if __has_include("playback_analytics.h")
#include "playback_analytics.h"
#define HAS_PLAYBACK_ANALYTICS 1
#endif

#ifdef HAS_ANALYTICS
class AnalyticsFixture : public QTcpServer {
public:
    QList<QByteArray> requests;
    QList<QPair<QPointer<QTcpSocket>,QByteArray>> held;
    int respondedEvents=0;
    bool enabled = true, hold = false;
    AnalyticsFixture() {
        listen(QHostAddress::LocalHost);
        connect(this, &QTcpServer::newConnection, this, [this] {
            while (hasPendingConnections()) {
                auto *socket = nextPendingConnection();
                connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
                connect(socket, &QTcpSocket::readyRead, socket, [this, socket] {
                    auto data = socket->property("data").toByteArray() + socket->readAll();
                    socket->setProperty("data", data);
                    const int split = data.indexOf("\r\n\r\n");
                    if (split < 0 || socket->property("handled").toBool()) return;
                    int length = 0;
                    for (const auto &line : data.left(split).split('\n'))
                        if (line.toLower().startsWith("content-length:")) length = line.mid(15).trimmed().toInt();
                    if (data.size() < split + 4 + length) return;
                    socket->setProperty("handled", true); requests.append(data);
                    const bool config = data.startsWith("GET /analytics/config ");
                    if (!config && hold) {held.append({socket,data});return;}
                    respond(socket,data);
                });
            }
        });
    }
    QUrl base() const { return QUrl(QString("http://127.0.0.1:%1").arg(serverPort())); }
    int events() const { int count = 0; for (const auto &r : requests) count += r.startsWith("POST /me/analytics/events "); return count; }
    void respond(QTcpSocket *socket,const QByteArray &data){
        if(!socket||socket->state()==QAbstractSocket::UnconnectedState)return;
        const bool config=data.startsWith("GET /analytics/config ");const int split=data.indexOf("\r\n\r\n");
        const QByteArray body=config?QJsonDocument(QJsonObject{{"schema",1},{"consentVersion",1},{"windows",QJsonObject{{"enabled",enabled},{"measurementId","G-ABC1234567"}}}}).toJson(QJsonDocument::Compact):QJsonDocument(QJsonObject{{"accepted",QJsonDocument::fromJson(data.mid(split+4)).object().value("events").toArray().size()}}).toJson(QJsonDocument::Compact);
        socket->write(QByteArray(config?"HTTP/1.1 200 OK":"HTTP/1.1 202 Accepted")+"\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: "+QByteArray::number(body.size())+"\r\n\r\n"+body);socket->disconnectFromHost();
        if(data.startsWith("POST /me/analytics/events "))respondedEvents++;
    }
    void releaseHeld(int count=100){while(count--&& !held.isEmpty()){const auto entry=held.takeFirst();respond(entry.first,entry.second);}}
};
#endif

class AnalyticsTest : public QObject {
    Q_OBJECT
private slots:
#ifndef HAS_PLAYBACK_ANALYTICS
    void confirmedPlaybackLifecycleExists() { QFAIL("First-frame playback analytics lifecycle is missing"); }
#else
    void publicLabelsAreReadableButNeverAcceptPrivateLookingText() {
        QVERIFY(DesktopAnalytics::safeEvent("select_content", {{"content_name", "Açık Deniz (2026)"}}));
        for (const auto &label : QStringList{"https://provider/secret", "person@example.com", "username=private", "ABCDEFGHIJKLMNOP", "Name%2Fsecret", "https:private", "mailto:private", "data:private", "file:private", "javascript:private","ftp:private","session_id=private-value",QStringLiteral("line\u2028split"),QStringLiteral("paragraph\u2029split")})
            QVERIFY(!DesktopAnalytics::safeEvent("select_content", {{"content_name", label}}));
    }
    void preflightIsPartOfStartupAndExistingFramesCannotAdmitAnAttempt() {
        qint64 now=1000;QList<QPair<QString,QVariantMap>> events;PlaybackAnalytics tracker([&](QString n,QVariantMap p){events.append({n,p});},[&]{return now;});tracker.setEnabled(true);
        tracker.request({{"kind","series"},{"id","9"}},now,true);now=6000;tracker.observe({true,true,true,false,false,4000,100000,true,false,false});
        QCOMPARE(events.size(),1);QCOMPARE(events.first().first,QString("playback_request"));
        tracker.admit({{"kind","episode"},{"id","42"}});tracker.observe({true,true,true,false,false,100,100000,true,false,false});
        QCOMPARE(events.last().first,QString("video_start"));QCOMPARE(events.last().second["startup_ms"].toLongLong(),5000);QCOMPARE(events.last().second["content_type"].toString(),QString("episode"));
    }
    void preflightFailureAndConsentTurnoverNeverInventAStart() {
        QStringList events;PlaybackAnalytics tracker([&](QString n,QVariantMap){events.append(n);},[]{return 1000;});tracker.setEnabled(true);tracker.request({{"kind","movie"},{"id","1"}},1000,true);tracker.preflightFailed("network");
        QCOMPARE(events,QStringList({"playback_request","playback_error","playback_end"}));events.clear();tracker.request({{"kind","movie"},{"id","1"}},1000,true);tracker.setEnabled(false);tracker.setEnabled(true);tracker.admit({{"kind","movie"},{"id","1"}});tracker.observe({true,true,true,false,false,100,100000,true,false,false});QCOMPARE(events,QStringList({"playback_request"}));
    }
    void firstFrameAndRealEndAreCountedOnce() {
        qint64 now = 1000; QList<QPair<QString, QVariantMap>> events;
        PlaybackAnalytics tracker([&](QString name, QVariantMap params) { events.append({name, params}); }, [&] { return now; });
        tracker.setEnabled(true);
        tracker.request({{"kind", "movie"}, {"id", "42"}});
        tracker.observe({true, false, false, true, false, 0, 100000,true,false,false});
        now = 2500; tracker.observe({true, true, true, false, false, 0, 100000,true,false,false});
        now = 3500; tracker.observe({true, true, true, false, false, 30000, 100000,true,false,false});
        tracker.observe({true, true, true, false, false, 30000, 100000,true,false,false});
        now = 4000; tracker.complete(); tracker.complete(); tracker.finish("user");
        int starts = 0, progress = 0, complete = 0, ends = 0;
        for (const auto &e : events) {
            QVERIFY(DesktopAnalytics::safeEvent(e.first, e.second));
            if (e.first == "video_start") { ++starts; QCOMPARE(e.second.value("startup_ms").toLongLong(), 1500); }
            progress += e.first == "video_progress"; complete += e.first == "video_complete"; ends += e.first == "playback_end";
        }
        QCOMPARE(starts, 1); QCOMPARE(progress, 1); QCOMPARE(complete, 1); QCOMPARE(ends, 1);
    }
    void failedStartupNeverStartsAndBufferingDoesNotCountAsWatchTime() {
        qint64 now = 0; QList<QPair<QString, QVariantMap>> events;
        PlaybackAnalytics tracker([&](QString name, QVariantMap params) { events.append({name, params}); }, [&] { return now; });
        tracker.setEnabled(true);
        tracker.request({{"kind", "live"}, {"id", "42"}});
        now = 500; tracker.observe({true, false, false, true, true, 0, 0,true,false,false}); tracker.finish("error");
        for (const auto &e : events) QVERIFY(e.first != "video_start");
        events.clear(); tracker.request({{"kind", "live"}, {"id", "42"}});
        now = 1000; tracker.observe({true, true, true, false, false, 0, 0,true,false,false});
        now = 2000; tracker.observe({true, true, false, true, false, 0, 0,true,false,true});
        now = 9000; tracker.observe({true, true, true, false, false, 0, 0,true,false,false});
        now = 10000; tracker.finish("user");
        int buffers = 0;
        for (const auto &e : events) {
            if (e.first == "playback_buffer") { ++buffers; QCOMPARE(e.second.value("buffer_ms").toLongLong(), 7000); }
            if (e.first == "playback_end") QCOMPARE(e.second.value("watch_ms").toLongLong(), 2000);
        }
        QCOMPARE(buffers, 1);
    }
    void revokedConsentDiscardsLateFrameAndPreviouslyAccumulatedWatchTime() {
        qint64 now = 0; QStringList events;
        PlaybackAnalytics tracker([&](QString name, QVariantMap) { events.append(name); }, [&] { return now; });
        tracker.request({{"kind", "movie"}, {"id", "42"}}); tracker.observe({true, true, true, false, false, 0, 100000,true,false,false});
        QVERIFY(events.isEmpty()); tracker.setEnabled(true);
        tracker.request({{"kind", "movie"}, {"id", "42"}}); now = 1000; tracker.observe({true, true, true, false, false, 0, 100000,true,false,false});
        QCOMPARE(events.count("video_start"), 1); tracker.setEnabled(false);
        const auto recorded = events; now = 50000; tracker.observe({true, true, true, false, false, 99999, 100000,true,false,false}); tracker.complete();
        tracker.setEnabled(true); tracker.observe({true, true, true, false, false, 99999, 100000,true,false,false}); tracker.complete();
        QCOMPARE(events, recorded);
    }
#endif
#ifndef HAS_ANALYTICS
    void consentAndPrivacyCollectorExists() { QFAIL("Windows analytics consent and privacy collector is missing"); }
#else
    void rejectsSensitiveOrUnrecognizedParameters() {
        QVERIFY(DesktopAnalytics::safeEvent("login", {{"method", "code"}}));
        QVERIFY(!DesktopAnalytics::safeEvent("login", {{"account_code", "ABCDEFGHIJKLMNOP"}}));
        QVERIFY(!DesktopAnalytics::safeEvent("playback_error", {{"reason", "https://provider/secret"}}));
        QVERIFY(!DesktopAnalytics::safeEvent("select_content", {{"content_id", "ABCDEFGHIJKLMNOP"}}));
        QVERIFY(!DesktopAnalytics::safeEvent("purchase", {}));
        QVERIFY(!DesktopAnalytics::safeEvent("video_start", {{"startup_ms", -1}}));
        QVERIFY(!DesktopAnalytics::safeEvent("search", {{"query_length", 1.5}}));
        QCOMPARE(DesktopAnalytics::contentReference({{"kind", "MOVIE"}, {"id", "42"}}), QString("24feea760702d90280bfb851"));
    }
    void hashesOnlyVerifiedVodOrLiveCategoryIdentifiers() {
        QVERIFY(!DesktopAnalytics::categoryReference("42").isEmpty());
        for(const auto &id:QStringList{"national","news","sports","kids","documentary","music","local","themed","radio"})
            QVERIFY2(!DesktopAnalytics::categoryReference(id).isEmpty(),qPrintable(id));
        for(const auto &id:QStringList{"ABCDEFGHIJKLMNOP","https://fixture.invalid/private","user=private","arbitrary-private-label"})
            QVERIFY(DesktopAnalytics::categoryReference(id).isEmpty());
    }
    void delayedQueuePreservesEachOriginalAnalyticsSession() {
        AnalyticsFixture server; QTemporaryDir dir; qint64 now=1700000000000LL;
        DesktopAnalytics analytics({server.base(),dir.filePath("prefs.ini"),true,[&]{return now;}});
        analytics.reloadConfiguration();QTRY_VERIFY(analytics.available());analytics.setSession("fixture-access","fixture-account");analytics.setConsent(true);
        analytics.record("search",{{"query_length",4}});now+=31*60*1000;analytics.record("search",{{"query_length",5}});
        analytics.flush();QTRY_COMPARE(server.events(),1);QTRY_COMPARE(analytics.pendingCount(),1);
        QList<QJsonObject> sent;
        auto collect=[&]{sent.clear();for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events "))sent.append(QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object());};
        collect();QCOMPARE(sent.first().value("sessionId").toInteger(),1700000000LL);QCOMPARE(sent.first().value("events").toArray().size(),1);
        analytics.flush();QTRY_COMPARE(server.events(),2);QTRY_COMPARE(analytics.pendingCount(),0);collect();
        QCOMPARE(sent.last().value("sessionId").toInteger(),1700001860LL);QCOMPARE(sent.last().value("events").toArray().size(),1);
        QCOMPARE(sent.first().value("events").toArray().first().toObject().keys().size(),4);
    }
    void finalLogoutPreservesRecentEventsAndCannotClearNewAccountQueue() {
        AnalyticsFixture server;server.hold=true;QTemporaryDir dir;
        DesktopAnalytics analytics({server.base(),dir.filePath("prefs.ini"),true});analytics.reloadConfiguration();QTRY_VERIFY(analytics.available());analytics.setSession("fixture-A","account-A");analytics.setConsent(true);
        const auto previous=analytics.clientId();for(int i=0;i<25;i++)analytics.record("search",{{"query_length",i}});
        analytics.recordLogoutAndDetach();QVERIFY(analytics.clientId().isEmpty());QCOMPARE(analytics.pendingCount(),0);analytics.setSession({},{});QTRY_COMPARE(server.events(),1);
        analytics.setSession("fixture-B","account-B");QVERIFY(analytics.clientId()!=previous);analytics.record("login",{{"method","code"}});analytics.flush();QTRY_COMPARE(server.events(),2);
        QList<QJsonObject> batches;for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/events "))batches.append(QJsonDocument::fromJson(request.mid(request.indexOf("\r\n\r\n")+4)).object());
        QCOMPARE(batches.first().value("clientId").toString(),previous);const auto events=batches.first().value("events").toArray();QCOMPARE(events.size(),20);QCOMPARE(events.first().toObject().value("params").toObject().value("query_length").toInt(),6);QCOMPARE(events.last().toObject().value("name").toString(),QString("logout"));
        server.releaseHeld(1);QTRY_COMPARE(server.respondedEvents,1);QTest::qWait(20);QCOMPARE(analytics.pendingCount(),1);
        server.releaseHeld();QTRY_COMPARE(analytics.pendingCount(),0);
        for(const auto &request:server.requests)QVERIFY(!request.startsWith("POST /me/analytics/consent "));
    }
    void withdrawalRevokesFinalClientUsingItsOriginalAccountSnapshot() {
        AnalyticsFixture server;server.hold=true;QTemporaryDir dir;DesktopAnalytics analytics({server.base(),dir.filePath("prefs.ini"),true});
        analytics.reloadConfiguration();QTRY_VERIFY(analytics.available());analytics.setSession("fixture-A","account-A");analytics.setConsent(true);const auto oldClient=analytics.clientId();
        analytics.recordLogoutAndDetach();QTRY_COMPARE(server.events(),1);analytics.setSession("fixture-B","account-B");analytics.setConsent(false);
        auto originalRevoked=[&]{for(const auto &request:server.requests)if(request.startsWith("POST /me/analytics/consent ")&&request.contains("Bearer fixture-A")&&request.contains(oldClient.toUtf8()))return true;return false;};
        QTRY_VERIFY(originalRevoked());QCOMPARE(analytics.pendingCount(),0);QVERIFY(analytics.clientId().isEmpty());server.releaseHeld();
    }
    void noCollectionBeforeConsentAndRejectedChoicePersists() {
        AnalyticsFixture server; QTemporaryDir dir;
        DesktopAnalytics analytics({server.base(), dir.filePath("prefs.ini"), true});
        analytics.setSession("fixture-access", "fixture-account");
        analytics.reloadConfiguration(); QTRY_VERIFY(analytics.available());
        analytics.record("login", {{"method", "code"}}); analytics.flush();
        QCOMPARE(analytics.pendingCount(), 0); QCOMPARE(server.events(), 0);
        analytics.setConsent(false); QVERIFY(!analytics.promptVisible());
        DesktopAnalytics restored({server.base(), dir.filePath("prefs.ini"), true});
        QCOMPARE(restored.choice(), QString("rejected"));
    }
    void consentedBatchHasNoAuthOrAccountDataInsidePayload() {
        AnalyticsFixture server; QTemporaryDir dir;
        DesktopAnalytics analytics({server.base(), dir.filePath("prefs.ini"), true});
        analytics.setSession("fixture-access", "fixture-account");
        analytics.reloadConfiguration(); QTRY_VERIFY(analytics.available());
        analytics.setConsent(true); analytics.record("login", {{"method", "code"}}); analytics.flush();
        QTRY_COMPARE(server.events(), 1);
        QTRY_COMPARE(analytics.pendingCount(), 0);
        for (const auto &request : server.requests) if (request.startsWith("POST /me/analytics/events ")) {
            const auto payload = request.mid(request.indexOf("\r\n\r\n") + 4);
            QVERIFY(!payload.contains("fixture-access")); QVERIFY(!payload.contains("fixture-account"));
            const auto object = QJsonDocument::fromJson(payload).object();
            QCOMPARE(object.value("schema").toInt(), 1); QCOMPARE(object.value("clientPlatform").toString(), QString("windows"));
            QCOMPARE(object.value("events").toArray().first().toObject().value("name").toString(), QString("login"));
        }
    }
    void withdrawalClearsQueueAndRotatesIndependentIdentity() {
        AnalyticsFixture server; QTemporaryDir dir;
        DesktopAnalytics analytics({server.base(), dir.filePath("prefs.ini"), true});
        analytics.reloadConfiguration(); QTRY_VERIFY(analytics.available());
        analytics.setConsent(true); const auto previous = analytics.clientId();
        analytics.record("search", {{"query_length", 8}, {"result_count", 2}});
        QVERIFY(analytics.pendingCount() > 0); analytics.setConsent(false);
        QCOMPARE(analytics.pendingCount(), 0); QVERIFY(analytics.clientId().isEmpty());
        analytics.record("login"); QCOMPARE(analytics.pendingCount(), 0);
        analytics.setConsent(true); QVERIFY(!analytics.clientId().isEmpty()); QVERIFY(analytics.clientId() != previous);
    }
    void queueIsBoundedAndNetworkCannotFreezeGui() {
        AnalyticsFixture server; server.hold = true; QTemporaryDir dir;
        DesktopAnalytics analytics({server.base(), dir.filePath("prefs.ini"), true});
        analytics.reloadConfiguration(); QTRY_VERIFY(analytics.available()); analytics.setConsent(true);
        for (int i = 0; i < 10000; ++i) analytics.record("search", {{"query_length", 4}});
        QVERIFY(analytics.pendingCount() <= 100);
        analytics.setSession("fixture-access", "fixture-account"); analytics.flush();
        bool heartbeat = false; QTimer::singleShot(0, &analytics, [&] { heartbeat = true; }); QTRY_VERIFY(heartbeat);
        analytics.setConsent(false); QCOMPARE(analytics.pendingCount(), 0);
    }
    void absentConfigurationStaysDisabled() {
        AnalyticsFixture server; server.enabled = false; QTemporaryDir dir;
        DesktopAnalytics analytics({server.base(), dir.filePath("prefs.ini"), true});
        analytics.reloadConfiguration(); QTRY_VERIFY(!server.requests.isEmpty()); QTest::qWait(20);
        QVERIFY(!analytics.available()); analytics.setConsent(true); analytics.record("login");
        QCOMPARE(analytics.pendingCount(), 0); QCOMPARE(server.events(), 0);
    }
#endif
};
QTEST_GUILESS_MAIN(AnalyticsTest)
#include "analytics_test.moc"
