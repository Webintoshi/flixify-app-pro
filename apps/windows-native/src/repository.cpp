#include "repository.h"
#include "catalog.h"
#include "session_store.h"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrlQuery>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QTimer>
#include <QStandardPaths>
#include <QDesktopServices>
#include <QPointer>
#include <QDateTime>
#include <QRegularExpression>
#include <QFileInfo>
#include <QSettings>
#include <QFutureWatcher>
#include <QtConcurrent/QtConcurrentRun>
#include <stdexcept>
#include <algorithm>
#include <cmath>

namespace {
using Reply = std::function<void(int,QJsonDocument)>;
using Done = std::function<void(bool)>;
QString defaultStorage(){return QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);}
qint64 date(const QJsonValue &v){if(!v.isString()||v.toString().size()>64)return 0;auto d=QDateTime::fromString(v.toString(),Qt::ISODateWithMs);if(!d.isValid())d=QDateTime::fromString(v.toString(),Qt::ISODate);return d.isValid()?d.toMSecsSinceEpoch():0;}
bool secret(const QJsonValue &v,int max){return v.isString()&&!v.toString().isEmpty()&&v.toString().size()<=max&&!v.toString().contains(QRegularExpression("[\\x00-\\x1f\\x7f]"));}
bool loopback(const QUrl &u){return (u.host()=="127.0.0.1"||u.host()=="::1"||u.host()=="localhost")&&(u.scheme()=="http"||u.scheme()=="https");}
bool jsonBounded(const QJsonDocument &doc){if(doc.isNull())return false;qsizetype nodes=0;std::function<bool(const QJsonValue&,int)> visit=[&](const QJsonValue &v,int depth){if(++nodes>1000000||depth>32)return false;if(v.isString())return v.toString().size()<=1048576;if(v.isArray()){auto a=v.toArray();if(a.size()>50000)return false;for(const auto&c:a)if(!visit(c,depth+1))return false;}if(v.isObject()){auto o=v.toObject();if(o.size()>50000)return false;for(auto i=o.begin();i!=o.end();++i)if(i.key().size()>1024||!visit(i.value(),depth+1))return false;}return true;};return visit(doc.isArray()?QJsonValue(doc.array()):QJsonValue(doc.object()),0);}
class StrictJson {
    const QByteArray &bytes;qsizetype offset=0,nodes=0;
    void whitespace(){while(offset<bytes.size()&&(bytes[offset]==' '||bytes[offset]=='\t'||bytes[offset]=='\r'||bytes[offset]=='\n'))offset++;}
    bool character(char c){whitespace();if(offset>=bytes.size()||bytes[offset]!=c)return false;offset++;return true;}
    bool string(QString *decoded=nullptr){whitespace();if(offset>=bytes.size()||bytes[offset]!='"')return false;auto start=offset++;bool closed=false;while(offset<bytes.size()){auto c=bytes[offset++];if(c=='"'){closed=true;break;}if(static_cast<unsigned char>(c)<0x20)return false;if(c=='\\'){if(offset>=bytes.size())return false;offset++;}}if(!closed)return false;if(decoded){auto wrapped=QByteArray("[")+bytes.mid(start,offset-start)+']';auto doc=QJsonDocument::fromJson(wrapped);if(!doc.isArray()||doc.array().size()!=1||!doc.array().first().isString())return false;*decoded=doc.array().first().toString();if(decoded->size()>1024)return false;}return true;}
    bool value(int depth){whitespace();if(depth>32||++nodes>1000000||offset>=bytes.size())return false;char c=bytes[offset];
        if(c=='{'){offset++;whitespace();if(offset<bytes.size()&&bytes[offset]=='}'){offset++;return true;}QSet<QString> keys;for(int count=0;count<50000;count++){QString key;if(!string(&key)||keys.contains(key)||!character(':'))return false;keys.insert(key);if(!value(depth+1))return false;whitespace();if(offset>=bytes.size())return false;if(bytes[offset]=='}'){offset++;return true;}if(!character(','))return false;}return false;}
        if(c=='['){offset++;whitespace();if(offset<bytes.size()&&bytes[offset]==']'){offset++;return true;}for(int count=0;count<50000;count++){if(!value(depth+1))return false;whitespace();if(offset>=bytes.size())return false;if(bytes[offset]==']'){offset++;return true;}if(!character(','))return false;}return false;}
        if(c=='"')return string();auto start=offset;while(offset<bytes.size()&&bytes[offset]!=','&&bytes[offset]!=']'&&bytes[offset]!='}'&&bytes[offset]!=' '&&bytes[offset]!='\n'&&bytes[offset]!='\r'&&bytes[offset]!='\t')offset++;return offset>start;
    }
public:
    explicit StrictJson(const QByteArray &data):bytes(data){}
    bool valid(){if(!value(0))return false;whitespace();return offset==bytes.size();}
};
StoredSession tokens(const QJsonObject &r){auto user=r["user"].toObject();StoredSession s{r["accessToken"].toString(),r["refreshToken"].toString(),user["id"].toString(),Catalog::clean(user["codeSuffix"],16).right(4)};return s.valid()?s:StoredSession{};}
}
class DesktopRepository::Private {
public:
    DesktopRepository *q;RepositoryOptions options;QNetworkAccessManager network;SessionStore vault;MetadataStore cache;QTimer expiryTimer,refreshTimer;
    StoredSession session;QString providerOrigin,username,password,version,policyRevision;QSet<QString> excluded;QString currentScope;quint64 authGeneration=0,sourceGeneration=0;QSet<QNetworkReply*> replies;QHash<QNetworkReply*,QString> replyScopes;
    bool boot=true,working=false,detailLoading=false,moreLoading=false,sound=true,rotating=false,refreshing=false;int visible=96,revision=0;QString failure,currentRoute="home",searchQuery,selectedCategory,selectedCountry;QVariantMap currentAccount,currentHero,detail,offer;QVariantList visibleItems,currentShelves,currentCategories,currentCountries,favoriteItems,epgRows,filtered;QHash<QString,QVariantList> catalogs;QHash<QString,QHash<QString,int>> catalogIndices;QHash<QString,qint64> catalogSaved;QHash<QString,QVariantMap> details;QHash<QString,qint64> detailSaved;QSet<QString> detailRefreshing;bool bypassDetailDisk=false;QHash<QString,QString> liveAliases;QHash<QString,QList<Done>> catalogFlights;QSet<QString> diskChecked;QHash<QString,QVariantMap> references;QSet<QString> watched,watchedWrites;QList<Done> rotationWaiters;QString libraryScope;qint64 deadline=0;int playbackSerial=0;quint64 viewGeneration=0,accountFlight=0,rotationTicket=0,detailSelection=0,epgSelection=0,detailEpoch=0;QTimer queryTimer;
    Private(DesktopRepository *owner,RepositoryOptions o):q(owner),options(std::move(o)),network(owner),vault(options.storageDirectory.isEmpty()?defaultStorage():options.storageDirectory,options.allowLoopbackForTests),cache(options.storageDirectory.isEmpty()?defaultStorage():options.storageDirectory){
        QSettings preferences((options.storageDirectory.isEmpty()?defaultStorage():options.storageDirectory)+"/preferences.ini",QSettings::IniFormat);sound=preferences.value("posterSoundEnabled",true).toBool();
        if(!options.now)options.now=[] {return QDateTime::currentMSecsSinceEpoch();};
        if(!(options.apiBase.scheme()=="https"&&options.apiBase.host()=="api.flixify.vip"&&options.apiBase.userInfo().isEmpty()&&options.apiBase.path().isEmpty()&&!options.apiBase.hasQuery()&&!options.apiBase.hasFragment())&&!(options.allowLoopbackForTests&&loopback(options.apiBase)))options.apiBase=QUrl("https://api.flixify.vip");
        queryTimer.setSingleShot(true);queryTimer.setInterval(90);QObject::connect(&queryTimer,&QTimer::timeout,q,[this]{rebuild();});
        QObject::connect(&expiryTimer,&QTimer::timeout,q,[this]{if(deadline&&deadline<=now())revoke();});expiryTimer.start(250);
        QObject::connect(&refreshTimer,&QTimer::timeout,q,[this]{if(session.valid()&&!refreshing&&!working)refreshAccount(false);});refreshTimer.start(60000);
    }
    qint64 now()const{return options.now();}
    void changed(){emit q->stateChanged();}
    void fail(QString text=QString::fromUtf8("Bağlantı tamamlanamadı. Lütfen yeniden dene.")){failure=std::move(text);changed();}
    void abort(){auto old=replies;replies.clear();for(auto *reply:old)reply->abort();}
    void clearSource(){auto staleScope=currentScope;sourceGeneration++;viewGeneration++;detailSelection++;epgSelection++;detailLoading=false;currentScope.clear();working=false;auto scoped=replyScopes;for(auto it=scoped.begin();it!=scoped.end();++it)if(it.value()==staleScope)it.key()->abort();providerOrigin.clear();username.clear();password.clear();version.clear();excluded.clear();policyRevision.clear();deadline=0;catalogs.clear();catalogIndices.clear();catalogSaved.clear();catalogFlights.clear();diskChecked.clear();details.clear();detailSaved.clear();detailRefreshing.clear();bypassDetailDisk=false;detailEpoch++;liveAliases.clear();references.clear();watched.clear();watchedWrites.clear();favoriteItems.clear();libraryScope.clear();detail.clear();epgRows.clear();currentHero.clear();currentShelves.clear();visibleItems.clear();filtered.clear();currentCategories.clear();currentCountries.clear();revision++;playbackSerial++;emit q->sourceChanged();}
    void revoke(){if(currentScope.isEmpty()&&deadline==0)return;clearSource();currentAccount["canPlay"]=false;currentAccount["expiresAt"]=qint64(0);currentAccount["message"]=QString::fromUtf8("Aktif izleme erişimin bulunmuyor.");emit q->accessRevoked();changed();}
    bool sourceValid(const QString &scope,quint64 generation){if(deadline&&deadline<=now()){revoke();return false;}return session.valid()&&!scope.isEmpty()&&scope==currentScope&&generation==sourceGeneration&&deadline>now();}
    void request(QUrl url,QByteArray method,QJsonObject body,QString token,Reply callback,QString requestScope={}){
        const auto auth=authGeneration;
        if(!url.isValid()||!url.userInfo().isEmpty()||url.hasFragment()||url.toString().contains('\\')||!(url.scheme()=="https"||(options.allowLoopbackForTests&&loopback(url)))){callback(0,{});return;}
        QNetworkRequest req(url);req.setTransferTimeout(20000);req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);req.setRawHeader("Accept","application/json");req.setRawHeader("User-Agent","Flixify-Windows/1");if(!token.isEmpty())req.setRawHeader("Authorization","Bearer "+token.toUtf8());
        QByteArray bytes;if(method!="GET"){req.setHeader(QNetworkRequest::ContentTypeHeader,"application/json");bytes=QJsonDocument(body).toJson(QJsonDocument::Compact);}auto *reply=network.sendCustomRequest(req,method,bytes);reply->setReadBufferSize(128*1024);QTimer::singleShot(60000,reply,[reply]{if(!reply->isFinished())reply->abort();});replies.insert(reply);if(!requestScope.isEmpty())replyScopes[reply]=requestScope;
        auto buffer=std::make_shared<QByteArray>();QObject::connect(reply,&QNetworkReply::readyRead,q,[reply,buffer]{*buffer+=reply->readAll();if(buffer->size()>20*1024*1024)reply->abort();});
        QObject::connect(reply,&QNetworkReply::finished,q,[this,reply,auth,buffer,callback=std::move(callback)]{replies.remove(reply);replyScopes.remove(reply);if(reply->isOpen())*buffer+=reply->readAll();auto status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();bool ok=reply->error()==QNetworkReply::NoError||status>=400;reply->deleteLater();if(auth!=authGeneration)return;if(!ok||buffer->size()>20*1024*1024){buffer->fill('\0');callback(ok?status:0,{});return;}
            auto *watcher=new QFutureWatcher<QJsonDocument>(q);QObject::connect(watcher,&QFutureWatcher<QJsonDocument>::finished,q,[this,watcher,auth,status,callback]{auto doc=watcher->result();watcher->deleteLater();if(auth==authGeneration)callback(status,doc);});
            auto payload=std::move(*buffer);watcher->setFuture(QtConcurrent::run([payload=std::move(payload)]() mutable {QJsonDocument doc;if(StrictJson(payload).valid())doc=QJsonDocument::fromJson(payload);payload.fill('\0');if(!jsonBounded(doc))doc={};return doc;}));});
    }
    bool apiContextValid(quint64 auth,quint64 generation,const QString &scope) const {
        return auth==authGeneration&&generation==sourceGeneration&&scope==currentScope&&session.valid();
    }
    void rotate(Done done){
        rotationWaiters.append(std::move(done));if(rotating)return;rotating=true;
        const auto auth=authGeneration,ticket=++rotationTicket;auto before=session;
        request(options.apiBase.resolved(QUrl("/auth/refresh")),"POST",{{"refreshToken",before.refreshToken}},{},[this,before,auth,ticket](int status,QJsonDocument doc){
            if(ticket!=rotationTicket||auth!=authGeneration||!session.valid()||session.accountID!=before.accountID||session.refreshToken!=before.refreshToken)return;
            auto replacement=tokens(doc.object());bool ok=status==200&&replacement.valid()&&replacement.accountID==before.accountID&&session.refreshToken==before.refreshToken&&vault.save(replacement);
            if(ok)session=replacement;rotating=false;auto callbacks=std::move(rotationWaiters);rotationWaiters.clear();
            if(status==401||status==403){q->logout();return;}for(const auto &callback:callbacks)callback(ok);
        });
    }
    void api(QString path,QByteArray method,QJsonObject body,Reply callback,bool retried=false){
        if(!session.valid()){callback(401,{});return;}
        const auto auth=authGeneration,generation=sourceGeneration;const auto scope=currentScope,access=session.accessToken;
        request(options.apiBase.resolved(QUrl(path)),method,body,access,[this,path,method,body,callback=std::move(callback),retried,auth,generation,scope,access](int status,QJsonDocument doc){
            if(!apiContextValid(auth,generation,scope))return;
            if(status==401&&session.accessToken!=access){
                if(!retried)api(path,method,body,callback,true);else callback(0,{});
                return;
            }
            if(status==401&&!retried){
                rotate([this,path,method,body,callback,auth,generation,scope](bool ok){
                    if(!apiContextValid(auth,generation,scope))return;
                    if(ok)api(path,method,body,callback,true);else callback(0,{});
                });return;
            }
            if(status==401){q->logout();return;}if(status==403)revoke();callback(status,doc);
        },scope);
    }
    bool installProvider(const QJsonObject &raw){auto incomingAccount=raw["accountId"].toString(),incomingVersion=raw["sourceVersion"].toString(),origin=raw["providerOrigin"].toString();QUrl url(origin,QUrl::StrictMode);auto expiry=date(raw["expiresAt"]);bool allowed=url.scheme()=="https"||(options.allowLoopbackForTests&&loopback(url));bool canonical=origin==url.scheme()+"://"+url.host().toLower()+(url.port()>0?":"+QString::number(url.port()):QString());
        bool invalid=incomingAccount!=session.accountID||!secret(raw["accountId"],256)||incomingAccount.contains(':')||!QRegularExpression("^[A-Za-z0-9_-]{1,128}$").match(incomingVersion).hasMatch()||!secret(raw["username"],256)||!secret(raw["password"],2048)||!allowed||url.host().isEmpty()||!url.userInfo().isEmpty()||!url.path().isEmpty()||url.hasQuery()||url.hasFragment()||origin.contains('\\')||!canonical||expiry<=now()||raw["moviePolicy"].toString()!="general-audience-only";if(invalid)return false;
        bool identity=currentScope==incomingAccount+':'+incomingVersion&&providerOrigin==origin&&username==raw["username"].toString()&&password==raw["password"].toString();
        const auto policy=raw["livePolicy"].toObject();QSet<QString> ids;QString rev=policy["revision"].toString();if(!policy.isEmpty()){if(!QRegularExpression("^[a-f0-9]{64}$").match(rev).hasMatch()||!policy["excludedIds"].isArray()||policy["excludedIds"].toArray().size()>50000)return false;for(const auto &v:policy["excludedIds"].toArray()){auto i=Catalog::id(v);if(i.isEmpty())return false;ids.insert(i);}}
        if(!identity)clearSource();else if(policy.isEmpty()){ids=excluded;rev=policyRevision;}
        bool policyChanged=rev!=policyRevision||ids!=excluded;providerOrigin=origin;username=raw["username"].toString();password=raw["password"].toString();version=incomingVersion;currentScope=incomingAccount+':'+version;deadline=expiry;excluded=ids;policyRevision=rev;if(policyChanged){catalogs.remove("live");catalogIndices.remove("live");catalogSaved.remove("live");favoriteItems.erase(std::remove_if(favoriteItems.begin(),favoriteItems.end(),[this](const QVariant&v){auto i=v.toMap();return i["kind"]=="live"&&excluded.contains(i["id"].toString());}),favoriteItems.end());}emit q->accessExtended(deadline,currentScope);return true;
    }
    bool installWelcome(const QJsonObject &raw){auto state=raw["state"].toString();if(raw["campaign"].toString()!="welcome-monthly-50-v1"||!raw["eligible"].isBool()||!QStringList{"pending","dismissed","not_eligible","redeemed"}.contains(state))return false;bool eligible=raw["eligible"].toBool();if(eligible!=(state=="pending"||state=="dismissed")||!raw["offers"].isArray()||raw["offers"].toArray().size()!=(eligible?2:0))return false;QSet<int> users;for(const auto&v:raw["offers"].toArray()){auto o=v.toObject();int u=o["users"].toInt();if(!o["users"].isDouble()||!QList<int>{1,2}.contains(u)||users.contains(u)||o["id"].toString()!="welcome-monthly-50-v1"||o["currency"].toString()!="try"||o["durationMonths"].toInt()!=1||o["amountMinor"].toInt()!=(u==1?12500:19950)||o["regularAmountMinor"].toInt()!=(u==1?25000:39900)||o["packageSlug"].toString()!=(u==1?"1-ay":"1-ay-2-kullanici"))return false;users.insert(u);}auto counts=raw["catalogue"].toObject();if(eligible&&counts.isEmpty())return false;QVariantMap next{{"state",state},{"eligible",eligible},{"showPrompt",eligible&&state=="pending"},{"singlePriceMinor",12500},{"dualPriceMinor",19950}};for(auto field:QStringList{"movies","live","series"}){auto v=counts[field];if(eligible&&(!v.isDouble()||v.toDouble()!=std::floor(v.toDouble())||v.toDouble()<0||v.toDouble()>1000000))return false;next[field]=v.toInt();}offer=next;return true;}
    void refreshAccount(bool withWelcome,Done complete={}){
        if(!session.valid()){boot=false;working=false;changed();if(complete)complete(false);return;}refreshing=true;const auto auth=authGeneration;const auto ticket=++accountFlight;
        api("/me","GET",{},[this,withWelcome,complete,auth,ticket](int status,QJsonDocument doc){if(ticket!=accountFlight||auth!=authGeneration)return;auto user=doc.object()["user"].toObject();if(status!=200||user["id"].toString()!=session.accountID||!user["hasAssignedLink"].isBool()||!user["hasActiveSubscription"].isBool()){refreshing=false;boot=false;working=false;if(status==200)revoke();fail();if(complete)complete(false);return;}auto package=user["activePackage"].toObject();auto title=Catalog::clean(package["title"],256);auto end=date(package["endsAt"]);bool blocked=user["status"].toString()=="blocked",eligible=!blocked&&user["hasAssignedLink"].toBool()&&user["hasActiveSubscription"].toBool()&&end>now();
            currentAccount={{"packageTitle",title},{"canPlay",false},{"trial",title==QString::fromUtf8("3 Saat Deneme")||title==QString::fromUtf8("24 Saat Test")},{"expiresAt",end},{"message",eligible?QString::fromUtf8("İzleme erişimin açık."):blocked?QString::fromUtf8("Hesabın için destek ekibimizle iletişime geç."):!user["hasAssignedLink"].toBool()?QString::fromUtf8("İçerik bağlantın henüz hazır değil."):QString::fromUtf8("Aktif izleme erişimin bulunmuyor.")}};
            auto finish=[this,withWelcome,complete,auth,ticket](bool access){if(auth!=authGeneration||ticket!=accountFlight)return;currentAccount["canPlay"]=access;if(access)currentAccount["expiresAt"]=deadline;auto done=[this,complete,ticket]{if(ticket!=accountFlight)return;refreshing=false;working=false;boot=false;failure.clear();changed();if(!currentScope.isEmpty()){loadLibrary(false);loadRoute(false);}if(complete)complete(true);};if(withWelcome)api("/me/welcome-offer","GET",{},[this,done,ticket](int status,QJsonDocument doc){if(ticket!=accountFlight)return;if(status==200&&!installWelcome(doc.object()))fail(QString::fromUtf8("Karşılama bilgileri doğrulanamadı."));done();});else done();};
            if(!eligible){revoke();finish(false);return;}api("/me/provider-session","GET",{},[this,finish,ticket](int status,QJsonDocument doc){if(ticket!=accountFlight)return;bool valid=status==200&&installProvider(doc.object());if(!valid)revoke();finish(valid);});
        });
    }
    void providerRequest(QString action,QString id,Reply callback){auto scope=currentScope;auto generation=sourceGeneration;if(!sourceValid(scope,generation)){callback(403,{});return;}static const QSet<QString> actions{"get_vod_categories","get_vod_streams","get_series_categories","get_series","get_live_categories","get_live_streams","get_series_info","get_short_epg"};if(!actions.contains(action)){callback(0,{});return;}QUrl u(providerOrigin+"/player_api.php");QByteArray encodedQuery="username="+QUrl::toPercentEncoding(username)+"&password="+QUrl::toPercentEncoding(password)+"&action="+QUrl::toPercentEncoding(action);if(!id.isEmpty()){if(Catalog::id(id).isEmpty()){callback(0,{});return;}encodedQuery+="&"+QByteArray(action=="get_series_info"?"series_id":"stream_id")+"="+QUrl::toPercentEncoding(id);}if(action=="get_short_epg")encodedQuery+="&limit=24";u.setQuery(QString::fromLatin1(encodedQuery),QUrl::StrictMode);request(u,"GET",{},{},[this,scope,generation,callback](int status,QJsonDocument doc){if(!sourceValid(scope,generation))return;if(status==401||status==403){revoke();callback(403,{});return;}callback(status,doc);},scope);}
    QVariantList all()const{QVariantList rows;for(const auto&kind:QStringList{"movie","series","live"})rows+=catalogs.value(kind);return rows;}
    void rebuild(){
        QVariantList rows;if(currentRoute=="home"||currentRoute=="search")rows=all();else if(currentRoute=="favorites")rows=favoriteItems;else if(currentRoute=="movies")rows=catalogs.value("movie");else if(currentRoute=="series")rows=catalogs.value("series");else if(currentRoute=="live")rows=catalogs.value("live");
        auto ticket=++viewGeneration;auto route=currentRoute,query=searchQuery,category=selectedCategory,country=selectedCountry;auto timestamp=now();
        auto *watcher=new QFutureWatcher<QVariantMap>(q);QObject::connect(watcher,&QFutureWatcher<QVariantMap>::finished,q,[this,watcher,ticket]{auto result=watcher->result();watcher->deleteLater();if(ticket!=viewGeneration)return;filtered=result["filtered"].toList();visibleItems=filtered.mid(0,visible);currentCategories=result["categories"].toList();currentCountries=result["countries"].toList();currentShelves=result["shelves"].toList();currentHero=result["hero"].toMap();changed();});
        watcher->setFuture(QtConcurrent::run([rows,route,query,category,country,timestamp]{return QVariantMap{{"filtered",Catalog::filter(rows,query,category,country)},{"categories",Catalog::categories(rows,route=="live")},{"countries",route=="live"?Catalog::countries(rows):QVariantList{}},{"shelves",query.isEmpty()&&category.isEmpty()&&country.isEmpty()?Catalog::shelves(route,rows,timestamp):QVariantList{}},{"hero",query.isEmpty()?Catalog::hero(route,rows,timestamp):QVariantMap{}}};}));
        changed();
    }
    QVariantList referenceValues() const {QVariantList result;for(const auto &ref:references)result.append(ref);return result;}
    void installCatalog(const QString &kind,QVariantList rows){
        QHash<QString,int> index;index.reserve(rows.size());
        for(qsizetype i=0;i<rows.size();++i){const auto item=rows.at(i).toMap();index.insert(item.value("id").toString(),int(i));}
        catalogs.insert(kind,std::move(rows));catalogIndices.insert(kind,std::move(index));
    }
    QVariantMap indexedItem(const QString &kind,const QString &id) const {
        const auto offset=catalogIndices.value(kind).value(id,-1);const auto rows=catalogs.value(kind);
        return offset>=0&&offset<rows.size()?rows.at(offset).toMap():QVariantMap{};
    }
    void resolveFavorites(){
        QVariantList resolved;QSet<QString> seen;
        for(const auto &reference:references){
            const auto kind=reference.value("kind").toString();auto id=reference.value("id").toString();if(kind=="live")id=liveAliases.value(id,id);
            const auto item=indexedItem(kind,id);const auto key=Catalog::key(item);
            if(!item.isEmpty()&&!seen.contains(key)){resolved.append(item);seen.insert(key);}
        }
        if(libraryScope==currentScope){favoriteItems=resolved;cache.write(currentScope,"library",QVariantMap{{"favorites",favoriteItems},{"references",referenceValues()},{"watched",QStringList(watched.values())}},deadline,now());}rebuild();
    }
    void ensureCatalog(QString kind,bool force,Done done={}){
        auto scope=currentScope;auto generation=sourceGeneration;if(!sourceValid(scope,generation)){if(done)done(false);return;}
        if(!force){if(catalogs.contains(kind)){if(done)done(true);if(now()-catalogSaved.value(kind)<6LL*3600000)return;ensureCatalog(kind,true);return;}if(!diskChecked.contains(kind)){
                diskChecked.insert(kind);catalogFlights[kind]={};if(done)catalogFlights[kind].append(done);working=true;changed();
                auto store=cache;auto expiry=deadline;auto timestamp=now();auto exclusions=excluded;auto *watcher=new QFutureWatcher<QVariantMap>(q);
                QObject::connect(watcher,&QFutureWatcher<QVariantMap>::finished,q,[this,watcher,scope,generation,kind]{auto result=watcher->result();watcher->deleteLater();if(!sourceValid(scope,generation))return;auto callbacks=catalogFlights.take(kind);working=!catalogFlights.isEmpty();if(result["hit"].toBool()){installCatalog(kind,result["rows"].toList());catalogSaved[kind]=result["saved"].toLongLong();if(kind=="live"){liveAliases.clear();auto map=result["aliases"].toMap();for(auto i=map.begin();i!=map.end();++i)liveAliases[i.key()]=i.value().toString();}resolveFavorites();for(const auto&cb:callbacks)cb(true);if(now()-catalogSaved.value(kind)>=6LL*3600000)ensureCatalog(kind,true);}else {if(callbacks.isEmpty())ensureCatalog(kind,true);else for(const auto&cb:callbacks)ensureCatalog(kind,true,cb);}});
                watcher->setFuture(QtConcurrent::run([store,scope,kind,expiry,timestamp,exclusions]{qint64 saved=0;auto hit=store.read(scope,"catalog-"+kind,expiry,timestamp,&saved);if(!hit.isValid())return QVariantMap{{"hit",false}};auto raw=hit.toList();if(raw.size()>50000)return QVariantMap{{"hit",false}};for(auto &v:raw){auto item=v.toMap();if(!Catalog::validItem(item,scope)||item["kind"]!=kind)return QVariantMap{{"hit",false}};item["_search"]=Catalog::search(item["title"].toString()+' '+item["sourceTitle"].toString()+' '+item["categoryName"].toString());v=item;}QHash<QString,QString> aliases;auto rows=kind=="live"?Catalog::curateLive(raw,exclusions,&aliases):raw;QVariantMap mapping;for(auto i=aliases.begin();i!=aliases.end();++i)mapping[i.key()]=i.value();return QVariantMap{{"hit",true},{"saved",saved},{"rows",rows},{"aliases",mapping}};}));
                return;
            }}
        if(catalogFlights.contains(kind)){if(done)catalogFlights[kind].append(done);return;}catalogFlights[kind]={};if(done)catalogFlights[kind].append(done);working=true;changed();
        struct Pair{QJsonArray rows,groups;int pending=2;bool valid=true;};auto pair=std::make_shared<Pair>();auto receive=[this,pair,scope,generation,kind](bool groups,int status,QJsonDocument doc){if(!sourceValid(scope,generation))return;if(status!=200||!doc.isArray())pair->valid=false;else if(groups)pair->groups=doc.array();else pair->rows=doc.array();if(--pair->pending)return;
            if(!pair->valid){auto callbacks=catalogFlights.take(kind);working=!catalogFlights.isEmpty();fail(QString::fromUtf8("İçerikler yüklenemedi. Yeniden dene."));for(const auto&cb:callbacks)cb(false);return;}
            auto *watcher=new QFutureWatcher<QVariantMap>(q);auto exclusions=excluded;const auto expiry=deadline,saved=now();
            QObject::connect(watcher,&QFutureWatcher<QVariantMap>::finished,q,[this,watcher,kind,scope,generation]{auto result=watcher->result();watcher->deleteLater();if(!sourceValid(scope,generation))return;bool success=result.value("ok").toBool();if(success){cache.writeEncoded(scope,"catalog-"+kind,result["cache"].toByteArray());installCatalog(kind,result["rows"].toList());if(kind=="live"){liveAliases.clear();auto map=result["aliases"].toMap();for(auto i=map.begin();i!=map.end();++i)liveAliases[i.key()]=i.value().toString();}catalogSaved[kind]=now();resolveFavorites();}auto callbacks=catalogFlights.take(kind);working=!catalogFlights.isEmpty();if(!success)fail(QString::fromUtf8("İçerikler yüklenemedi. Yeniden dene."));else failure.clear();rebuild();for(const auto&callback:callbacks)callback(success);});
            watcher->setFuture(QtConcurrent::run([kind,pair,scope,exclusions,expiry,saved]{try{auto raw=Catalog::parse(kind,pair->rows,pair->groups,scope);QHash<QString,QString> aliases;auto rows=kind=="live"?Catalog::curateLive(raw,exclusions,&aliases):raw;QVariantMap map;for(auto i=aliases.begin();i!=aliases.end();++i)map[i.key()]=i.value();return QVariantMap{{"ok",true},{"cache",MetadataStore::encode(scope,raw,expiry,saved)},{"rows",rows},{"aliases",map}};}catch(...){return QVariantMap{{"ok",false}};}}));
        };
        providerRequest(kind=="movie"?"get_vod_categories":kind=="series"?"get_series_categories":"get_live_categories",{},[receive](int s,QJsonDocument d){receive(true,s,d);});providerRequest(kind=="movie"?"get_vod_streams":kind=="series"?"get_series":"get_live_streams",{},[receive](int s,QJsonDocument d){receive(false,s,d);});
    }
    void loadRoute(bool force){if(currentScope.isEmpty()){rebuild();return;}if(currentRoute=="movies")ensureCatalog("movie",force);else if(currentRoute=="series")ensureCatalog("series",force);else if(currentRoute=="live")ensureCatalog("live",force);else if(currentRoute=="home"||currentRoute=="search"){for(const auto&kind:QStringList{"movie","series","live"})ensureCatalog(kind,force);}else if(currentRoute=="favorites")loadLibrary(force);rebuild();}
    QVariantMap reference(const QVariantMap &item)const{QVariantMap ref{{"source","personal"},{"sourceVersion",version},{"kind",item.value("kind")},{"id",item.value("id")}};if(!item.value("extension").toString().isEmpty())ref["extension"]=item.value("extension");if(item.value("kind")=="episode")ref["seriesId"]=item.value("seriesID");return ref;}
    void loadLibrary(bool force){auto scope=currentScope;auto generation=sourceGeneration;if(!sourceValid(scope,generation))return;if(libraryScope!=scope){auto hit=cache.read(scope,"library",deadline,now()).toMap();auto favorites=hit["favorites"].toList();bool valid=favorites.size()<=500;for(const auto&v:favorites)if(!Catalog::validItem(v.toMap(),scope)||v.toMap()["kind"]=="episode"||(v.toMap()["kind"]=="live"&&excluded.contains(v.toMap()["id"].toString())))valid=false;if(valid){favoriteItems=favorites;for(const auto&v:hit["references"].toList()){auto r=v.toMap();if(r["sourceVersion"]==version&&QStringList{"live","movie","series"}.contains(r["kind"].toString())&&!Catalog::id(QJsonValue::fromVariant(r["id"])).isEmpty())references[r["kind"].toString()+"::"+r["id"].toString()]=r;}for(const auto&v:hit["watched"].toStringList())watched.insert(v);libraryScope=scope;changed();}}
        if(!force&&libraryScope==scope&&references.isEmpty()&&!favoriteItems.isEmpty())return;int before=revision;api("/me/personal-library","GET",{},[this,scope,generation,before](int status,QJsonDocument doc){if(!sourceValid(scope,generation)||status!=200)return;auto raw=doc.object();if(!raw["favorites"].isArray()||!raw["watched"].isArray()||raw["favorites"].toArray().size()>500||raw["watched"].toArray().size()>20000)return;if(before!=revision)return;QHash<QString,QVariantMap> refs;QSet<QString> watchedKeys;auto consume=[this](const QJsonArray &rows,bool episodes,QHash<QString,QVariantMap> &refs,QSet<QString> &watched){for(const auto&v:rows){const auto r=v.toObject();auto kind=r["kind"].toString(),id=Catalog::id(r["id"]),series=Catalog::id(r["seriesId"]);if(r["source"].toString()!="personal"||r["sourceVersion"].toString()!=version||id.isEmpty()||episodes!=(kind=="episode")||!QStringList{"live","movie","series","episode"}.contains(kind)||(episodes?series.isEmpty():r.contains("seriesId")))continue;auto k=kind+':'+series+':'+id;if(episodes)watched.insert(k);else refs[k]=r.toVariantMap();}};consume(raw["favorites"].toArray(),false,refs,watchedKeys);consume(raw["watched"].toArray(),true,refs,watchedKeys);references=refs;watched=watchedKeys|watchedWrites;libraryScope=scope;revision++;QSet<QString> kinds;for(auto r:references)kinds.insert(r["kind"].toString());for(const auto&kind:kinds)ensureCatalog(kind,false);resolveFavorites();});
    }
    QVariantMap knownItem(const QVariantMap &requested) const {
        const auto kind=requested.value("kind").toString();
        if(kind!="episode")return indexedItem(kind,requested.value("id").toString());
        const auto rows=Catalog::episodes(details.value(requested.value("seriesID").toString()));
        for(const auto &value:rows){const auto item=value.toMap();if(Catalog::key(item)==Catalog::key(requested)&&item.value("scope")==currentScope)return item;}return {};
    }
    void canonical(QVariantMap requested,std::function<void(QVariantMap)> done){auto scope=currentScope;auto gen=sourceGeneration;if(!Catalog::validItem(requested,scope)||!sourceValid(scope,gen)){done({});return;}auto kind=requested["kind"].toString();if(kind=="episode"){QVariantMap parent{{"kind","series"},{"id",requested["seriesID"]},{"scope",scope}};getDetail(parent,[this,requested,done](QVariantMap detail){for(const auto&v:Catalog::episodes(detail)){auto i=v.toMap();if(i["id"]==requested["id"]){done(i);return;}}done({});});return;}ensureCatalog(kind,false,[this,requested,done,scope,gen,kind](bool ok){if(!ok||!sourceValid(scope,gen)){done({});return;}auto id=requested.value("id").toString();if(kind=="live")id=liveAliases.value(id,id);done(indexedItem(kind,id));});}
    void getDetail(QVariantMap parent,std::function<void(QVariantMap)> done,std::function<bool()> eligible={},bool force=false,bool quiet=false){
        const auto scope=currentScope;const auto generation=sourceGeneration,epoch=detailEpoch;
        canonical(parent,[this,done,scope,generation,epoch,eligible,force,quiet](QVariantMap verified){
            if((eligible&&!eligible())||epoch!=detailEpoch||!sourceValid(scope,generation))return;
            if(verified.isEmpty()||verified.value("kind")!="series"){done({});return;}
            const auto id=verified.value("id").toString();
            auto valid=[&](const QVariantMap &cached){
                const auto series=cached.value("series").toMap();if(series.value("id").toString()!=id||!Catalog::validItem(series,scope))return false;
                const auto rows=Catalog::episodes(cached);if(rows.size()>5000)return false;
                for(const auto &value:rows){const auto item=value.toMap();if(!Catalog::validItem(item,scope)||item.value("seriesID").toString()!=id)return false;}return true;
            };
            if(!force){
                QVariantMap cached; qint64 saved=0;
                if(details.contains(id)){saved=detailSaved.value(id);if(saved<=now()&&now()-saved<7LL*86400000)cached=details.value(id);}
                if(cached.isEmpty()&&!bypassDetailDisk){auto hit=cache.read(scope,"series-"+id,deadline,now(),&saved).toMap();if(valid(hit))cached=hit;}
                if(!cached.isEmpty()){
                    details[id]=cached;detailSaved[id]=saved;done(cached);
                    if(now()-saved>=6LL*3600000&&!detailRefreshing.contains(id)){
                        auto update=[this,id,scope,generation,epoch](QVariantMap updated){
                            if(updated.isEmpty()||epoch!=detailEpoch||!sourceValid(scope,generation))return;
                            const auto selected=detail.value("series").toMap();
                            if(selected.value("id").toString()==id&&selected.value("scope").toString()==scope){detail=updated;changed();}
                        };
                        getDetail(verified,update,{},true,true);
                    }
                    return;
                }
            }
            detailRefreshing.insert(id);
            providerRequest("get_series_info",id,[this,verified,id,scope,generation,epoch,done,eligible,quiet](int status,QJsonDocument doc){
                if(epoch!=detailEpoch||!sourceValid(scope,generation))return;
                detailRefreshing.remove(id);if(eligible&&!eligible())return;
                try{
                    if(status!=200||!doc.isObject())throw std::runtime_error("detail");
                    auto result=Catalog::series(doc.object(),verified);
                    if(details.size()>=24&&!details.contains(id)){auto oldest=detailSaved.begin();for(auto i=detailSaved.begin();i!=detailSaved.end();++i)if(i.value()<oldest.value())oldest=i;details.remove(oldest.key());detailSaved.erase(oldest);}
                    details[id]=result;detailSaved[id]=now();cache.write(scope,"series-"+id,result,deadline,now());done(result);
                }catch(...){if(!quiet){fail(QString::fromUtf8("Bölümler yüklenemedi."));done({});}}
            });
        });
    }
    void playback(QVariantMap request,bool exact){int serial=++playbackSerial;auto before=currentScope;if(deadline&&deadline<=now()){revoke();return;}if(!Catalog::validItem(request,before))return;refreshAccount(false,[this,request,before,serial,exact](bool ok){if(!ok||serial!=playbackSerial||currentScope!=before||!currentAccount["canPlay"].toBool())return;auto emitMedia=[this,serial,before](QVariantMap item){if(item.isEmpty()||serial!=playbackSerial||!sourceValid(before,sourceGeneration))return;auto kind=item["kind"].toString();if(kind=="series"||!QSet<QString>{"ts","m3u8","mp4","mkv","avi"}.contains(item["extension"].toString())||(kind=="live"&&excluded.contains(item["id"].toString())))return;auto user=QString::fromLatin1(QUrl::toPercentEncoding(username)),pass=QString::fromLatin1(QUrl::toPercentEncoding(password));QUrl url(providerOrigin+'/'+(kind=="episode"?"series":kind)+'/'+user+'/'+pass+'/'+item["id"].toString()+'.'+item["extension"].toString(),QUrl::StrictMode);if(!url.isValid())return;QVariantMap media{{"item",item},{"url",url.toString(QUrl::FullyEncoded)},{"expiresAt",deadline},{"scope",currentScope},{"resumeMs",cache.position(item)},{"next",q->nextEpisode(item)}};failure.clear();changed();emit q->playbackReady(media);};if(request["kind"]=="series"&&!exact){getDetail(request,[this,emitMedia](QVariantMap d){auto rows=Catalog::episodes(d);auto selected=cache.latestEpisode(rows);if(selected.isEmpty())for(const auto&v:rows){auto i=v.toMap();if(!watched.contains(Catalog::key(i))){selected=i;break;}}if(selected.isEmpty()&&!rows.isEmpty())selected=rows.first().toMap();emitMedia(selected);});}else canonical(request,emitMedia);});}
};

