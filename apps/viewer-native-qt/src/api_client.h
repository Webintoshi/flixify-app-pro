#pragma once

#include <QJsonArray>
#include <QObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QNetworkRequest>
#include <QFile>
#include <QTimer>
#include <functional>
#include <QVariantList>
#include <QVariantMap>
#include <QUrl>

class ApiClient : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString apiBaseUrl READ apiBaseUrl WRITE setApiBaseUrl NOTIFY apiBaseUrlChanged)
  Q_PROPERTY(QString accessToken READ accessToken WRITE setAccessToken NOTIFY accessTokenChanged)
  Q_PROPERTY(bool authenticated READ authenticated NOTIFY authenticatedChanged)
  Q_PROPERTY(bool restoringSession READ restoringSession NOTIFY restoringSessionChanged)
  Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
  Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
  Q_PROPERTY(QString notice READ notice NOTIFY noticeChanged)
  Q_PROPERTY(QString appVersion READ appVersion CONSTANT)
  Q_PROPERTY(QVariantMap me READ me NOTIFY meChanged)
  Q_PROPERTY(QVariantMap publicSettings READ publicSettings NOTIFY publicSettingsChanged)
  Q_PROPERTY(QVariantList packages READ packages NOTIFY packagesChanged)
  Q_PROPERTY(QVariantList paymentMethods READ paymentMethods NOTIFY paymentMethodsChanged)
  Q_PROPERTY(QVariantList paymentRequests READ paymentRequests NOTIFY paymentRequestsChanged)
  Q_PROPERTY(QVariantMap appUpdate READ appUpdate NOTIFY appUpdateChanged)
  Q_PROPERTY(bool updateInProgress READ updateInProgress NOTIFY updateInProgressChanged)
  Q_PROPERTY(double updateProgress READ updateProgress NOTIFY updateProgressChanged)
  Q_PROPERTY(QString updateError READ updateError NOTIFY updateErrorChanged)
  Q_PROPERTY(QVariantList liveChannels READ liveChannels NOTIFY liveChannelsChanged)
  Q_PROPERTY(QVariantList liveGroups READ liveGroups NOTIFY liveGroupsChanged)
  Q_PROPERTY(bool liveHasMore READ liveHasMore NOTIFY liveHasMoreChanged)
  Q_PROPERTY(bool liveLoadingMore READ liveLoadingMore NOTIFY liveLoadingMoreChanged)
  Q_PROPERTY(QVariantList movies READ movies NOTIFY moviesChanged)
  Q_PROPERTY(QVariantList movieGroups READ movieGroups NOTIFY movieGroupsChanged)
  Q_PROPERTY(int movieTotal READ movieTotal NOTIFY movieTotalChanged)
  Q_PROPERTY(bool movieHasMore READ movieHasMore NOTIFY movieHasMoreChanged)
  Q_PROPERTY(bool movieLoadingMore READ movieLoadingMore NOTIFY movieLoadingMoreChanged)
  Q_PROPERTY(QVariantList series READ series NOTIFY seriesChanged)

public:
  explicit ApiClient(QObject *parent = nullptr);

  QString apiBaseUrl() const;
  void setApiBaseUrl(const QString &value);

  QString accessToken() const;
  void setAccessToken(const QString &value);

  bool authenticated() const;
  bool restoringSession() const;
  bool busy() const;
  QString lastError() const;
  QString notice() const;
  QString appVersion() const;
  QVariantMap me() const;
  QVariantMap publicSettings() const;
  QVariantList packages() const;
  QVariantList paymentMethods() const;
  QVariantList paymentRequests() const;
  QVariantMap appUpdate() const;
  bool updateInProgress() const;
  double updateProgress() const;
  QString updateError() const;
  QVariantList liveChannels() const;
  QVariantList liveGroups() const;
  bool liveHasMore() const;
  bool liveLoadingMore() const;
  QVariantList movies() const;
  QVariantList movieGroups() const;
  int movieTotal() const;
  bool movieHasMore() const;
  bool movieLoadingMore() const;
  QVariantList series() const;

  Q_INVOKABLE void bootstrap();
  Q_INVOKABLE void issueAnonCode(
    const QString &deviceName = QStringLiteral("Flixify Native Qt"),
    const QString &platform = QString()
  );
  Q_INVOKABLE void loginByCode(
    const QString &code,
    const QString &deviceName = QStringLiteral("Flixify Native Qt"),
    const QString &platform = QString()
  );
  Q_INVOKABLE void logout();
  Q_INVOKABLE void fetchMe();
  Q_INVOKABLE void fetchPublicSettings();
  Q_INVOKABLE void fetchPackages();
  Q_INVOKABLE void fetchPaymentMethods();
  Q_INVOKABLE void fetchPaymentRequests();
  Q_INVOKABLE void fetchShellData(const QString &search = QString());
  Q_INVOKABLE void checkAppUpdate();
  Q_INVOKABLE void dismissAppUpdate(const QString &version = QString());
  Q_INVOKABLE void installAppUpdate();
  Q_INVOKABLE void fetchLiveCatalog(
    int page = 1,
    int pageSize = 300,
    const QString &search = QString(),
    const QString &group = QString()
  );
  Q_INVOKABLE void loadMoreLive();
  Q_INVOKABLE void fetchMovieCatalog(
    int page = 1,
    int pageSize = 18,
    const QString &search = QString(),
    const QString &group = QString()
  );
  Q_INVOKABLE void loadMoreMovies();
  Q_INVOKABLE void fetchSeriesCatalog(int page = 1, int pageSize = 200, const QString &search = QString());
  Q_INVOKABLE void fetchAllCatalogs(const QString &search = QString(), int livePageSize = 300);
  Q_INVOKABLE void requestPayment(
    const QString &packageSlug,
    const QString &paymentMethodId,
    const QString &cryptoAssetId = QString()
  );
  Q_INVOKABLE void requestTrial(const QString &note = QString());
  Q_INVOKABLE bool copyText(const QString &value) const;
  Q_INVOKABLE QString saveTextFile(const QString &nameHint, const QString &content) const;
  Q_INVOKABLE bool consumeInitialRegisterPrompt();
  Q_INVOKABLE QVariantMap liveChannelById(const QString &channelId) const;
  Q_INVOKABLE QVariantMap movieById(const QString &movieId) const;
  Q_INVOKABLE QVariantMap seriesById(const QString &seriesId) const;
  Q_INVOKABLE QVariantMap episodeById(const QString &episodeId) const;
  Q_INVOKABLE QVariantMap nextEpisodeForEpisode(const QString &episodeId) const;
  Q_INVOKABLE QString normalizedPlatformName() const;
  void refreshSession(std::function<void(bool success)> completion = {});

  QNetworkAccessManager *network();
  QUrl resolvedUrl(const QString &path) const;
  QNetworkRequest authorizedRequest(const QString &path) const;

