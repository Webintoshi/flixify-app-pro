#pragma once

#include <QJsonArray>
#include <QObject>
#include <QNetworkAccessManager>
#include <QNetworkRequest>
#include <QVariantList>
#include <QVariantMap>
#include <QUrl>

class ApiClient : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString apiBaseUrl READ apiBaseUrl WRITE setApiBaseUrl NOTIFY apiBaseUrlChanged)
  Q_PROPERTY(QString accessToken READ accessToken WRITE setAccessToken NOTIFY accessTokenChanged)
  Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
  Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
  Q_PROPERTY(QVariantList liveChannels READ liveChannels NOTIFY liveChannelsChanged)
  Q_PROPERTY(QVariantList movies READ movies NOTIFY moviesChanged)
  Q_PROPERTY(QVariantList series READ series NOTIFY seriesChanged)

public:
  explicit ApiClient(QObject *parent = nullptr);

  QString apiBaseUrl() const;
  void setApiBaseUrl(const QString &value);

  QString accessToken() const;
  void setAccessToken(const QString &value);

  bool busy() const;
  QString lastError() const;
  QVariantList liveChannels() const;
  QVariantList movies() const;
  QVariantList series() const;

  Q_INVOKABLE void loginByCode(
    const QString &code,
    const QString &deviceName = QStringLiteral("Flixify Native Qt"),
    const QString &platform = QString()
  );
  Q_INVOKABLE void fetchLiveCatalog(int page = 1, int pageSize = 300, const QString &search = QString());
  Q_INVOKABLE void fetchMovieCatalog(int page = 1, int pageSize = 300, const QString &search = QString());
  Q_INVOKABLE void fetchSeriesCatalog(int page = 1, int pageSize = 200, const QString &search = QString());
  Q_INVOKABLE void fetchAllCatalogs(const QString &search = QString(), int livePageSize = 300);
  Q_INVOKABLE QVariantMap liveChannelById(const QString &channelId) const;
  Q_INVOKABLE QVariantMap movieById(const QString &movieId) const;
  Q_INVOKABLE QVariantMap seriesById(const QString &seriesId) const;
  Q_INVOKABLE QVariantMap episodeById(const QString &episodeId) const;
  Q_INVOKABLE QVariantMap nextEpisodeForEpisode(const QString &episodeId) const;
  Q_INVOKABLE QString normalizedPlatformName() const;

  QNetworkAccessManager *network();
  QUrl resolvedUrl(const QString &path) const;
  QNetworkRequest authorizedRequest(const QString &path) const;

signals:
  void apiBaseUrlChanged();
  void accessTokenChanged();
  void busyChanged();
  void lastErrorChanged();
  void liveChannelsChanged();
  void moviesChanged();
  void seriesChanged();
  void loginSucceeded();
  void requestFailed(const QString &context, const QString &message);

private:
  void setBusy(bool value);
  void setLastError(const QString &value);
  void beginRequest();
  void endRequest();
  void updateLiveChannelsFromJson(const QJsonArray &items);
  void updateMoviesFromJson(const QJsonArray &items);
  void updateSeriesFromJson(const QJsonArray &items);
  static QVariantMap mapEpisodeFromJson(const QJsonObject &item);
  static QVariantMap mapSeriesFromJson(const QJsonObject &item);

  QString m_apiBaseUrl;
  QString m_accessToken;
  bool m_busy = false;
  int m_activeRequests = 0;
  QString m_lastError;
  QVariantList m_liveChannels;
  QVariantList m_movies;
  QVariantList m_series;
  QNetworkAccessManager m_network;
};
