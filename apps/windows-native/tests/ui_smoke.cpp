#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlNetworkAccessManagerFactory>
#include <QQuickWindow>
#include <QQuickItem>
#include <QScreen>
#include <QTcpServer>
#include <QTcpSocket>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QTemporaryDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QUrlQuery>
#include <QFile>
#include <QDir>
#include <QElapsedTimer>
#include <QTimer>
#include <QTest>
#include <QDateTime>
#include <QFileInfo>
#include <QSysInfo>
#include <QSet>
#include <QStyleHints>
#include <QSignalSpy>
#include <cstring>
#include <cstdlib>
#include <functional>
#include "repository.h"
#include "player.h"
#include "app_bridge.h"

namespace {
QStringList qmlErrors;
void logMessage(QtMsgType type, const QMessageLogContext &, const QString &message) {
    if (message.contains("qrc:/qml/") || message.contains("QQmlApplicationEngine failed")) qmlErrors.append(message);
    fprintf(stderr, "%s\n", qPrintable(message));
    if (type == QtFatalMsg) abort();
}
bool until(const std::function<bool()> &condition, int timeout = 15000) {
    QElapsedTimer clock; clock.start();
    while (!condition() && clock.elapsed() < timeout) QTest::qWait(20);
    return condition();
}

class ArtworkReply final : public QNetworkReply {
    QByteArray data_;
    qint64 offset_ = 0;
public:
    ArtworkReply(const QNetworkRequest &request, QString path, QObject *parent) : QNetworkReply(parent) {
        setRequest(request); setUrl(request.url()); setOperation(QNetworkAccessManager::GetOperation);
        QFile file(path);
        if (!path.isEmpty() && file.open(QIODevice::ReadOnly)) data_ = file.readAll();
        setHeader(QNetworkRequest::ContentTypeHeader, "image/jpeg");
        setHeader(QNetworkRequest::ContentLengthHeader, data_.size());
        if (data_.isEmpty()) setError(QNetworkReply::ContentNotFoundError, "Fixture artwork unavailable");
        open(QIODevice::ReadOnly | QIODevice::Unbuffered);
        QTimer::singleShot(0, this, [this] { setFinished(true); emit metaDataChanged(); if (!data_.isEmpty()) emit readyRead(); emit finished(); });
    }
    void abort() override {}
    qint64 bytesAvailable() const override { return data_.size() - offset_ + QNetworkReply::bytesAvailable(); }
protected:
    qint64 readData(char *destination, qint64 maximum) override {
        const auto count = qMin(maximum, qint64(data_.size()) - offset_);
        if (count <= 0) return -1;
        memcpy(destination, data_.constData() + offset_, size_t(count)); offset_ += count; return count;
    }
};
class ArtworkManager final : public QNetworkAccessManager {
    QString directory_;
public:
    ArtworkManager(QString directory, QObject *parent) : QNetworkAccessManager(parent), directory_(std::move(directory)) {}
protected:
    QNetworkReply *createRequest(Operation operation, const QNetworkRequest &request, QIODevice *body) override {
        const auto url = request.url();
        if (url.scheme() == "qrc" || url.scheme() == "file") return QNetworkAccessManager::createRequest(operation, request, body);
        static const QSet<QString> names{"movie-0.jpg","movie-1.jpg","movie-2.jpg","series.jpg","series-boroughs.jpg","series-mahsun.jpg"};
        const auto name = QFileInfo(url.path()).fileName();
        return new ArtworkReply(request, url.host() == "fixture.invalid" && names.contains(name) ? QDir(directory_).filePath(name) : QString(), this);
    }
};
class ArtworkFactory final : public QQmlNetworkAccessManagerFactory {
    QString directory_;
public:
    explicit ArtworkFactory(QString directory) : directory_(std::move(directory)) {}
    QNetworkAccessManager *create(QObject *parent) override { return new ArtworkManager(directory_, parent); }
};

class FixtureServer final : public QTcpServer {
    bool welcomePending_ = true;
    QJsonObject welcome() const {
        QJsonArray offers;
        for(int users: {1,2})offers.append(QJsonObject{{"id","welcome-monthly-50-v1"},{"users",users},{"currency","try"},{"durationMonths",1},{"amountMinor",users==1?12500:19950},{"regularAmountMinor",users==1?25000:39900},{"packageSlug",users==1?"1-ay":"1-ay-2-kullanici"}});
        return {{"campaign","welcome-monthly-50-v1"},{"eligible",true},{"state",welcomePending_?"pending":"dismissed"},{"offers",offers},{"catalogue",QJsonObject{{"movies",60},{"live",12},{"series",3}}}};
    }
    void respond(QTcpSocket *socket, const QByteArray &request) {
        const auto target = QString::fromLatin1(request.split(' ').value(1));
        const auto url = QUrl("http://fixture.invalid" + target);
        paths.insert(url.path());
        QJsonValue value;
        const auto expiryText = QDateTime::fromMSecsSinceEpoch(expiry, Qt::UTC).toString(Qt::ISODateWithMs);
        if (url.path() == "/auth/login-by-code" || url.path() == "/auth/refresh") value = QJsonObject{{"accessToken","fixture-access"},{"refreshToken","fixture-refresh"},{"user",QJsonObject{{"id","fixture-account"},{"codeSuffix","TEST"}}}};
        else if (url.path() == "/me") { ++accountRequests;value = QJsonObject{{"user",QJsonObject{{"id","fixture-account"},{"codeSuffix","TEST"},{"status","active"},{"hasAssignedLink",accessActive},{"hasActiveSubscription",accessActive},{"activePackage",QJsonObject{{"title","Yerel doğrulama paketi"},{"endsAt",expiryText}}}}}}; }
        else if (url.path() == "/me/provider-session") value = QJsonObject{{"accountId","fixture-account"},{"sourceVersion","fixture-v1"},{"providerOrigin",base().toString()},{"username","fixture-user"},{"password","fixture-secret"},{"expiresAt",expiryText},{"moviePolicy","general-audience-only"}};
        else if (url.path() == "/me/welcome-offer") value = welcome();
        else if (url.path() == "/me/welcome-offer/choice") { welcomePending_=false;value=welcome(); }
        else if (url.path() == "/me/personal-library") value = QJsonObject{{"favorites",QJsonArray{}},{"watched",QJsonArray{}}};
        else if (url.path().startsWith("/me/personal-library/")) value = QJsonObject{{"ok",true}};
        else if (url.path() == "/player_api.php") {
            const auto action = QUrlQuery(url).queryItemValue("action");
            actions.insert(action);
            if (action.endsWith("categories")) value = QJsonArray{QJsonObject{{"category_id","1"},{"category_name","TR | Aksiyon (Yabancı)"}},QJsonObject{{"category_id","2"},{"category_name","TR | Fantastik (Yabancı)"}}};
            else if (action == "get_vod_streams") {
                QJsonArray movies;
                const QStringList titles{"Fısıltı Adam (2026)","Telaşlı Baba (2026)","Örümcek-Adam: Yepyeni Bir Gün (2026)","Avengers: Endgame (2019)","Harry Potter ve Felsefe Taşı (2001)","Iron Man (2008)"};
                for (int index=0; index<60; ++index) movies.append(QJsonObject{{"stream_id",100+index},{"name",index<titles.size()?titles[index]:QString("Arşiv doğrulaması %1 (2025)").arg(index)},{"category_id",index==4?"2":"1"},{"container_extension","mp4"},{"stream_icon",QString("https://fixture.invalid/movie-%1.jpg").arg(index%3)},{"plot","Yerel arayüz doğrulaması için mevcut test kataloğu kaydı."}});
                value = movies;
            } else if (action == "get_series") value = QJsonArray{
                QJsonObject{{"series_id","201"},{"name","Şebeke (2023)"},{"category_id","1"},{"cover","https://fixture.invalid/series.jpg"},{"plot","Sezon ve bölüm seçimi için yerel doğrulama kaydı."}},
                QJsonObject{{"series_id","202"},{"name","The Boroughs (2026)"},{"category_id","2"},{"cover","https://fixture.invalid/series-boroughs.jpg"}},
                QJsonObject{{"series_id","203"},{"name","Mahsun J (2026)"},{"category_id","1"},{"cover","https://fixture.invalid/series-mahsun.jpg"}}};
            else if (action == "get_live_streams") {
                QJsonArray channels; const QStringList names{"TRT 1 FHD","Kanal D FHD","ATV FHD","Show TV FHD","Star TV FHD","NOW FHD","TV8 FHD","TRT Haber FHD","TRT Spor FHD","S Sport FHD","TLC FHD","TRT Belgesel FHD"};
                for (int index=0;index<names.size();++index) channels.append(QJsonObject{{"stream_id",300+index},{"name",names[index]},{"category_id","1"}});
                value = channels;
            } else if (action == "get_series_info") {
                QJsonObject episodes;
                for (int season=1;season<=2;++season) { QJsonArray rows; for (int number=1;number<=3;++number) rows.append(QJsonObject{{"id",2000+season*10+number},{"season",season},{"episode_num",number},{"title",QString("Şebeke · %1. Bölüm").arg(number)},{"container_extension","mp4"}}); episodes[QString::number(season)] = rows; }
                value = QJsonObject{{"episodes",episodes}};
            } else if (action == "get_short_epg") value = QJsonObject{{"epg_listings",QJsonArray{QJsonObject{{"title",QString::fromLatin1(QByteArray("Yerel test yayını").toBase64())},{"start_timestamp",QString::number(QDateTime::currentSecsSinceEpoch()-300)},{"stop_timestamp",QString::number(QDateTime::currentSecsSinceEpoch()+3300)}}}}};
            else value = QJsonArray{};
        } else value = QJsonObject{};
        const auto bytes = value.isArray() ? QJsonDocument(value.toArray()).toJson(QJsonDocument::Compact) : QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact);
        socket->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + QByteArray::number(bytes.size()) + "\r\n\r\n" + bytes);
        socket->disconnectFromHost();
    }