DesktopRepository::DesktopRepository(QObject *parent):DesktopRepository(RepositoryOptions{},parent){}
DesktopRepository::DesktopRepository(const RepositoryOptions &options,QObject *parent):QObject(parent),d(std::make_unique<Private>(this,options)){}
DesktopRepository::~DesktopRepository(){d->authGeneration++;d->abort();}
#define GET(type,name,value) type DesktopRepository::name() const{return value;}
GET(bool,bootstrapping,d->boot) GET(bool,authenticated,d->session.valid()) GET(bool,busy,d->working||d->refreshing||d->detailLoading) GET(bool,loadingMore,d->moreLoading) GET(bool,hasMore,d->filtered.size()>d->visibleItems.size()) GET(bool,welcomeVisible,d->offer.value("showPrompt").toBool()) GET(bool,posterSoundEnabled,d->sound)
GET(QString,error,d->failure) GET(QString,route,d->currentRoute) GET(QString,query,d->searchQuery) GET(QString,category,d->selectedCategory) GET(QString,country,d->selectedCountry) GET(QString,codeSuffix,d->session.codeSuffix) GET(QString,scope,d->currentScope)
GET(QVariantMap,account,d->currentAccount) GET(QVariantMap,hero,d->currentHero) GET(QVariantMap,seriesDetail,d->detail) GET(QVariantMap,welcome,d->offer) GET(QVariantList,shelves,d->currentShelves) GET(QVariantList,items,d->visibleItems) GET(QVariantList,categories,d->currentCategories) GET(QVariantList,countries,d->currentCountries) GET(QVariantList,favorites,d->favoriteItems) GET(QVariantList,programmes,d->epgRows) GET(int,libraryRevision,d->revision) GET(qint64,expiresAt,d->deadline)
#undef GET
QString DesktopRepository::sectionTitle()const {static const QHash<QString,QString> titles{{"home",QString::fromUtf8("Ana Sayfa")},{"movies",QString::fromUtf8("Filmler")},{"series",QString::fromUtf8("Diziler")},{"live",QString::fromUtf8("Canlı TV")},{"favorites",QString::fromUtf8("Listem")},{"account",QString::fromUtf8("Hesabım")},{"search",QString::fromUtf8("Ara")}};return titles.value(d->currentRoute);}
void DesktopRepository::restore(){d->session=d->vault.load();d->boot=true;d->changed();if(!d->session.valid()){d->boot=false;d->changed();return;}d->refreshAccount(true);}
void DesktopRepository::login(QString code){code=code.trimmed().toUpper();if(!QRegularExpression("^[A-Z0-9]{16}$").match(code).hasMatch()){d->fail(QString::fromUtf8("16 karakterli giriş kodunu kontrol et."));return;}logout();d->boot=false;d->working=true;d->failure.clear();d->changed();auto installation=d->vault.installationID();if(installation.isEmpty()){d->working=false;d->fail(QString::fromUtf8("Güvenli oturum kaydı oluşturulamadı."));return;}d->request(d->options.apiBase.resolved(QUrl("/auth/login-by-code")),"POST",{{"code",code},{"deviceName","Flixify Windows"},{"platform","windows"},{"installationId",installation}},{},[this](int status,QJsonDocument doc){auto session=tokens(doc.object());if(status!=200||!session.valid()){d->working=false;d->fail(status==401?QString::fromUtf8("Giriş kodun doğrulanamadı."):QString::fromUtf8("Giriş tamamlanamadı. Yeniden dene."));return;}if(!d->vault.save(session)){d->working=false;d->fail(QString::fromUtf8("Güvenli oturum kaydı oluşturulamadı."));return;}d->session=session;d->refreshAccount(true);});}
void DesktopRepository::logout(){d->authGeneration++;d->accountFlight++;d->rotationTicket++;d->rotating=false;d->rotationWaiters.clear();d->abort();d->clearSource();d->vault.clear();d->session={};d->currentAccount.clear();d->offer.clear();d->working=false;d->refreshing=false;d->rotating=false;d->rotationWaiters.clear();d->boot=false;d->failure.clear();d->currentRoute="home";d->searchQuery.clear();d->selectedCategory.clear();d->selectedCountry.clear();emit accessRevoked();d->changed();}
void DesktopRepository::navigate(QString route){if(!QStringList{"home","movies","series","live","favorites","account","search"}.contains(route))return;d->detailSelection++;d->epgSelection++;d->detailLoading=false;d->epgRows.clear();d->currentRoute=route;d->visible=96;d->searchQuery.clear();d->selectedCategory.clear();d->selectedCountry.clear();d->detail.clear();d->failure.clear();d->loadRoute(false);}
void DesktopRepository::setQuery(QString query){if(query.size()>256)query=query.left(256);d->searchQuery=query;d->visible=96;d->queryTimer.start();d->changed();}
void DesktopRepository::setCategory(QString c){d->selectedCategory=c=="all"?QString():c;d->visible=96;d->rebuild();}
void DesktopRepository::setCountry(QString c){d->selectedCountry=c=="all"?QString():c;d->visible=96;d->rebuild();}
void DesktopRepository::loadMore(){if(!hasMore()||d->moreLoading)return;d->moreLoading=true;d->changed();QTimer::singleShot(0,this,[this]{d->visible+=96;d->moreLoading=false;d->visibleItems=d->filtered.mid(0,d->visible);d->changed();});}
void DesktopRepository::refresh(){d->detailSelection++;d->detailLoading=false;d->detailEpoch++;d->details.clear();d->detailSaved.clear();d->detailRefreshing.clear();d->bypassDetailDisk=true;d->failure.clear();d->refreshAccount(true,[this](bool ok){if(ok){d->bypassDetailDisk=true;d->loadRoute(true);}});}
void DesktopRepository::playItem(QVariantMap item){d->playback(std::move(item),false);}
void DesktopRepository::refreshPlayback(QVariantMap item){d->playback(std::move(item),true);}
void DesktopRepository::playAdjacentLive(QVariantMap current,int direction){
    if(current.value("kind")!="live"||direction==0||!d->sourceValid(current.value("scope").toString(),d->sourceGeneration))return;
    auto rows=d->catalogs.value("live");if(d->currentRoute=="live")rows=Catalog::filter(rows,{},d->selectedCategory,d->selectedCountry);
    if(rows.size()<2)return;auto id=d->liveAliases.value(current.value("id").toString(),current.value("id").toString());
    for(qsizetype i=0;i<rows.size();i++)if(rows[i].toMap().value("id").toString()==id){auto target=(i+(direction<0?-1:1)+rows.size())%rows.size();playItem(rows[target].toMap());return;}
}
void DesktopRepository::showSeries(QVariantMap item){
    if(item.value("kind")!="series")return;
    const auto ticket=++d->detailSelection,auth=d->authGeneration,generation=d->sourceGeneration;const auto scope=d->currentScope;
    auto current=[this,ticket,auth,generation,scope]{return ticket==d->detailSelection&&d->apiContextValid(auth,generation,scope);};
    d->detail.clear();d->detailLoading=true;d->failure.clear();d->changed();
    d->getDetail(item,[this,current](QVariantMap detail){if(!current())return;d->detailLoading=false;d->detail=detail;d->changed();},current);
}
bool DesktopRepository::isFavorite(QVariantMap item)const {if(item.value("scope").toString()!=d->currentScope)return false;auto kind=item.value("kind").toString(),id=item.value("id").toString();if(kind=="episode"){kind="series";id=item.value("seriesID").toString();}for(const auto&v:d->favoriteItems){auto i=v.toMap();if(i["kind"].toString()==kind&&i["id"].toString()==id)return true;}return false;}
void DesktopRepository::toggleFavorite(QVariantMap item){if(item["kind"]=="episode"){item["kind"]="series";item["id"]=item["seriesID"];item["seriesID"]=QString();}bool remove=isFavorite(item);d->canonical(item,[this,remove](QVariantMap verified){if(verified.isEmpty())return;auto scope=d->currentScope;auto gen=d->sourceGeneration;QList<QVariantMap> refs;if(remove){for(const auto&ref:d->references){auto id=ref["id"].toString();if(ref["kind"]==verified["kind"]&&(verified["kind"]=="live"?d->liveAliases.value(id,id)==verified["id"].toString():id==verified["id"].toString()))refs.append(ref);}}else refs.append(d->reference(verified));auto index=std::make_shared<int>(0);auto sequence=std::make_shared<std::function<void()>>();*sequence=[this,scope,gen,remove,refs,index,sequence]{if(!d->sourceValid(scope,gen)){*sequence={};return;}if(*index>=refs.size()){d->revision++;d->resolveFavorites();*sequence={};return;}auto ref=refs[*index];d->api("/me/personal-library/favorites",remove?"DELETE":"PUT",{{"ref",QJsonObject::fromVariantMap(ref)}},[this,scope,gen,remove,ref,index,sequence](int status,QJsonDocument doc){if(!d->sourceValid(scope,gen)){*sequence={};return;}if(status<200||status>=300||!doc.object()["ok"].isBool()||!doc.object()["ok"].toBool()){d->fail(QString::fromUtf8("Listen güncellenemedi."));*sequence={};return;}auto k=ref["kind"].toString()+"::"+ref["id"].toString();if(remove)d->references.remove(k);else d->references[k]=ref;d->revision++;(*index)++;(*sequence)();});};(*sequence)();});}
QVariantMap DesktopRepository::nextEpisode(QVariantMap item)const {if(item.value("scope").toString()!=d->currentScope||item.value("kind")!="episode")return {};auto rows=Catalog::episodes(d->details.value(item.value("seriesID").toString()));for(qsizetype i=0;i+1<rows.size();i++)if(Catalog::key(rows[i].toMap())==Catalog::key(item))return rows[i+1].toMap();return {};}
void DesktopRepository::saveProgress(QVariantMap item,qint64 position,qint64 duration,bool ended){Q_UNUSED(ended);if(!d->sourceValid(item.value("scope").toString(),d->sourceGeneration)||!Catalog::validItem(item,d->currentScope)||position<0||duration<=0)return;item=d->knownItem(item);if(item.isEmpty())return;d->cache.saveProgress(item,position,duration,d->now());if(item["kind"]!="episode"||position<duration-qMin(qint64(120000),duration/20))return;auto k=Catalog::key(item);if(d->watched.contains(k)||d->watchedWrites.contains(k))return;auto scope=d->currentScope;auto gen=d->sourceGeneration;d->watchedWrites.insert(k);d->watched.insert(k);d->revision++;d->api("/me/personal-library/watched","PUT",{{"ref",QJsonObject::fromVariantMap(d->reference(item))}},[this,k,scope,gen](int status,QJsonDocument doc){if(!d->sourceValid(scope,gen))return;d->watchedWrites.remove(k);if(status<200||status>=300||!doc.object()["ok"].toBool())d->watched.remove(k);d->revision++;d->resolveFavorites();});}
void DesktopRepository::loadEpg(QVariantMap item){
    if(item.value("kind")!="live")return;
    const auto ticket=++d->epgSelection,auth=d->authGeneration,generation=d->sourceGeneration;const auto scope=d->currentScope;
    auto current=[this,ticket,auth,generation,scope]{return ticket==d->epgSelection&&d->apiContextValid(auth,generation,scope);};
    d->epgRows.clear();d->changed();
    d->canonical(item,[this,current](QVariantMap verified){if(!current()||verified.isEmpty())return;
        d->providerRequest("get_short_epg",verified.value("id").toString(),[this,current](int status,QJsonDocument doc){if(!current())return;
            try{if(status!=200)throw std::runtime_error("epg");d->epgRows=Catalog::epg(doc.object());}catch(...){d->epgRows.clear();}d->changed();
        });
    });
}
void DesktopRepository::chooseWelcome(bool monthly,int users){if(!welcomeVisible()||d->working||!QList<int>{1,2}.contains(users))return;d->working=true;d->changed();d->api("/me/welcome-offer/choice","POST",{{"choice",monthly?"monthly":"trial"}},[this,monthly,users](int status,QJsonDocument doc){d->working=false;if(status!=200||!d->installWelcome(doc.object())||welcomeVisible()){d->fail(QString::fromUtf8("Seçimin kaydedilemedi. Yeniden dene."));return;}d->changed();if(monthly)QDesktopServices::openUrl(QUrl(QString("https://flixify.vip/paketler?welcome=1&users=%1").arg(users)));d->refreshAccount(false);});}
void DesktopRepository::openWebsite(QString destination){static const QHash<QString,QString> paths{{"register","/kayit-ol"},{"packages","/paketler"},{"support","/iletisim"},{"downloads","/indir"}};if(paths.contains(destination))QDesktopServices::openUrl(QUrl("https://flixify.vip"+paths.value(destination)));}
void DesktopRepository::setPosterSoundEnabled(bool enabled){d->sound=enabled;QSettings preferences((d->options.storageDirectory.isEmpty()?defaultStorage():d->options.storageDirectory)+"/preferences.ini",QSettings::IniFormat);preferences.setValue("posterSoundEnabled",enabled);d->changed();}
