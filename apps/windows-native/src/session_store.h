#pragma once
#include <QString>
#include <QVariantMap>
#include <QVariantList>
struct StoredSession {
    QString accessToken, refreshToken, accountID, codeSuffix;
    bool valid() const;
};
class SessionStore {
public:
    explicit SessionStore(QString root, bool volatileOnly = false);
    StoredSession load() const;
    bool save(const StoredSession &);
    void clear();
    QString installationID();
private:
    QString root;
    bool volatileOnly;
    StoredSession memory;
};
class MetadataStore {
public:
    explicit MetadataStore(QString root);
    QVariant read(const QString &scope, const QString &name, qint64 expiry, qint64 now, qint64 *savedAt=nullptr) const;
    void write(const QString &scope, const QString &name, const QVariant &, qint64 expiry, qint64 now);
    static QByteArray encode(const QString &scope, const QVariant &, qint64 expiry, qint64 now);
    void writeEncoded(const QString &scope, const QString &name, const QByteArray &);
    void saveProgress(const QVariantMap &, qint64 position, qint64 duration, qint64 now);
    qint64 position(const QVariantMap &) const;
    QVariantMap latestEpisode(const QVariantList &) const;
    static QString hash(const QString &);
private:
    QString root;
    QString path(const QString &scope,const QString &name) const;
    QVariantMap progress() const;
    void trim();
};
