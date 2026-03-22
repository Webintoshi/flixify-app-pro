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

QVariantList ApiClient::movies() const {
  return m_movies;
}

QVariantList ApiClient::series() const {
  return m_series;
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
  beginRequest();
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
    endRequest();

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
  beginRequest();
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
    endRequest();

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

void ApiClient::fetchMovieCatalog(int page, int pageSize, const QString &search) {
  beginRequest();
  setLastError(QString());

  QUrl url = resolvedUrl(QStringLiteral("/me/catalog/movies"));
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
    endRequest();

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Movie catalog request failed."));
      setLastError(message);
      emit requestFailed(QStringLiteral("movies"), message);
      return;
    }

    const QJsonDocument document = QJsonDocument::fromJson(body);
    updateMoviesFromJson(document.object().value(QStringLiteral("items")).toArray());
  });
}

void ApiClient::fetchSeriesCatalog(int page, int pageSize, const QString &search) {
  beginRequest();
  setLastError(QString());

  QUrl url = resolvedUrl(QStringLiteral("/me/catalog/series"));
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
    endRequest();

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Series catalog request failed."));
      setLastError(message);
      emit requestFailed(QStringLiteral("series"), message);
      return;
    }

    const QJsonDocument document = QJsonDocument::fromJson(body);
    updateSeriesFromJson(document.object().value(QStringLiteral("items")).toArray());
  });
}

