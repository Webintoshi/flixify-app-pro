#include "api_client.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QUrlQuery>
#include <QtGlobal>

namespace {

QString extractApiErrorMessage(const QByteArray &body, const QString &fallback) {
  const QJsonDocument document = QJsonDocument::fromJson(body);
  if (document.isObject()) {
    const QString message = document.object().value(QStringLiteral("message")).toString().trimmed();
    if (!message.isEmpty()) {
      return message;
    }
  }

  const QString text = QString::fromUtf8(body).trimmed();
  return text.isEmpty() ? fallback : text;
}

}

ApiClient::ApiClient(QObject *parent)
  : QObject(parent) {}

QString ApiClient::apiBaseUrl() const {
  return m_apiBaseUrl;
}

void ApiClient::setApiBaseUrl(const QString &value) {
  const QString trimmed = value.trimmed();
  if (trimmed == m_apiBaseUrl) {
    return;
  }

  m_apiBaseUrl = trimmed;
  emit apiBaseUrlChanged();
}

QString ApiClient::accessToken() const {
  return m_accessToken;
}

void ApiClient::setAccessToken(const QString &value) {
  const QString trimmed = value.trimmed();
  if (trimmed == m_accessToken) {
    return;
  }

  m_accessToken = trimmed;
  emit accessTokenChanged();
}

bool ApiClient::busy() const {
  return m_busy;
}

QString ApiClient::lastError() const {
  return m_lastError;
}

QVariantList ApiClient::liveChannels() const {
  return m_liveChannels;
}

QString ApiClient::normalizedPlatformName() const {
#if defined(Q_OS_WIN)
  return QStringLiteral("windows-native-qt");
#elif defined(Q_OS_MACOS)
  return QStringLiteral("macos-native-qt");
#elif defined(Q_OS_ANDROID)
  return QStringLiteral("android-native-qt");
#else
  return QStringLiteral("native-qt");
#endif
}

QNetworkAccessManager *ApiClient::network() {
  return &m_network;
}

QUrl ApiClient::resolvedUrl(const QString &path) const {
  QUrl baseUrl(m_apiBaseUrl.endsWith(QLatin1Char('/')) ? m_apiBaseUrl : m_apiBaseUrl + QLatin1Char('/'));
  return baseUrl.resolved(QUrl(path.startsWith(QLatin1Char('/')) ? path.mid(1) : path));
}

QNetworkRequest ApiClient::authorizedRequest(const QString &path) const {
  QNetworkRequest request(resolvedUrl(path));
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setRawHeader("Accept", "application/json");
  if (!m_accessToken.isEmpty()) {
    request.setRawHeader("Authorization", QByteArray("Bearer ") + m_accessToken.toUtf8());
  }
  request.setRawHeader("X-Flixify-Client-Runtime", "native");
  return request;
}

void ApiClient::loginByCode(const QString &code, const QString &deviceName, const QString &platform) {
  setBusy(true);
  setLastError(QString());

  QJsonObject payload;
  payload.insert(QStringLiteral("code"), code.trimmed());
  payload.insert(QStringLiteral("deviceName"), deviceName.trimmed());
  payload.insert(
    QStringLiteral("platform"),
    platform.trimmed().isEmpty() ? normalizedPlatformName() : platform.trimmed()
  );

  QNetworkReply *reply = m_network.post(
    authorizedRequest(QStringLiteral("/auth/login-by-code")),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );

  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    setBusy(false);

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Login request failed."));
      setLastError(message);
      emit requestFailed(QStringLiteral("login"), message);
      return;
    }

    const QJsonDocument document = QJsonDocument::fromJson(body);
    const QJsonObject root = document.object();
    setAccessToken(root.value(QStringLiteral("accessToken")).toString());
    emit loginSucceeded();
  });
}

void ApiClient::fetchLiveCatalog(int page, int pageSize, const QString &search) {
  setBusy(true);
  setLastError(QString());

  QUrl url = resolvedUrl(QStringLiteral("/me/catalog/live"));
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("page"), QString::number(page > 0 ? page : 1));
  query.addQueryItem(QStringLiteral("pageSize"), QString::number(qBound(1, pageSize, 300)));
  if (!search.trimmed().isEmpty()) {
    query.addQueryItem(QStringLiteral("search"), search.trimmed());
  }
  url.setQuery(query);

  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setRawHeader("Accept", "application/json");
  if (!m_accessToken.isEmpty()) {
    request.setRawHeader("Authorization", QByteArray("Bearer ") + m_accessToken.toUtf8());
  }
  request.setRawHeader("X-Flixify-Client-Runtime", "native");

  QNetworkReply *reply = m_network.get(request);
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    setBusy(false);

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Live catalog request failed."));
      setLastError(message);
      emit requestFailed(QStringLiteral("catalog"), message);
      return;
    }

    const QJsonDocument document = QJsonDocument::fromJson(body);
    updateLiveChannelsFromJson(document.object().value(QStringLiteral("items")).toArray());
  });
}

QVariantMap ApiClient::liveChannelById(const QString &channelId) const {
  for (const QVariant &item : m_liveChannels) {
    const QVariantMap map = item.toMap();
    if (map.value(QStringLiteral("id")).toString() == channelId) {
      return map;
    }
  }

  return {};
}

void ApiClient::setBusy(bool value) {
  if (value == m_busy) {
    return;
  }

  m_busy = value;
  emit busyChanged();
}

void ApiClient::setLastError(const QString &value) {
  if (value == m_lastError) {
    return;
  }

  m_lastError = value;
  emit lastErrorChanged();
}

void ApiClient::updateLiveChannelsFromJson(const QJsonArray &items) {
  QVariantList nextItems;
  nextItems.reserve(items.size());

  for (const QJsonValue &value : items) {
    const QJsonObject item = value.toObject();
    QVariantMap row;
    row.insert(QStringLiteral("id"), item.value(QStringLiteral("id")).toString());
    row.insert(QStringLiteral("title"), item.value(QStringLiteral("title")).toString());
    row.insert(QStringLiteral("groupTitle"), item.value(QStringLiteral("groupTitle")).toString());
    row.insert(QStringLiteral("logoUrl"), item.value(QStringLiteral("logoUrl")).toString());
    row.insert(QStringLiteral("transport"), item.value(QStringLiteral("transport")).toString());
    row.insert(QStringLiteral("variantGroupKey"), item.value(QStringLiteral("variantGroupKey")).toString());
    row.insert(QStringLiteral("qualityRank"), item.value(QStringLiteral("qualityRank")).toInt(-1));
    row.insert(QStringLiteral("healthStatus"), item.value(QStringLiteral("healthStatus")).toString());
    nextItems.push_back(row);
  }

  m_liveChannels = nextItems;
  emit liveChannelsChanged();
}
