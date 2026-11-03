#include "analytics.h"
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QRegularExpression>
#include <QSettings>
#include <QSet>
#include <QUuid>
#include <algorithm>
#include <cmath>

namespace {
bool matches(const QString &value, const QString &pattern) {
    return QRegularExpression(pattern).match(value).hasMatch();
}
QString uuid() { return QUuid::createUuid().toString(QUuid::WithoutBraces).toLower(); }
QString digest(const QString &value) { return QString::fromLatin1(QCryptographicHash::hash(value.toUtf8(), QCryptographicHash::Sha256).toHex().left(24)); }
}

DesktopAnalytics::DesktopAnalytics(AnalyticsOptions options, QObject *parent)
    : QObject(parent), options_(std::move(options)), network_(this) {
    if (!options_.clock) options_.clock=[] { return QDateTime::currentMSecsSinceEpoch(); };
    const auto &u = options_.apiBase;
    const bool loopback = options_.allowLoopbackForTests && u.scheme() == "http" && (u.host() == "127.0.0.1" || u.host() == "localhost");
    if (!((u.scheme() == "https" && u.host() == "api.flixify.vip") || loopback) || !u.userInfo().isEmpty() || !u.path().isEmpty() || u.hasQuery() || u.hasFragment())
        options_.apiBase = QUrl("https://api.flixify.vip");
    QSettings settings(options_.preferencesPath, QSettings::IniFormat);
    choice_ = "accepted";
    clientId_ = settings.value("analytics/v1/clientId").toString();
    if (!matches(clientId_, "^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")) clientId_.clear();
    const auto storedOwners=settings.value("analytics/v1/revokedOwners").toMap();
    for (const auto &id : settings.value("analytics/v1/revoked").toStringList())
        if (matches(id, "^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$") && matches(storedOwners.value(id).toString(),"^[a-f0-9]{24}$") && !revoked_.contains(id) && revoked_.size() < 100) {revoked_.append(id);revokedOwners_.insert(id,storedOwners.value(id));}
    ensureIdentity();
    persist();
    flushTimer_.setInterval(10000);
    connect(&flushTimer_, &QTimer::timeout, this, [this] { revokePending(); flush(); });
    flushTimer_.start();
}
DesktopAnalytics::~DesktopAnalytics() {
    flushTimer_.stop();
    for (const auto &reply : replies_) if (reply) { reply->disconnect(this); reply->abort(); }
}
void DesktopAnalytics::recordLogoutAndDetach() {
    QJsonObject body;const auto token=token_;
    if(available_&&choice_=="accepted"&&!token.isEmpty()){
        record("logout");QJsonArray events;
        for(auto it=pending_.crbegin();it!=pending_.crend()&&events.size()<20;++it)if(it->sessionId==sessionId_)events.prepend(it->payload);
        body={{"schema",1},{"consentVersion",1},{"clientPlatform","windows"},{"clientId",clientId_},{"sessionId",sessionId_},{"events",events}};
        while(QJsonDocument(body).toJson(QJsonDocument::Compact).size()>32768&&events.size()>1){events.removeFirst();body.insert("events",events);}
    }
    cancelFinal(false);cancelBatch();
    const auto client=clientId_,account=account_;
    pending_.clear();token_.clear();account_.clear();clientId_.clear();sessionId_=0;lastEventAt_=0;persist();
    if(body.isEmpty())return;
    finalClientId_=client;finalToken_=token;finalAccount_=account;const auto generation=finalGeneration_;
    final_=request("/me/analytics/events","POST",body,token,[this,generation](int,QJsonObject){if(generation!=finalGeneration_)return;final_.clear();finalClientId_.clear();finalToken_.clear();finalAccount_.clear();});
}
void DesktopAnalytics::persist() {
    QSettings settings(options_.preferencesPath, QSettings::IniFormat);
    settings.setValue("analytics/v1/choice", choice_);
    if (clientId_.isEmpty()) settings.remove("analytics/v1/clientId"); else settings.setValue("analytics/v1/clientId", clientId_);
    settings.setValue("analytics/v1/revoked", revoked_);
    settings.setValue("analytics/v1/revokedOwners",revokedOwners_);
}
void DesktopAnalytics::ensureIdentity() {
    if (choice_ != "accepted") return;
    if (clientId_.isEmpty()) { clientId_ = uuid(); persist(); }
    if (!sessionId_) sessionId_ = options_.clock()/1000;
}
void DesktopAnalytics::cancelBatch() {
    ++generation_;
    auto old = batch_; batch_.clear();
    if (old) old->abort();
}
void DesktopAnalytics::appendRevocation(const QString &id,const QString &account) {
    if(id.isEmpty()||account.isEmpty())return;
    if(!revoked_.contains(id)){while(revoked_.size()>=100)revokedOwners_.remove(revoked_.takeFirst());revoked_.append(id);}
    revokedOwners_.insert(id,digest(account));persist();
}
void DesktopAnalytics::removeRevocation(const QString &id,const QString &owner) {
    if(revokedOwners_.value(id).toString()!=owner)return;
    revoked_.removeAll(id);revokedOwners_.remove(id);persist();
}
void DesktopAnalytics::cancelFinal(bool withdraw) {
    const auto old=final_;const auto id=finalClientId_,token=finalToken_,account=finalAccount_;++finalGeneration_;
    final_.clear();finalClientId_.clear();finalToken_.clear();finalAccount_.clear();if(old)old->abort();
    if(!withdraw||id.isEmpty()||token.isEmpty()||account.isEmpty())return;
    appendRevocation(id,account);const auto owner=digest(account);
    request("/me/analytics/consent","POST",{{"schema",1},{"consentVersion",1},{"clientId",id},{"consent","rejected"}},token,[this,id,owner](int status,QJsonObject){if(status>=200&&status<300)removeRevocation(id,owner);});
}
void DesktopAnalytics::setSession(const QString &token, const QString &account) {
    if (token == token_ && account == account_) return;
    if (!account_.isEmpty() && account != account_) {
        cancelBatch(); pending_.clear(); sessionId_ = 0; lastEventAt_ = 0;
        if (!clientId_.isEmpty()) { clientId_.clear();persist(); }
    }
    token_ = token; account_ = account;
    ensureIdentity(); revokePending();
}
void DesktopAnalytics::setConsent(bool granted) {
    const QString next = granted ? "accepted" : "rejected";
    if (choice_ == next) return;
    cancelFinal(!granted);cancelBatch(); pending_.clear(); sessionId_ = 0; lastEventAt_ = 0;
    if (!granted && !clientId_.isEmpty()) {
        appendRevocation(clientId_,account_);
        clientId_.clear();
    }
    choice_ = next; ensureIdentity(); persist(); revokePending();
    emit stateChanged();
}
QNetworkReply *DesktopAnalytics::request(const QString &path, const QByteArray &method, const QJsonObject &body, const QString &token, Reply done) {
    QNetworkRequest request(options_.apiBase.resolved(QUrl(path)));
    request.setTransferTimeout(5000);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setRawHeader("Accept", "application/json");
    request.setRawHeader("User-Agent", "Flixify-Windows/" FLIXIFY_APP_VERSION);
    if (!token.isEmpty()) request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    auto *reply = method == "GET" ? network_.get(request) : network_.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    replies_.erase(std::remove_if(replies_.begin(), replies_.end(), [](const auto &r) { return r.isNull(); }), replies_.end());
    replies_.append(reply); reply->setReadBufferSize(16385);
    connect(reply, &QNetworkReply::readyRead, reply, [reply] { if (reply->bytesAvailable() > 16384) reply->abort(); });
    connect(reply, &QNetworkReply::finished, this, [reply, done = std::move(done)] {
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const auto bytes = reply->isOpen() ? reply->readAll() : QByteArray();
        const bool valid = bytes.size() <= 16384 && reply->error() == QNetworkReply::NoError;
        reply->deleteLater(); done(valid ? status : 0, valid ? QJsonDocument::fromJson(bytes).object() : QJsonObject());
    });
    return reply;
}
void DesktopAnalytics::reloadConfiguration() {
    if (configPending_) return;
    configPending_ = true;
    request("/analytics/config", "GET", {}, {}, [this](int status, QJsonObject body) {
        configPending_ = false;
        const auto windows = body.value("windows").toObject();
        available_ = status == 200 && body.value("schema").toInt() == 1 && body.value("consentVersion").toInt() == 1 && windows.value("enabled") == true
            && matches(windows.value("measurementId").toString(), "^G-[A-Z0-9]{6,20}$");
        if (!available_) { cancelBatch(); pending_.clear(); }
        emit stateChanged();
    });
}
void DesktopAnalytics::revokePending() {
    if (revoking_ || revoked_.isEmpty() || token_.isEmpty()) return;
    const auto owner=digest(account_);QString id;
    for(const auto &candidate:revoked_)if(revokedOwners_.value(candidate).toString()==owner){id=candidate;break;}
    if(id.isEmpty())return;
    revoking_ = true;
    request("/me/analytics/consent", "POST", {{"schema", 1}, {"consentVersion", 1}, {"clientId", id}, {"consent", "rejected"}}, token_, [this, id,owner](int status, QJsonObject) {
        revoking_ = false;
        if (status >= 200 && status < 300) { removeRevocation(id,owner);revokePending(); }
    });
}
QString DesktopAnalytics::contentReference(const QVariantMap &item) {
    const auto kind = item.value("kind").toString().toLower(), id = item.value("id").toString();
    if (!QStringList{"live", "movie", "series", "episode"}.contains(kind) || !matches(id, "^[0-9]{1,20}$")) return {};
    return digest(kind + ":" + id);
}
QString DesktopAnalytics::categoryReference(const QString &id) {
    static const QSet<QString> liveCategories{"national","news","sports","kids","documentary","music","local","themed","radio"};
    return matches(id, "^[0-9]{1,20}$") || liveCategories.contains(id) ? digest(id) : QString();
}
QString DesktopAnalytics::catalogLabel(const QString &label, int maximum) {
    if (label.size() > 4096 || maximum < 1 || maximum > 100) return {};
    static const QRegularExpression unsafe(QStringLiteral("[\\p{C}\\p{Zl}\\p{Zp}@]|https?:|ftp:|mailto:|data:|file:|javascript:|://|www\\.|%[0-9a-fA-F]{2}|(?:username|password|token|secret|session)(?:_id)?\\s*[:=]"), QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression accountCode(QStringLiteral("(?<![\\p{L}\\p{N}])[A-Z0-9]{16}(?![\\p{L}\\p{N}])"));
    if (unsafe.match(label).hasMatch() || accountCode.match(label).hasMatch()) return {};
    return label.trimmed().left(maximum).trimmed();
}
bool DesktopAnalytics::safeEvent(const QString &name, const QVariantMap &params) {
    static const QSet<QString> names{"app_screen_view","sign_up","login","logout","search","select_content","category_select","catalog_page_loaded","add_to_wishlist","remove_from_wishlist","trial_select","welcome_offer_select","view_item_list","select_item","begin_checkout","package_open","file_download","update_offered","update_selected","update_downloaded","update_completed","playback_request","video_start","video_progress","video_complete","playback_buffer","playback_error","playback_end"};
    if (!names.contains(name) || params.size() > 22) return false;
    static const QHash<QString, QStringList> enums{
        {"client_platform", {"windows"}}, {"screen_name", {"home","live","movies","series","favorites","account","login","register","search","categories","details","player","packages","downloads","settings","support"}},
        {"content_type", {"live","movie","series","episode"}}, {"reason", {"unknown","network","timeout","unsupported","decode","source_unavailable","access_denied","user_exit","replaced","ended","error","startup","buffering","requested","canceled","unavailable","failed","manual","automatic","startup_timeout","access","user","completed","logout"}},
        {"status", {"requested","playing","ended","error","canceled","closed","available","completed","failed"}}, {"method", {"code"}}, {"source_platform", {"web","pwa","android_tv","macos","windows"}},
        {"package_id", {"1-ay","6-ay","12-ay","1-ay-2-kullanici","6-ay-2-kullanici","12-ay-2-kullanici"}}, {"offer_id", {"welcome-monthly-50","welcome-monthly-50-v1"}},
        {"item_list_id", {"packages","home","movies","series","live","favorites","search"}}, {"file_extension", {"exe","apk","dmg"}}, {"download_platform", {"android_tv","macos","windows"}}};
    static const QHash<QString, double> limits{{"query_length",1000},{"result_count",1000000},{"page_number",100000},{"startup_ms",600000},{"buffer_ms",86400000},{"watch_ms",86400000},{"duration_ms",86400000},{"progress_percent",100},{"buffer_count",10000},{"session_id",9007199254740991.0},{"engagement_time_msec",3600000},{"package_months",12},{"package_users",2}};
    for (auto it = params.cbegin(); it != params.cend(); ++it) {
        if (enums.contains(it.key())) {
            if (it.value().metaType().id() != QMetaType::QString || !enums.value(it.key()).contains(it.value().toString())) return false;
        } else if (it.key() == "content_name" || it.key() == "category_name") {
            const auto value = it.value().toString();
            if (it.value().metaType().id() != QMetaType::QString || value.isEmpty() || value != catalogLabel(value, it.key() == "content_name" ? 100 : 80)) return false;
        } else if (it.key() == "content_id" || it.key() == "category_id") {
            if (!matches(it.value().toString(), "^[a-f0-9]{16,64}$")) return false;
        } else if (it.key() == "app_version" || it.key() == "update_version") {
            if (!matches(it.value().toString(), "^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}([+-][a-zA-Z0-9.-]{1,24})?$")) return false;
        } else if (limits.contains(it.key())) {
            const auto value = it.value(); const double number = value.toDouble();
            if (value.metaType().id() == QMetaType::Bool || value.metaType().id() == QMetaType::QString || !value.canConvert<double>() || !std::isfinite(number) || number < 0 || number > limits.value(it.key()) || (it.key() != "progress_percent" && std::floor(number) != number)) return false;
            if ((it.key() == "page_number" || it.key() == "session_id") && number < 1) return false;
            if (it.key() == "package_months" && number != 1 && number != 6 && number != 12) return false;
            if (it.key() == "package_users" && number != 1 && number != 2) return false;
        } else return false;
    }
    return true;
}
void DesktopAnalytics::record(const QString &event, QVariantMap params) {
    for (const auto &field : QStringList{"content_name", "category_name"}) if (params.contains(field)) {
        const auto value = params.value(field);
        const auto label = value.metaType().id() == QMetaType::QString ? catalogLabel(value.toString(), field == "content_name" ? 100 : 80) : QString();
        if (label.isEmpty()) params.remove(field); else params.insert(field, label);
    }
    if (!available_ || choice_ != "accepted" || !safeEvent(event, params)) return;
    ensureIdentity();
    const auto now = options_.clock();
    if (lastEventAt_ && now - lastEventAt_ > 30 * 60 * 1000) sessionId_ = now / 1000;
    lastEventAt_ = now;
    params.insert("client_platform", "windows"); params.insert("app_version", FLIXIFY_APP_VERSION);
    if (!safeEvent(event, params)) return;
    while (pending_.size() >= 100) pending_.removeFirst();
    pending_.append({{{"id", uuid()}, {"name", event}, {"eventTimestampMs", now}, {"params", QJsonObject::fromVariantMap(params)}},sessionId_});
}
void DesktopAnalytics::flush() {
    if (batch_ || !available_ || choice_ != "accepted" || token_.isEmpty() || pending_.isEmpty()) return;
    const auto now = options_.clock();
    while (!pending_.isEmpty() && now - pending_.first().payload.value("eventTimestampMs").toDouble() > 3600000) pending_.removeFirst();
    if (pending_.isEmpty()) return;
    const auto sessionId=pending_.first().sessionId;
    QJsonArray events; for (int i = 0; i < qMin(qsizetype(20), pending_.size())&&pending_[i].sessionId==sessionId; ++i) events.append(pending_[i].payload);
    const auto generation = generation_;
    const QJsonObject body{{"schema",1},{"consentVersion",1},{"clientPlatform","windows"},{"clientId",clientId_},{"sessionId",sessionId},{"events",events}};
    if (QJsonDocument(body).toJson(QJsonDocument::Compact).size() > 32768) { pending_.removeFirst(); return; }
    batch_ = request("/me/analytics/events", "POST", body, token_, [this, generation, events](int status, QJsonObject response) {
        if (generation != generation_) return;
        batch_.clear();
        const auto accepted = response.value("accepted");
        if (status == 202 && accepted.isDouble() && accepted.toInt(-1) >= 0 && accepted.toInt() <= events.size()) {
            QSet<QString> completed; for (const auto &e : events) completed.insert(e.toObject().value("id").toString());
            pending_.erase(std::remove_if(pending_.begin(), pending_.end(), [&](const auto &e) { return completed.contains(e.payload.value("id").toString()); }), pending_.end());
        } else if (status == 400 || status == 413) pending_.clear();
    });
}