void ApiClient::fetchAllCatalogs(const QString &search, int livePageSize) {
  fetchLiveCatalog(1, livePageSize, search);
  fetchMovieCatalog(1, 300, search);
  fetchSeriesCatalog(1, 200, search);
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

QVariantMap ApiClient::movieById(const QString &movieId) const {
  for (const QVariant &item : m_movies) {
    const QVariantMap map = item.toMap();
    if (map.value(QStringLiteral("id")).toString() == movieId) {
      return map;
    }
  }

  return {};
}

QVariantMap ApiClient::seriesById(const QString &seriesId) const {
  for (const QVariant &item : m_series) {
    const QVariantMap map = item.toMap();
    if (map.value(QStringLiteral("id")).toString() == seriesId) {
      return map;
    }
  }

  return {};
}

QVariantMap ApiClient::episodeById(const QString &episodeId) const {
  for (const QVariant &seriesItem : m_series) {
    const QVariantMap series = seriesItem.toMap();
    const QVariantList seasons = series.value(QStringLiteral("seasons")).toList();
    for (const QVariant &seasonItem : seasons) {
      const QVariantMap season = seasonItem.toMap();
      const QVariantList episodes = season.value(QStringLiteral("episodes")).toList();
      for (const QVariant &episodeItem : episodes) {
        const QVariantMap episode = episodeItem.toMap();
        if (episode.value(QStringLiteral("id")).toString() == episodeId) {
          QVariantMap enriched = episode;
          enriched.insert(QStringLiteral("seriesId"), series.value(QStringLiteral("id")).toString());
          enriched.insert(QStringLiteral("seriesTitle"), series.value(QStringLiteral("title")).toString());
          enriched.insert(QStringLiteral("seasonTitle"), season.value(QStringLiteral("title")).toString());
          return enriched;
        }
      }
    }
  }

  return {};
}

QVariantMap ApiClient::nextEpisodeForEpisode(const QString &episodeId) const {
  for (const QVariant &seriesItem : m_series) {
    const QVariantMap series = seriesItem.toMap();
    const QVariantList seasons = series.value(QStringLiteral("seasons")).toList();
    for (int seasonIndex = 0; seasonIndex < seasons.size(); ++seasonIndex) {
      const QVariantMap season = seasons[seasonIndex].toMap();
      const QVariantList episodes = season.value(QStringLiteral("episodes")).toList();
      for (int episodeIndex = 0; episodeIndex < episodes.size(); ++episodeIndex) {
        const QVariantMap episode = episodes[episodeIndex].toMap();
        if (episode.value(QStringLiteral("id")).toString() != episodeId) {
          continue;
        }

        if (episodeIndex + 1 < episodes.size()) {
          QVariantMap nextEpisode = episodes[episodeIndex + 1].toMap();
          nextEpisode.insert(QStringLiteral("seriesId"), series.value(QStringLiteral("id")).toString());
          nextEpisode.insert(QStringLiteral("seriesTitle"), series.value(QStringLiteral("title")).toString());
          return nextEpisode;
        }

        for (int nextSeasonIndex = seasonIndex + 1; nextSeasonIndex < seasons.size(); ++nextSeasonIndex) {
          const QVariantMap nextSeason = seasons[nextSeasonIndex].toMap();
          const QVariantList nextEpisodes = nextSeason.value(QStringLiteral("episodes")).toList();
          if (nextEpisodes.isEmpty()) {
            continue;
          }

          QVariantMap nextEpisode = nextEpisodes.first().toMap();
          nextEpisode.insert(QStringLiteral("seriesId"), series.value(QStringLiteral("id")).toString());
          nextEpisode.insert(QStringLiteral("seriesTitle"), series.value(QStringLiteral("title")).toString());
          return nextEpisode;
        }
      }
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

void ApiClient::beginRequest() {
  m_activeRequests += 1;
  setBusy(m_activeRequests > 0);
}

void ApiClient::endRequest() {
  m_activeRequests = qMax(0, m_activeRequests - 1);
  setBusy(m_activeRequests > 0);
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

QVariantMap ApiClient::mapEpisodeFromJson(const QJsonObject &item) {
  QVariantMap row;
  row.insert(QStringLiteral("id"), item.value(QStringLiteral("id")).toString());
  row.insert(QStringLiteral("title"), item.value(QStringLiteral("title")).toString());
  row.insert(QStringLiteral("seasonNumber"), item.value(QStringLiteral("seasonNumber")).toInt());
  row.insert(QStringLiteral("episodeNumber"), item.value(QStringLiteral("episodeNumber")).toInt());
  row.insert(QStringLiteral("streamUrl"), item.value(QStringLiteral("streamUrl")).toString());
  row.insert(QStringLiteral("playbackAllowed"), item.value(QStringLiteral("playbackAllowed")).toBool());
  return row;
}

QVariantMap ApiClient::mapSeriesFromJson(const QJsonObject &item) {
  QVariantMap row;
  row.insert(QStringLiteral("id"), item.value(QStringLiteral("id")).toString());
  row.insert(QStringLiteral("title"), item.value(QStringLiteral("title")).toString());
  row.insert(QStringLiteral("posterUrl"), item.value(QStringLiteral("posterUrl")).toString());
  row.insert(QStringLiteral("groupTitle"), item.value(QStringLiteral("groupTitle")).toString());
  row.insert(QStringLiteral("seasonCount"), item.value(QStringLiteral("seasonCount")).toInt());
  row.insert(QStringLiteral("episodeCount"), item.value(QStringLiteral("episodeCount")).toInt());

  const QJsonObject featuredEpisode = item.value(QStringLiteral("featuredEpisode")).toObject();
  row.insert(
    QStringLiteral("featuredEpisode"),
    featuredEpisode.isEmpty() ? QVariantMap() : mapEpisodeFromJson(featuredEpisode)
  );

  QVariantList seasons;
  const QJsonArray seasonsArray = item.value(QStringLiteral("seasons")).toArray();
  seasons.reserve(seasonsArray.size());
  for (const QJsonValue &seasonValue : seasonsArray) {
    const QJsonObject season = seasonValue.toObject();
    QVariantMap seasonRow;
    seasonRow.insert(QStringLiteral("seasonNumber"), season.value(QStringLiteral("seasonNumber")).toInt());
    seasonRow.insert(QStringLiteral("title"), season.value(QStringLiteral("title")).toString());
    seasonRow.insert(QStringLiteral("episodeCount"), season.value(QStringLiteral("episodeCount")).toInt());

    QVariantList episodes;
    const QJsonArray episodesArray = season.value(QStringLiteral("episodes")).toArray();
    episodes.reserve(episodesArray.size());
    for (const QJsonValue &episodeValue : episodesArray) {
      episodes.push_back(mapEpisodeFromJson(episodeValue.toObject()));
    }

    seasonRow.insert(QStringLiteral("episodes"), episodes);
    seasons.push_back(seasonRow);
  }

  row.insert(QStringLiteral("seasons"), seasons);
  return row;
}

void ApiClient::updateMoviesFromJson(const QJsonArray &items) {
  QVariantList nextItems;
  nextItems.reserve(items.size());

  for (const QJsonValue &value : items) {
    const QJsonObject item = value.toObject();
    QVariantMap row;
    row.insert(QStringLiteral("id"), item.value(QStringLiteral("id")).toString());
    row.insert(QStringLiteral("title"), item.value(QStringLiteral("title")).toString());
    row.insert(QStringLiteral("posterUrl"), item.value(QStringLiteral("posterUrl")).toString());
    row.insert(QStringLiteral("groupTitle"), item.value(QStringLiteral("groupTitle")).toString());
    row.insert(QStringLiteral("streamUrl"), item.value(QStringLiteral("streamUrl")).toString());
    row.insert(QStringLiteral("playbackAllowed"), item.value(QStringLiteral("playbackAllowed")).toBool());
    nextItems.push_back(row);
  }

  m_movies = nextItems;
  emit moviesChanged();
}

void ApiClient::updateSeriesFromJson(const QJsonArray &items) {
  QVariantList nextItems;
  nextItems.reserve(items.size());

  for (const QJsonValue &value : items) {
    nextItems.push_back(mapSeriesFromJson(value.toObject()));
  }

  m_series = nextItems;
  emit seriesChanged();
}