public:
    bool accessActive = true;
    int accountRequests = 0;
    qint64 expiry = QDateTime::currentMSecsSinceEpoch()+3600000;
    QSet<QString> paths, actions;
    FixtureServer() {
        listen(QHostAddress::LocalHost);
        connect(this,&QTcpServer::newConnection,this,[this] {
            while (hasPendingConnections()) {
                auto socket=nextPendingConnection();
                connect(socket,&QTcpSocket::disconnected,socket,&QObject::deleteLater);
                connect(socket,&QTcpSocket::readyRead,socket,[this,socket] {
                    auto data=socket->property("buffer").toByteArray()+socket->readAll();
                    if (data.size()>1024*1024) { socket->abort(); return; }
                    socket->setProperty("buffer",data);
                    const int end=data.indexOf("\r\n\r\n"); if(end<0) return;
                    int length=0; for(const auto &header:data.left(end).split('\n')) if(header.toLower().startsWith("content-length:")) length=header.mid(15).trimmed().toInt();
                    if(length<0 || length>1024*1024) { socket->abort(); return; }
                    if(data.size()<end+4+length || socket->property("answered").toBool()) return;
                    socket->setProperty("answered",true); respond(socket,data);
                });
            }
        });
    }
    QUrl base() const { return QUrl(QString("http://127.0.0.1:%1").arg(serverPort())); }
};

