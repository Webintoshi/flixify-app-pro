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

public:
  explicit ApiClient(QObject *parent = nullptr);

  QString apiBaseUrl() const;
  void setApiBaseUrl(const QString &value);

  QString accessToken() const;
  void setAccessToken(const QString &value);

  bool busy() const;
  QString lastError() const;
  QVariantList liveChannels() const;

  Q_INVOKABLE void loginByCode(
    const QString &code,
    const QString &deviceName = QStringLiteral("Flixify Native Qt"),
    const QString &platform = QString()
  );
  Q_INVOKABLE void fetchLiveCatalog(int page = 1, int pageSize = 300, const QString &search = QString());
  Q_INVOKABLE QVariantMap liveChannelById(const QString &channelId) const;
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
  void loginSucceeded();
  void requestFailed(const QString &context, const QString &message);

private:
  void setBusy(bool value);
  void setLastError(const QString &value);
  void updateLiveChannelsFromJson(const QJsonArray &items);

  QString m_apiBaseUrl;
  QString m_accessToken;
  bool m_busy = false;
  QString m_lastError;
  QVariantList m_liveChannels;
  QNetworkAccessManager m_network;
};
