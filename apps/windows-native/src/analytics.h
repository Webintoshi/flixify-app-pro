#pragma once
#include <QObject>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QTimer>
#include <QUrl>
#include <QVariantMap>
#include <functional>

class QNetworkReply;
struct AnalyticsOptions {
    QUrl apiBase = QUrl(QStringLiteral("https://api.flixify.vip"));
    QString preferencesPath;
    bool allowLoopbackForTests = false;
    std::function<qint64()> clock;
};

class DesktopAnalytics final : public QObject {
    Q_OBJECT
public:
    explicit DesktopAnalytics(AnalyticsOptions options, QObject *parent = nullptr);
    ~DesktopAnalytics() override;
    bool available() const { return available_; }
    bool promptVisible() const { return available_ && choice_ == "unknown"; }
    QString choice() const { return choice_; }
    QString clientId() const { return clientId_; }
    int pendingCount() const { return int(pending_.size()); }
    void setSession(const QString &token, const QString &account);
    void setConsent(bool granted);
    void reloadConfiguration();
    void record(const QString &event, QVariantMap params = {});
    void flush();
    void recordLogoutAndDetach();
    static bool safeEvent(const QString &name, const QVariantMap &params);
    static QString contentReference(const QVariantMap &item);
    static QString categoryReference(const QString &id);
    static QString catalogLabel(const QString &label, int maximum = 100);
signals:
    void stateChanged();
private:
    using Reply = std::function<void(int, QJsonObject)>;
    QNetworkReply *request(const QString &path, const QByteArray &method, const QJsonObject &body, const QString &token, Reply done);
    void persist();
    void ensureIdentity();
    void revokePending();
    void cancelBatch();
    void cancelFinal(bool withdraw);
    void appendRevocation(const QString &id,const QString &account);
    void removeRevocation(const QString &id,const QString &owner);
    AnalyticsOptions options_;
    QNetworkAccessManager network_;
    QTimer flushTimer_;
    struct PendingEvent { QJsonObject payload; qint64 sessionId; };
    QList<PendingEvent> pending_;
    QList<QPointer<QNetworkReply>> replies_;
    QPointer<QNetworkReply> batch_;
    QPointer<QNetworkReply> final_;
    QString choice_ = "unknown", clientId_, token_, account_;
    QStringList revoked_;
    QVariantMap revokedOwners_;
    QString finalClientId_,finalToken_,finalAccount_;
    qint64 sessionId_ = 0, lastEventAt_ = 0;
    quint64 generation_ = 0;
    quint64 finalGeneration_ = 0;
    bool available_ = false, configPending_ = false, revoking_ = false;
};