bool capture(QQuickWindow *window, const QString &path) {
    if (!window || !window->isVisible()) return false;
    window->raise(); window->requestActivate(); window->update(); QTest::qWait(450);
    QImage image;
#ifdef Q_OS_WIN
    image = window->screen()->grabWindow(0,window->x(),window->y(),window->width(),window->height()).toImage();
#else
    image = window->grabWindow();
#endif
    return !image.isNull() && image.width() >= 900 && image.height() >= 620 && image.save(path);
}
QQuickItem *visual(QQuickItem *parent,const QString &name) {
    if(parent->objectName()==name)return parent;
    for(auto child:parent->childItems())if(auto match=visual(child,name))return match;
    return nullptr;
}
bool click(QQuickWindow *window, const QString &objectName) {
    auto item=visual(window->contentItem(),objectName);
    if(!item||!item->isVisible()||!item->isEnabled())return false;
    window->requestActivate();QTest::qWait(50);
    const auto position=item->mapToScene(QPointF(item->width()/2,item->height()/2)).toPoint();
    QTest::mouseClick(window,Qt::LeftButton,Qt::NoModifier,position);QTest::qWait(30);return true;
}
bool search(QQuickWindow *window, const QString &query) {
    auto input=visual(window->contentItem(),"catalogSearch");if(!input)return false;
    input->setProperty("text",query);input->forceActiveFocus();QTest::keyClick(window,Qt::Key_Return);return true;
}
QString visibleSeriesButton(QQuickItem *parent,const QRectF &bounds) {
    const auto point=parent->mapToScene(QPointF(parent->width()/2,parent->height()/2));
    if(parent->objectName().startsWith("inspect-series-")&&parent->isVisible()&&bounds.contains(point))return parent->objectName();
    for(auto child:parent->childItems()) { const auto match=visibleSeriesButton(child,bounds);if(!match.isEmpty())return match; }
    return {};
}
bool homeAtTop(QQuickWindow *window) {
    auto title=visual(window->contentItem(),"routeHeading"),hero=visual(window->contentItem(),"catalogHero"),page=visual(window->contentItem(),"browsePage");
    if(!title||!hero||!page||!title->isVisible()||!hero->isVisible()||page->property("pendingReset").toBool())return false;
    const auto titleY=title->mapToScene(QPointF()).y(),heroY=hero->mapToScene(QPointF()).y();
    return titleY>=66&&titleY<=150&&heroY>titleY&&heroY<270&&hero->height()>250;
}
bool doubleClickOnlyChangesFullscreen(QQuickWindow *video,QQuickWindow *overlay,DesktopPlayer &player,QJsonObject &evidence) {
    auto pointer=overlay?visual(overlay->contentItem(),"videoPointerArea"):nullptr;
    auto pauseTimer=overlay?overlay->findChild<QObject *>("videoSingleClickTimer"):nullptr;
    if(!video||!pointer||!pauseTimer)return false;
    const bool beforeFullscreen=player.fullScreen(),beforePlaying=player.playing();
    QSignalSpy doubleClicks(pointer,SIGNAL(doubleClicked(QQuickMouseEvent*))),pauses(pauseTimer,SIGNAL(triggered()));
    overlay->requestActivate();QTest::qWait(50);
    // QWindow's mouseDClick already emits both press/release pairs; no preceding click.
    QTest::mouseDClick(overlay,Qt::LeftButton,Qt::NoModifier,QPoint(overlay->width()/2,overlay->height()/2),10);
    const bool geometrySettled=until([&] {
        return player.fullScreen()!=beforeFullscreen&&video->visibility()==(player.fullScreen()?QWindow::FullScreen:QWindow::Windowed)&&overlay->isVisible()&&overlay->geometry()==video->geometry();
    },3000);
    QTest::qWait(QGuiApplication::styleHints()->mouseDoubleClickInterval()+80);
    evidence={{"fullscreenBefore",beforeFullscreen},{"fullscreenAfter",player.fullScreen()},{"playingBefore",beforePlaying},{"playingAfter",player.playing()},{"active",player.active()},{"doubleClicks",doubleClicks.size()},{"pauseTimerTriggers",pauses.size()},{"geometrySettled",geometrySettled}};
    return geometrySettled&&player.active()&&player.playing()==beforePlaying&&player.fullScreen()!=beforeFullscreen&&doubleClicks.size()==1&&pauses.isEmpty();
}
}

