#include <QtTest>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QJsonDocument>
#include <QSignalSpy>
#include <QTimeZone>
#include <QUrlQuery>
#include "catalog.h"
#include "repository.h"
class FixtureServer : public QTcpServer {
public:
    QList<QByteArray> requests;
    qint64 expiry=2000000000000;
    QString version="v1";
    QString providerUser="fixture-user",providerPassword="fixture-secret";
    QSet<QString> delayedPaths;
    QSet<QString> delayedActions;
    int movieCount=1;
    QJsonArray favoriteRefs;
    QHash<QString,QJsonValue> overrides;
    QHash<QString,QByteArray> rawOverrides;
    QHash<QString,QJsonValue> actionOverrides;
    QList<QTcpSocket *> delayed;
    FixtureServer() { listen(QHostAddress::LocalHost);connect(this,&QTcpServer::newConnection,this,[this]{while(hasPendingConnections()){auto s=nextPendingConnection();connect(s,&QTcpSocket::readyRead,s,[this,s]{auto data=s->property("data").toByteArray()+s->readAll();s->setProperty("data",data);int split=data.indexOf("\r\n\r\n");if(split<0)return;int length=0;for(auto h:data.left(split).split('\n'))if(h.toLower().startsWith("content-length:"))length=h.mid(15).trimmed().toInt();if(data.size()<split+4+length)return;s->disconnect(SIGNAL(readyRead()));requests.append(data);auto path=QString::fromLatin1(data.split(' ').value(1));s->setProperty("path",path);bool delay=delayedPaths.contains(path);for(const auto &action:delayedActions)if(path.contains(action))delay=true;if(delay){delayed.append(s);return;}respond(s,path);});}}); }
    QUrl base() const {return QUrl(QString("http://127.0.0.1:%1").arg(serverPort()));}
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
        auto action=QUrlQuery(QUrl("http://fixture"+path)).queryItemValue("action");if(actionOverrides.contains(action))body=actionOverrides.value(action);
        if(overrides.contains(path))body=overrides.value(path);
        QByteArray bytes=body.isArray()?QJsonDocument(body.toArray()).toJson(QJsonDocument::Compact):QJsonDocument(body.toObject()).toJson(QJsonDocument::Compact);
        if(rawOverrides.contains(path))bytes=rawOverrides[path];
        s->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+QByteArray::number(bytes.size())+"\r\n\r\n"+bytes);s->disconnectFromHost();
    }
};
class RepositoryTest : public QObject {
    Q_OBJECT
private slots:
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
        QTemporaryDir dir;RepositoryOptions options;options.apiBase=server.base();options.storageDirectory=dir.path();options.allowLoopbackForTests=true;options.now=[] {return 1900000000000LL;};DesktopRepository repo(options);repo.login("ABCDEFGHIJKLMNOP");QTRY_VERIFY(repo.account().value("canPlay").toBool());repo.navigate("series");QTRY_COMPARE(repo.items().size(),1);repo.showSeries(repo.items().first().toMap());QTRY_VERIFY(!repo.seriesDetail().isEmpty());auto episodes=Catalog::episodes(repo.seriesDetail());QCOMPARE(episodes.size(),3);auto first=episodes[0].toMap(),second=episodes[1].toMap();
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

};
QTEST_GUILESS_MAIN(RepositoryTest)
#include "repository_test.moc"