signals:
  void apiBaseUrlChanged();
  void accessTokenChanged();
  void authenticatedChanged();
  void restoringSessionChanged();
  void busyChanged();
  void lastErrorChanged();
  void noticeChanged();
  void meChanged();
  void publicSettingsChanged();
  void packagesChanged();
  void paymentMethodsChanged();
  void paymentRequestsChanged();
  void appUpdateChanged();
  void updateInProgressChanged();
  void updateProgressChanged();
  void updateErrorChanged();
  void liveChannelsChanged();
  void liveGroupsChanged();
  void liveHasMoreChanged();
  void liveLoadingMoreChanged();
  void moviesChanged();
  void movieGroupsChanged();
  void movieTotalChanged();
  void movieHasMoreChanged();
  void movieLoadingMoreChanged();
  void seriesChanged();
  void anonCodeIssued(const QString &code);
  void loginSucceeded();
  void logoutCompleted();
  void requestFailed(const QString &context, const QString &message);

private:
  void setBusy(bool value);
  void setRestoringSession(bool value);
  void setLastError(const QString &value);
  void setNotice(const QString &value);
  void setSuppressedUpdateVersion(const QString &value);
  void setMe(const QVariantMap &value);
  void setPublicSettings(const QVariantMap &value);
  void setPackages(const QVariantList &value);
  void setPaymentMethods(const QVariantList &value);
  void setPaymentRequests(const QVariantList &value);
  void setAppUpdate(const QVariantMap &value);
  void setUpdateInProgress(bool value);
  void setUpdateProgress(double value);
  void setUpdateError(const QString &value);
  void setLiveHasMore(bool value);
  void setLiveLoadingMore(bool value);
  void setMovieHasMore(bool value);
  void setMovieLoadingMore(bool value);
  void setMovieTotal(int value);
  void beginRequest();
  void endRequest();
  void clearAuthenticatedData();
  void setRefreshToken(const QString &value);
  void setSessionTokens(const QString &accessToken, const QString &refreshToken);
  void updateSessionPersistence();
  void handleAuthFailure(const QString &context, std::function<void()> retry);
  void updateLiveCatalogFromJson(const QJsonObject &payload, bool append);
  void updateLiveChannelsFromJson(const QJsonArray &items, bool append);
  void updateLiveGroupsFromJson(const QJsonArray &groups);
  void updateMoviesCatalogFromJson(const QJsonObject &payload, bool append);
  void updateMovieGroupsFromJson(const QJsonArray &groups);
  void updateMoviesFromJson(const QJsonArray &items, bool append);
  void updateSeriesFromJson(const QJsonArray &items);
  static QVariantMap mapEpisodeFromJson(const QJsonObject &item);
  static QVariantMap mapSeriesFromJson(const QJsonObject &item);

  QString m_apiBaseUrl;
  QString m_accessToken;
  QString m_refreshToken;
  bool m_restoringSession = false;
  bool m_refreshInFlight = false;
  bool m_lastRefreshAuthInvalid = false;
  bool m_busy = false;
  int m_activeRequests = 0;
  QString m_lastError;
  QString m_notice;
  QString m_suppressedUpdateVersion;
  QVariantMap m_me;
  QVariantMap m_publicSettings;
  QVariantList m_packages;
  QVariantList m_paymentMethods;
  QVariantList m_paymentRequests;
  QVariantMap m_appUpdate;
  bool m_updateInProgress = false;
  double m_updateProgress = 0.0;
  QString m_updateError;
  QString m_updateInstallerPath;
  QPointer<QNetworkReply> m_updateReply;
  QFile *m_updateFile = nullptr;
  QVariantList m_liveChannels;
  QVariantList m_liveGroups;
  bool m_liveHasMore = false;
  bool m_liveLoadingMore = false;
  int m_livePage = 0;
  int m_livePageSize = 300;
  int m_liveTotal = 0;
  QString m_liveSearch;
  QString m_liveGroup;
  quint64 m_liveCatalogGeneration = 0;
  QVariantList m_movies;
  QVariantList m_movieGroups;
  bool m_movieHasMore = false;
  bool m_movieLoadingMore = false;
  int m_moviePage = 0;
  int m_moviePageSize = 18;
  int m_movieTotal = 0;
  QString m_movieSearch;
  QString m_movieGroup;
  QVariantList m_series;
  QList<std::function<void(bool)>> m_refreshCompletions;
  QTimer m_sessionRefreshRetryTimer;
  QNetworkAccessManager m_network;
};