int main(int argc,char **argv) {
    Q_INIT_RESOURCE(desktop_resources);
    QGuiApplication app(argc,argv);
    qInstallMessageHandler(logMessage);
    auto argument=[&](const QString &name) { const auto args=app.arguments();const auto index=args.indexOf(name);return index>=0&&index+1<args.size()?args[index+1]:QString(); };
    const auto output=QFileInfo(argument("--output")).absoluteFilePath();
    const auto media=argument("--media");
    const auto codecs=argument("--codec-fixtures");
    const bool catalogOnly=app.arguments().contains("--catalog-only");
    if(argument("--output").isEmpty() || (!catalogOnly&&!QFileInfo(media).isFile())) { qCritical("ui_smoke --output DIRECTORY --media LOCAL_VIDEO [--artwork-dir DIRECTORY]"); return 2; }
    QDir().mkpath(output);
    QJsonObject report{{"passed",false},{"localMediaPlaying",false},{"fixtureHttp",false},{"catalogOnly",catalogOnly},{"platform",QSysInfo::productType()}};
    auto finish=[&](const QString &failure,int result) { report["error"]=failure;report["qmlErrors"]=QJsonArray::fromStringList(qmlErrors); QFile file(QDir(output).filePath("smoke.json"));if(file.open(QIODevice::WriteOnly))file.write(QJsonDocument(report).toJson()); if(!failure.isEmpty())qCritical("%s",qPrintable(failure));return result; };
    QString artwork=argument("--artwork-dir");
    if(artwork.isEmpty()) artwork=QDir::current().filePath("apps/tv-android/app/src/androidTest/assets/discovery");
    if(!QFileInfo(QDir(artwork).filePath("movie-0.jpg")).isFile()) return finish("Existing fixture artwork was not found",3);
    FixtureServer fixture; if(!fixture.isListening())return finish("Loopback fixture server did not start",4);
    QTemporaryDir storage; RepositoryOptions options; options.apiBase=fixture.base(); options.storageDirectory=storage.path(); options.allowLoopbackForTests=true;
    DesktopRepository repository(options); DesktopPlayer player(nullptr,true);
    ArtworkFactory factory(artwork); QQmlApplicationEngine engine;
    installDesktop(engine,repository,player);
    engine.setNetworkAccessManagerFactory(&factory);
    engine.load(QUrl("qrc:/qml/Root.qml"));
    if(engine.rootObjects().isEmpty())return finish("Production QML did not create a window",5);
    auto root=qobject_cast<QQuickWindow *>(engine.rootObjects().first());
    if(!root || !until([&]{return root->isVisible();}))return finish("Production window did not become visible",6);
    repository.restore();
    if(!until([&]{return !repository.bootstrapping();}))return finish("Session restore did not settle",6);
    if(!capture(root,QDir(output).filePath("login.png")))return finish("Login screenshot failed",7);
    auto login=visual(root->contentItem(),"loginCode");if(!login)return finish("Login input missing",7);
    login->setProperty("text","ABCDEFGHIJKLMNOP");
    if(!click(root,"loginAction"))return finish("Login control failed",7);
    if(!until([&]{return repository.authenticated()&&repository.welcomeVisible();}))return finish("Welcome fixture offer failed: "+repository.error(),8);
    if(!capture(root,QDir(output).filePath("welcome.png")))return finish("Welcome screenshot failed",8);
    if(!click(root,"welcome-trial"))return finish("Welcome trial control failed",8);
    if(!until([&]{return !repository.welcomeVisible()&&!repository.busy();}))return finish("Welcome choice failed",8);
    if(!until([&]{return repository.authenticated()&&!repository.busy()&&!repository.hero().isEmpty()&&repository.shelves().size()>0;}))return finish("Fixture login/home catalog failed: "+repository.error(),8);
    if(!until([&]{return homeAtTop(root);}))return finish("Initial home title/hero did not settle at top",9);
    if(!capture(root,QDir(output).filePath("home.png")))return finish("Home screenshot failed",9);
    if(!homeAtTop(root))return finish("Initial home shifted after settling",9);
    if(!click(root,"nav-live"))return finish("Live navigation failed",10);
    if(!until([&]{return !repository.busy()&&repository.items().size()>=10&&repository.items().first().toMap()["kind"]=="live";}))return finish("Live catalog failed",10);
    if(!capture(root,QDir(output).filePath("live.png")))return finish("Live screenshot failed",11);
    if(!click(root,"categoryAction"))return finish("Category panel action failed",11);
    if(!until([&]{auto list=visual(root->contentItem(),"categoryList");return list&&list->isVisible()&&list->property("count").toInt()>1;}))return finish("Category panel list failed",11);
    if(!capture(root,QDir(output).filePath("categories.png")))return finish("Category screenshot failed",11);
    QTest::keyClick(root,Qt::Key_Escape);
    auto channel=repository.items().first().toMap(); repository.toggleFavorite(channel);
    if(!until([&]{return repository.isFavorite(channel);}))return finish("Favorite action failed",12);
    if(!click(root,"nav-home")||!until([&]{return repository.route()=="home"&&homeAtTop(root);}))return finish("Archive-to-home scroll reset failed",12);
    if(!capture(root,QDir(output).filePath("home-return.png"))||!homeAtTop(root))return finish("Archive-to-home position shifted",12);
    if(!search(root,"Işık"))return finish("Search input failed",13);
    if(!until([&]{return repository.items().isEmpty();}))return finish("Empty search did not settle",13);
    if(!capture(root,QDir(output).filePath("empty-search.png")))return finish("Empty search screenshot failed",14);
    if(!search(root,"Fısıltı"))return finish("Search input failed",15);
    if(!until([&]{return repository.items().size()==1&&repository.items().first().toMap()["title"].toString().contains("Fısıltı");}))return finish("Turkish search did not match",15);
    if(!capture(root,QDir(output).filePath("search.png")))return finish("Search screenshot failed",16);
    if(!click(root,"nav-series"))return finish("Series navigation failed",17);
    if(!until([&]{return repository.items().size()==3&&repository.items().first().toMap()["kind"]=="series";}))return finish("Series catalog failed",17);
    QTest::qWait(250);
    const auto seriesControl=visibleSeriesButton(root->contentItem(),QRectF(230,80,root->width()-250,root->height()-100));
    if(seriesControl.isEmpty()||!click(root,seriesControl))return finish("Series details control failed",18);
    if(!until([&]{return repository.seriesDetail()["seasons"].toList().size()==2;}))return finish("Series detail failed",18);
    const auto verifiedDetail=repository.seriesDetail();
    if(!capture(root,QDir(output).filePath("series.png")))return finish("Series screenshot failed",19);
    QTest::keyClick(root,Qt::Key_Escape); if(!click(root,"nav-account"))return finish("Account navigation failed",20); QTest::qWait(100);
    if(!capture(root,QDir(output).filePath("account.png")))return finish("Account screenshot failed",20);
    root->resize(900,620); QTest::qWait(100);
    if(!capture(root,QDir(output).filePath("minimum-size.png")))return finish("Minimum size screenshot failed",21);
    root->resize(1280,800);
    fixture.accessActive=false;repository.refresh();
    if(!until([&]{auto expired=visual(root->contentItem(),"expiredAccessPage");return repository.authenticated()&&!repository.busy()&&repository.account()["canPlay"]==false&&expired&&expired->isVisible();}))return finish("Authenticated expired account did not show its access screen",44);
    auto browse=visual(root->contentItem(),"browsePage"),loginInput=visual(root->contentItem(),"loginCode");
    if(!browse||browse->isVisible()||!loginInput||loginInput->isVisible())return finish("Expired account showed a catalog or login form",45);
    for(const auto &name:QStringList{"expiredPackages","expiredRefresh","expiredSupport","expiredLogout"}) { auto action=visual(root->contentItem(),name);if(!action||!action->isVisible()||!action->isEnabled())return finish("Expired access action missing: "+name,46); }
    if(!capture(root,QDir(output).filePath("expired-access.png")))return finish("Expired access screenshot failed",47);
    const auto checked=fixture.accountRequests;
    if(!click(root,"expiredRefresh")||!until([&]{return fixture.accountRequests>checked&&!repository.busy();}))return finish("Expired account recheck did not reach the fixture",48);
    fixture.accessActive=true;
    if(!click(root,"expiredRefresh")||!until([&]{return !repository.busy()&&repository.account()["canPlay"]==true;}))return finish("Renewed account did not restore access",49);
    report["expiredAccess"]=true;
    const bool http=fixture.paths.contains("/auth/login-by-code")&&fixture.paths.contains("/me/provider-session")&&fixture.paths.contains("/me/personal-library")&&fixture.actions.contains("get_vod_streams")&&fixture.actions.contains("get_live_streams")&&fixture.actions.contains("get_series_info")&&!fixture.paths.contains("/me/native");
    report["fixtureHttp"]=http;
    if(!http)return finish("Required fixture HTTP flows were not exercised",22);
    if(!qmlErrors.isEmpty())return finish("Production QML reported runtime errors",23);
    if(catalogOnly) {
        if(QFileInfo(media).isFile()) {
            const auto probeItem=verifiedDetail["seasons"].toList().first().toMap()["episodes"].toList().first().toMap();
            player.open({{"item",probeItem},{"url",QUrl::fromLocalFile(QFileInfo(media).absoluteFilePath()).toString()},{"expiresAt",fixture.expiry},{"scope",repository.scope()},{"resumeMs",0},{"next",QVariantMap{}}});
            QQuickWindow *overlay=nullptr;
            if(!until([&]{for(auto window:QGuiApplication::topLevelWindows())if(window->objectName()=="playerOverlay"&&window->isVisible())overlay=qobject_cast<QQuickWindow *>(window);return overlay!=nullptr;}))return finish("Menu probe player overlay missing",40);
            if(!click(overlay,"playerSubtitleAction"))return finish("Menu probe subtitle button missing",40);
            auto menu=overlay->findChild<QObject *>("playerSubtitleMenu");
            if(!menu||!until([&]{return menu->property("visible").toBool();}))return finish("Menu probe subtitle menu missing",41);
            QTest::keyClick(QGuiApplication::focusWindow()?QGuiApplication::focusWindow():overlay,Qt::Key_Escape);
            if(!until([&]{return !menu->property("visible").toBool();})||!player.active())return finish(QString("Subtitle menu Escape failed: active=%1 visible=%2").arg(player.active()).arg(menu->property("visible").toBool()),42);
            QQuickWindow *video=nullptr;for(auto window:QGuiApplication::topLevelWindows())if(window->objectName()=="playerWindow")video=qobject_cast<QQuickWindow *>(window);
            QJsonArray pointerChecks;
            for(int direction=0;direction<2;++direction) { QJsonObject evidence;const bool passed=doubleClickOnlyChangesFullscreen(video,overlay,player,evidence);pointerChecks.append(evidence);report["pointerDispatch"]=pointerChecks;if(!passed)return finish("Pointer fullscreen probe failed: "+QString::fromUtf8(QJsonDocument(evidence).toJson(QJsonDocument::Compact)),51); }
            report["menuEscapePreserved"]=true;player.close();
        }
        return finish("Catalog preview only; native Windows playback remains unverified",0);
    }
    if(!QFileInfo(QDir(codecs).filePath("h264-mp2.ts")).isFile()||!QFileInfo(QDir(codecs).filePath("two-audio-subtitles.mkv")).isFile())return finish("Full playback verification requires --codec-fixtures DIRECTORY",34);
    QVariantMap item=verifiedDetail["seasons"].toList().first().toMap()["episodes"].toList().first().toMap();
    player.open({{"item",item},{"url",QUrl::fromLocalFile(QFileInfo(media).absoluteFilePath()).toString()},{"expiresAt",fixture.expiry},{"scope",repository.scope()},{"resumeMs",0},{"next",repository.nextEpisode(item)}});
    if(!until([&]{return player.active()&&player.playing()&&player.hasVideoFrame()&&player.positionMs()>250;},30000))return finish("Native VLC did not produce real local video: "+player.error(),24);
    report["localMediaPlaying"]=true;
    player.interact();
    QQuickWindow *video=nullptr; for(auto window:QGuiApplication::topLevelWindows())if(auto quick=qobject_cast<QQuickWindow *>(window);quick&&quick!=root&&quick->isVisible()&&quick->color()==QColor("black"))video=quick;
    if(!video || !capture(video,QDir(output).filePath("player.png")))return finish("Native player screenshot failed",25);
    QQuickWindow *overlay=nullptr;for(auto window:QGuiApplication::topLevelWindows())if(window->objectName()=="playerOverlay")overlay=qobject_cast<QQuickWindow *>(window);
    if(!overlay)return finish("Player controls window missing",50);
    QJsonArray pointerChecks;
    for(int direction=0;direction<2;++direction) { QJsonObject evidence;const bool passed=doubleClickOnlyChangesFullscreen(video,overlay,player,evidence);pointerChecks.append(evidence);report["pointerDispatch"]=pointerChecks;if(!passed)return finish("Video double-click failed: "+QString::fromUtf8(QJsonDocument(evidence).toJson(QJsonDocument::Compact)),51); }
    report["doubleClickPreservedPlayback"]=true;
    player.interact();
    if(!until([&]{return !player.controlsVisible();},4000))return finish("Player controls did not hide after idle",26);
    player.togglePause();if(!until([&]{return !player.playing()&&player.controlsVisible();}))return finish("Pause/controls state failed",27);
    player.close();if(!until([&]{return !player.active();}))return finish("Player did not close",28);
    auto openLocal=[&](QVariantMap selected,const QString &path) { player.open({{"item",selected},{"url",QUrl::fromLocalFile(QFileInfo(path).absoluteFilePath()).toString()},{"expiresAt",fixture.expiry},{"scope",repository.scope()},{"resumeMs",0},{"next",QVariantMap{}}}); };
    auto playable=[](const QVariantList &tracks) { QList<int> result;for(const auto &entry:tracks)if(entry.toMap()["id"].toInt()>=0)result.append(entry.toMap()["id"].toInt());return result; };
    QVariantMap live=channel;live["extension"]="ts";
    QSignalSpy falseEnd(&player,&DesktopPlayer::playRequested);
    openLocal(live,QDir(codecs).filePath("h264-mp2.ts"));
    if(!until([&]{return player.playing()&&player.hasVideoFrame()&&player.positionMs()>250&&playable(player.audioTracks()).size()>=1;},30000))return finish("TS/MP2 fixture did not decode video and audio: "+player.error(),35);
    if(!player.live()||!falseEnd.isEmpty()||player.nextCountdown()!=0)return finish("Live TS fixture incorrectly advanced an episode",36);
    player.interact();if(!capture(video,QDir(output).filePath("ts-player.png")))return finish("TS player screenshot failed",37);
    player.close();
    openLocal(item,QDir(codecs).filePath("two-audio-subtitles.mkv"));
    if(!until([&]{return player.playing()&&player.hasVideoFrame()&&playable(player.audioTracks()).size()>=2&&playable(player.subtitleTracks()).size()>=1;},30000))return finish("MKV fixture did not expose both audio tracks and subtitles: "+player.error(),38);
    const auto audio=playable(player.audioTracks()),subtitles=playable(player.subtitleTracks());
    player.selectAudio(audio[1]);player.selectSubtitle(subtitles[0]);
    QTest::qWait(2400);
    if(player.audioTrack()!=audio[1]||player.subtitleTrack()!=subtitles[0]||!player.playing())return finish("MKV selected audio/subtitle IDs did not persist after native track polling",39);
    overlay=root->findChild<QQuickWindow *>("playerOverlay");
    if(!overlay)for(auto window:QGuiApplication::topLevelWindows())if(window->objectName()=="playerOverlay")overlay=qobject_cast<QQuickWindow *>(window);
    const auto subtitleMenu=overlay?overlay->findChild<QObject *>("playerSubtitleMenu"):nullptr;
    if(!subtitleMenu||subtitleMenu->property("count").toInt()!=subtitles.size()+1)return finish("Subtitle menu duplicated its off entry or omitted a track",52);
    for(const auto &names:QList<QPair<QString,QString>>{{"playerAudioAction","playerAudioMenu"},{"playerSubtitleAction","playerSubtitleMenu"}}) {
        player.interact();if(!overlay||!click(overlay,names.first))return finish("Track menu control failed",40);
        auto menu=overlay->findChild<QObject *>(names.second);
        if(!menu||!until([&]{return menu->property("visible").toBool();}))return finish("Track menu did not open",41);
        QTest::keyClick(QGuiApplication::focusWindow()?QGuiApplication::focusWindow():overlay,Qt::Key_Escape);
        if(!until([&]{return !menu->property("visible").toBool();})||!player.active())return finish(QString("Track menu Escape failed: active=%1 visible=%2").arg(player.active()).arg(menu->property("visible").toBool()),42);
    }
    player.interact();if(!capture(video,QDir(output).filePath("mkv-player.png")))return finish("MKV player screenshot failed",43);
    report["codecFixtures"]=QJsonObject{{"tsMp2",true},{"mkvTracks",true}};
    player.close();
    QFile corrupt(QDir(storage.path()).filePath("corrupt.avi"));
    if(!corrupt.open(QIODevice::WriteOnly))return finish("Corrupt-media fixture could not be created",30);
    corrupt.write("RIFF\x20\x00\x00\x00" "AVI LIST\x10\x00\x00\x00" "hdrlinvalid-local-fixture");corrupt.close();
    QObject::disconnect(&player,&DesktopPlayer::refreshRequested,&repository,&DesktopRepository::refreshPlayback);
    QSignalSpy refresh(&player,&DesktopPlayer::refreshRequested);
    player.open({{"item",item},{"url",QUrl::fromLocalFile(corrupt.fileName()).toString()},{"expiresAt",fixture.expiry},{"scope",repository.scope()},{"resumeMs",0},{"next",repository.nextEpisode(item)}});
    if(!until([&]{return !refresh.isEmpty();},35000))return finish("Corrupt local media did not enter bounded recovery",31);
    const auto episodes=verifiedDetail["seasons"].toList().first().toMap()["episodes"].toList();
    if(episodes.size()<2)return finish("Second episode fixture missing",32);
    const auto second=episodes[1].toMap();
    player.open({{"item",second},{"url",QUrl::fromLocalFile(QFileInfo(media).absoluteFilePath()).toString()},{"expiresAt",fixture.expiry},{"scope",repository.scope()},{"resumeMs",0},{"next",repository.nextEpisode(second)}});
    if(!until([&]{return player.item()["id"]==second["id"]&&player.playing()&&player.hasVideoFrame()&&player.positionMs()>250;},30000))return finish("New selection did not supersede recovery",33);
    report["recoverySelectionPreserved"]=true;
    player.close();
    if(!qmlErrors.isEmpty())return finish("Player QML reported runtime errors",29);
    report["passed"]=true;return finish({},0);
}
