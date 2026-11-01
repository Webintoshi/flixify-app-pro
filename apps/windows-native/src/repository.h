#pragma once
#include <QObject>
#include <QVariantMap>
#include <QVariantList>
#include <QUrl>
#include <functional>
#include <memory>

struct RepositoryOptions {
    QUrl apiBase = QUrl(QStringLiteral("https://api.flixify.vip"));
    QString storageDirectory;
    bool allowLoopbackForTests = false;
    std::function<qint64()> now;
};

class DesktopRepository final : public QObject {
    Q_OBJECT
#define REPO_PROPERTY(type, name) Q_PROPERTY(type name READ name NOTIFY stateChanged)
    REPO_PROPERTY(bool, bootstrapping)
    REPO_PROPERTY(bool, authenticated)
    REPO_PROPERTY(bool, busy)
    REPO_PROPERTY(bool, loadingMore)
    REPO_PROPERTY(bool, hasMore)
    REPO_PROPERTY(bool, welcomeVisible)
    REPO_PROPERTY(bool, posterSoundEnabled)
    REPO_PROPERTY(QString, error)
    REPO_PROPERTY(QString, route)
    REPO_PROPERTY(QString, query)
    REPO_PROPERTY(QString, category)
    REPO_PROPERTY(QString, country)
    REPO_PROPERTY(QString, sectionTitle)
    REPO_PROPERTY(QString, codeSuffix)
    REPO_PROPERTY(QString, scope)
    REPO_PROPERTY(QVariantMap, account)
    REPO_PROPERTY(QVariantMap, hero)
    REPO_PROPERTY(QVariantMap, seriesDetail)
    REPO_PROPERTY(QVariantMap, welcome)
    REPO_PROPERTY(QVariantList, shelves)
    REPO_PROPERTY(QVariantList, items)
    REPO_PROPERTY(QVariantList, categories)
    REPO_PROPERTY(QVariantList, countries)
    REPO_PROPERTY(QVariantList, favorites)
    REPO_PROPERTY(QVariantList, programmes)
    REPO_PROPERTY(int, libraryRevision)
    REPO_PROPERTY(qint64, expiresAt)
#undef REPO_PROPERTY
public:
    explicit DesktopRepository(QObject *parent = nullptr);
    explicit DesktopRepository(const RepositoryOptions &, QObject *parent = nullptr);
    ~DesktopRepository() override;
#define REPO_GET(type, name) type name() const;
    REPO_GET(bool, bootstrapping) REPO_GET(bool, authenticated) REPO_GET(bool, busy)
    REPO_GET(bool, loadingMore) REPO_GET(bool, hasMore) REPO_GET(bool, welcomeVisible) REPO_GET(bool, posterSoundEnabled)
    REPO_GET(QString, error) REPO_GET(QString, route) REPO_GET(QString, query) REPO_GET(QString, category)
    REPO_GET(QString, country) REPO_GET(QString, sectionTitle) REPO_GET(QString, codeSuffix) REPO_GET(QString, scope)
    REPO_GET(QVariantMap, account) REPO_GET(QVariantMap, hero) REPO_GET(QVariantMap, seriesDetail) REPO_GET(QVariantMap, welcome)
    REPO_GET(QVariantList, shelves) REPO_GET(QVariantList, items) REPO_GET(QVariantList, categories) REPO_GET(QVariantList, countries)
    REPO_GET(QVariantList, favorites) REPO_GET(QVariantList, programmes) REPO_GET(int, libraryRevision) REPO_GET(qint64, expiresAt)
#undef REPO_GET
    Q_INVOKABLE void restore();
    Q_INVOKABLE void login(QString code);
    Q_INVOKABLE void logout();
    Q_INVOKABLE void navigate(QString route);
    Q_INVOKABLE void setQuery(QString);
    Q_INVOKABLE void setCategory(QString);
    Q_INVOKABLE void setCountry(QString);
    Q_INVOKABLE void loadMore();
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void playItem(QVariantMap);
    Q_INVOKABLE void showSeries(QVariantMap);
    Q_INVOKABLE void playAdjacentLive(QVariantMap current, int direction);
    Q_INVOKABLE void toggleFavorite(QVariantMap);
    Q_INVOKABLE bool isFavorite(QVariantMap) const;
    Q_INVOKABLE QVariantMap nextEpisode(QVariantMap) const;
    Q_INVOKABLE void saveProgress(QVariantMap, qint64 positionMs, qint64 durationMs, bool ended = false);
    Q_INVOKABLE void refreshPlayback(QVariantMap);
    Q_INVOKABLE void loadEpg(QVariantMap);
    Q_INVOKABLE void chooseWelcome(bool monthly, int users = 1);
    Q_INVOKABLE void openWebsite(QString destination);
    Q_INVOKABLE void setPosterSoundEnabled(bool);
signals:
    void stateChanged();
    void playbackReady(QVariantMap media);
    void accessRevoked();
    void sourceChanged();
    void accessExtended(qint64 expiresAt, QString scope);
private:
    class Private;
    std::unique_ptr<Private> d;
};
