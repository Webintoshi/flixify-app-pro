#include "api_client.h"

#include <QCoreApplication>
#include <QClipboard>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkReply>
#include <QProcess>
#include <QRegularExpression>
#include <QSettings>
#include <QStandardPaths>
#include <QTimer>
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

bool isAuthStatus(const QNetworkReply *reply) {
  const int status = reply ? reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() : 0;
  return status == 401 || status == 403;
}

QNetworkRequest makeJsonRequest(const QUrl &url, const QString &accessToken = QString()) {
  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setRawHeader("Accept", "application/json");
  request.setRawHeader("X-Flixify-Client-Runtime", "native");
  if (!accessToken.trimmed().isEmpty()) {
    request.setRawHeader("Authorization", QByteArray("Bearer ") + accessToken.trimmed().toUtf8());
  }
  return request;
}

QString sanitizeFileStem(const QString &value) {
  QString stem = value.trimmed();
  stem.replace(QRegularExpression(QStringLiteral("[^a-zA-Z0-9_-]+")), QStringLiteral("-"));
  stem.replace(QRegularExpression(QStringLiteral("-{2,}")), QStringLiteral("-"));
  stem = stem.trimmed();
  if (stem.startsWith(QLatin1Char('-'))) {
    stem.remove(0, 1);
  }
  if (stem.endsWith(QLatin1Char('-'))) {
    stem.chop(1);
  }
  return stem.isEmpty() ? QStringLiteral("flixify") : stem.left(48);
}

QVariantList mapJsonArray(const QJsonArray &items) {
  QVariantList mapped;
  mapped.reserve(items.size());
  for (const QJsonValue &value : items) {
    mapped.push_back(value.toObject().toVariantMap());
  }
  return mapped;
}

}

ApiClient::ApiClient(QObject *parent)
  : QObject(parent) {
  QSettings settings;
  const QString storedAccessToken = settings.value(QStringLiteral("session/accessToken")).toString().trimmed();
  const QString storedRefreshToken = settings.value(QStringLiteral("session/refreshToken")).toString().trimmed();
  if (!storedAccessToken.isEmpty()) {
    m_accessToken = storedAccessToken;
  }
  if (!storedRefreshToken.isEmpty()) {
    m_refreshToken = storedRefreshToken;
  }
}

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

  const bool wasAuthenticated = authenticated();
  m_accessToken = trimmed;
  QSettings settings;
  if (m_accessToken.isEmpty()) {
    settings.remove(QStringLiteral("session/accessToken"));
  } else {
    settings.setValue(QStringLiteral("session/accessToken"), m_accessToken);
  }
  emit accessTokenChanged();
  if (wasAuthenticated != authenticated()) {
    emit authenticatedChanged();
  }
}

void ApiClient::setRefreshToken(const QString &value) {
  const QString trimmed = value.trimmed();
  if (trimmed == m_refreshToken) {
    return;
  }

  m_refreshToken = trimmed;
  QSettings settings;
  if (m_refreshToken.isEmpty()) {
    settings.remove(QStringLiteral("session/refreshToken"));
  } else {
    settings.setValue(QStringLiteral("session/refreshToken"), m_refreshToken);
  }
}

void ApiClient::setSessionTokens(const QString &accessToken, const QString &refreshToken) {
  setRefreshToken(refreshToken);
  setAccessToken(accessToken);
}

bool ApiClient::authenticated() const {
  return !m_accessToken.isEmpty();
}

bool ApiClient::restoringSession() const {
  return m_restoringSession;
}

bool ApiClient::busy() const {
  return m_busy;
}

QString ApiClient::lastError() const {
  return m_lastError;
}

QString ApiClient::notice() const {
  return m_notice;
}

QVariantMap ApiClient::me() const {
  return m_me;
}

QVariantList ApiClient::packages() const {
  return m_packages;
}

QVariantList ApiClient::paymentMethods() const {
  return m_paymentMethods;
}

QVariantList ApiClient::paymentRequests() const {
  return m_paymentRequests;
}

QVariantMap ApiClient::appUpdate() const {
  return m_appUpdate;
}

bool ApiClient::updateInProgress() const {
  return m_updateInProgress;
}

double ApiClient::updateProgress() const {
  return m_updateProgress;
}

QString ApiClient::updateError() const {
  return m_updateError;
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
  return makeJsonRequest(resolvedUrl(path), m_accessToken);
}

void ApiClient::bootstrap() {
  setLastError(QString());
  fetchPackages();
  fetchPaymentMethods();

  if (authenticated()) {
    fetchShellData();
    return;
  }

  if (m_refreshToken.isEmpty()) {
    clearAuthenticatedData();
    return;
  }

  setRestoringSession(true);
  refreshSession([this](bool success) {
    setRestoringSession(false);
    if (success) {
      fetchShellData();
      return;
    }
    clearAuthenticatedData();
  });
}

void ApiClient::issueAnonCode(const QString &deviceName, const QString &platform) {
  beginRequest();
  setLastError(QString());
  setNotice(QString());

  QJsonObject payload;
  payload.insert(QStringLiteral("deviceName"), deviceName.trimmed().isEmpty() ? QStringLiteral("Flixify Native Qt") : deviceName.trimmed());
  payload.insert(
    QStringLiteral("platform"),
    platform.trimmed().isEmpty() ? normalizedPlatformName() : platform.trimmed()
  );

  QNetworkReply *reply = m_network.post(
    makeJsonRequest(resolvedUrl(QStringLiteral("/auth/register-anon"))),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );

  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    endRequest();

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Kayit kodu olusturulamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("register"), message);
      return;
    }

    const QString code = QJsonDocument::fromJson(body).object().value(QStringLiteral("kryptoniteCode")).toString().trimmed();
    if (!code.isEmpty()) {
      emit anonCodeIssued(code);
      setNotice(QStringLiteral("Hesap numarasi olusturuldu."));
    }
  });
}

void ApiClient::loginByCode(const QString &code, const QString &deviceName, const QString &platform) {
  beginRequest();
  setLastError(QString());
  setNotice(QString());

  QJsonObject payload;
  payload.insert(QStringLiteral("code"), code.trimmed());
  payload.insert(QStringLiteral("deviceName"), deviceName.trimmed().isEmpty() ? QStringLiteral("Flixify Native Qt") : deviceName.trimmed());
  payload.insert(
    QStringLiteral("platform"),
    platform.trimmed().isEmpty() ? normalizedPlatformName() : platform.trimmed()
  );

  QNetworkReply *reply = m_network.post(
    makeJsonRequest(resolvedUrl(QStringLiteral("/auth/login-by-code"))),
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

    const QJsonObject root = QJsonDocument::fromJson(body).object();
    setSessionTokens(
      root.value(QStringLiteral("accessToken")).toString(),
      root.value(QStringLiteral("refreshToken")).toString()
    );
    setNotice(QString());
    fetchShellData();
    emit loginSucceeded();
  });
}

void ApiClient::logout() {
  setSessionTokens(QString(), QString());
  clearAuthenticatedData();
  setLastError(QString());
  setNotice(QString());
  setRestoringSession(false);
  emit logoutCompleted();
  fetchPackages();
  fetchPaymentMethods();
}

void ApiClient::refreshSession(std::function<void(bool)> completion) {
  if (completion) {
    m_refreshCompletions.push_back(std::move(completion));
  }

  if (m_refreshInFlight) {
    return;
  }

  if (m_refreshToken.trimmed().isEmpty()) {
    const auto completions = std::move(m_refreshCompletions);
    m_refreshCompletions.clear();
    for (const auto &callback : completions) {
      if (callback) {
        callback(false);
      }
    }
    return;
  }

  m_refreshInFlight = true;
  beginRequest();

  QJsonObject payload;
  payload.insert(QStringLiteral("refreshToken"), m_refreshToken);

  QNetworkReply *reply = m_network.post(
    makeJsonRequest(resolvedUrl(QStringLiteral("/auth/refresh"))),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );

  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    m_refreshInFlight = false;
    endRequest();

    const auto completions = std::move(m_refreshCompletions);
    m_refreshCompletions.clear();

    if (!ok) {
      setSessionTokens(QString(), QString());
      clearAuthenticatedData();
      for (const auto &callback : completions) {
        if (callback) {
          callback(false);
        }
      }
      return;
    }

    const QJsonObject root = QJsonDocument::fromJson(body).object();
    setSessionTokens(
      root.value(QStringLiteral("accessToken")).toString(),
      root.value(QStringLiteral("refreshToken")).toString()
    );

    const QJsonObject user = root.value(QStringLiteral("user")).toObject();
    if (!user.isEmpty()) {
      QVariantMap nextMe = m_me;
      nextMe.insert(QStringLiteral("user"), user.toVariantMap());
      setMe(nextMe);
    }

    for (const auto &callback : completions) {
      if (callback) {
        callback(true);
      }
    }
  });
}

void ApiClient::fetchMe() {
  if (!authenticated()) {
    setMe({});
    return;
  }

  beginRequest();
  QNetworkReply *reply = m_network.get(authorizedRequest(QStringLiteral("/me")));
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("me"), [this]() { fetchMe(); });
        return;
      }

      const QString message = extractApiErrorMessage(body, QStringLiteral("Profil bilgileri alinamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("me"), message);
      return;
    }

    setMe(QJsonDocument::fromJson(body).object().toVariantMap());
  });
}

void ApiClient::fetchPackages() {
  beginRequest();
  QNetworkReply *reply = m_network.get(makeJsonRequest(resolvedUrl(QStringLiteral("/admin/packages/public"))));
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    endRequest();

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Paketler alinamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("packages"), message);
      return;
    }

    const QVariantList items = mapJsonArray(QJsonDocument::fromJson(body).object().value(QStringLiteral("items")).toArray());
    setPackages(items);
  });
}

void ApiClient::fetchPaymentMethods() {
  beginRequest();
  QNetworkReply *reply = m_network.get(makeJsonRequest(resolvedUrl(QStringLiteral("/payment-methods/public"))));
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    endRequest();

    if (!ok) {
      const QString message = extractApiErrorMessage(body, QStringLiteral("Odeme yontemleri alinamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("payment-methods"), message);
      return;
    }

    const QVariantList items = mapJsonArray(QJsonDocument::fromJson(body).object().value(QStringLiteral("items")).toArray());
    setPaymentMethods(items);
  });
}

void ApiClient::fetchPaymentRequests() {
  if (!authenticated()) {
    setPaymentRequests({});
    return;
  }

  beginRequest();
  QNetworkReply *reply = m_network.get(authorizedRequest(QStringLiteral("/me/payment-requests")));
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("payments"), [this]() { fetchPaymentRequests(); });
        return;
      }

      const QString message = extractApiErrorMessage(body, QStringLiteral("Odeme talepleri alinamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("payments"), message);
      return;
    }

    const QVariantList items = mapJsonArray(QJsonDocument::fromJson(body).object().value(QStringLiteral("items")).toArray());
    setPaymentRequests(items);
  });
}

void ApiClient::fetchShellData(const QString &search) {
  fetchMe();
  fetchPaymentRequests();
  fetchAllCatalogs(search);
  checkAppUpdate();
}

void ApiClient::checkAppUpdate() {
  if (!authenticated()) {
    setAppUpdate({});
    return;
  }

  beginRequest();
  QUrl url = resolvedUrl(QStringLiteral("/me/app-update/check"));
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("platform"), normalizedPlatformName());
  query.addQueryItem(QStringLiteral("appVersion"), QStringLiteral(FLIXIFY_APP_VERSION));
  url.setQuery(query);

  QNetworkReply *reply = m_network.get(makeJsonRequest(url, m_accessToken));
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("app-update"), [this]() { checkAppUpdate(); });
        return;
      }
      setAppUpdate({});
      return;
    }

    const QVariantMap payload = QJsonDocument::fromJson(body).object().toVariantMap();
    if (payload.value(QStringLiteral("updateAvailable")).toBool()) {
      setAppUpdate(payload);
    } else {
      setAppUpdate({});
    }
  });
}

void ApiClient::installAppUpdate() {
  if (m_updateInProgress) {
    return;
  }

  const QString downloadUrl = m_appUpdate.value(QStringLiteral("downloadUrl")).toString().trimmed();
  const QString latestVersion = m_appUpdate.value(QStringLiteral("latestVersion")).toString().trimmed();
  if (downloadUrl.isEmpty()) {
    const QString message = QStringLiteral("Guncelleme baglantisi bulunamadi.");
    setUpdateError(message);
    emit requestFailed(QStringLiteral("app-update-install"), message);
    return;
  }

  QUrl url(downloadUrl);
  if (!url.isValid()) {
    const QString message = QStringLiteral("Guncelleme baglantisi gecersiz.");
    setUpdateError(message);
    emit requestFailed(QStringLiteral("app-update-install"), message);
    return;
  }

  QString tempRoot = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
  if (tempRoot.trimmed().isEmpty()) {
    tempRoot = QDir::tempPath();
  }
  if (tempRoot.trimmed().isEmpty()) {
    const QString message = QStringLiteral("Gecici klasor bulunamadi.");
    setUpdateError(message);
    emit requestFailed(QStringLiteral("app-update-install"), message);
    return;
  }

  QDir tempDir(tempRoot);
  if (!tempDir.mkpath(QStringLiteral("Flixify/updates"))) {
    const QString message = QStringLiteral("Guncelleme klasoru olusturulamadi.");
    setUpdateError(message);
    emit requestFailed(QStringLiteral("app-update-install"), message);
    return;
  }

  const QString filename = latestVersion.isEmpty()
    ? QStringLiteral("Flixify-Pro-Setup-latest.exe")
    : QStringLiteral("Flixify-Pro-Setup-%1.exe").arg(sanitizeFileStem(latestVersion));
  m_updateInstallerPath = tempDir.filePath(QStringLiteral("Flixify/updates/%1").arg(filename));

  if (m_updateFile) {
    m_updateFile->close();
    m_updateFile->deleteLater();
    m_updateFile = nullptr;
  }

  if (QFile::exists(m_updateInstallerPath)) {
    QFile::remove(m_updateInstallerPath);
  }

  m_updateFile = new QFile(m_updateInstallerPath, this);
  if (!m_updateFile->open(QIODevice::WriteOnly | QIODevice::Truncate)) {
    const QString message = QStringLiteral("Guncelleme dosyasi yazilamadi.");
    setUpdateError(message);
    emit requestFailed(QStringLiteral("app-update-install"), message);
    m_updateFile->deleteLater();
    m_updateFile = nullptr;
    return;
  }

  QNetworkRequest request(url);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  request.setRawHeader("Accept", "application/octet-stream");

  setUpdateError(QString());
  setNotice(QString());
  setUpdateProgress(0.0);
  setUpdateInProgress(true);

  m_updateReply = m_network.get(request);

  connect(m_updateReply, &QNetworkReply::readyRead, this, [this]() {
    if (!m_updateReply || !m_updateFile) {
      return;
    }
    const QByteArray chunk = m_updateReply->readAll();
    if (!chunk.isEmpty()) {
      m_updateFile->write(chunk);
    }
  });

  connect(m_updateReply, &QNetworkReply::downloadProgress, this, [this](qint64 received, qint64 total) {
    if (total > 0) {
      setUpdateProgress(static_cast<double>(received) / static_cast<double>(total));
    }
  });

  connect(m_updateReply, &QNetworkReply::finished, this, [this]() {
    const QByteArray tail = m_updateReply ? m_updateReply->readAll() : QByteArray();
    const bool ok = m_updateReply && m_updateReply->error() == QNetworkReply::NoError;
    const int status = m_updateReply
      ? m_updateReply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt()
      : 0;
    if (m_updateReply) {
      m_updateReply->deleteLater();
      m_updateReply = nullptr;
    }

    if (m_updateFile) {
      if (!tail.isEmpty()) {
        m_updateFile->write(tail);
      }
      m_updateFile->flush();
      m_updateFile->close();
      m_updateFile->deleteLater();
      m_updateFile = nullptr;
    }

    setUpdateInProgress(false);

    if (!ok || status < 200 || status >= 300) {
      QFile::remove(m_updateInstallerPath);
      const QString message = QStringLiteral("Guncelleme indirilemedi.");
      setUpdateError(message);
      emit requestFailed(QStringLiteral("app-update-install"), message);
      return;
    }

    QFileInfo installerInfo(m_updateInstallerPath);
    if (!installerInfo.exists() || installerInfo.size() <= 0) {
      QFile::remove(m_updateInstallerPath);
      const QString message = QStringLiteral("Guncelleme dosyasi eksik indirildi.");
      setUpdateError(message);
      emit requestFailed(QStringLiteral("app-update-install"), message);
      return;
    }

    setUpdateProgress(1.0);
    const bool started = QProcess::startDetached(QDir::toNativeSeparators(m_updateInstallerPath), {});
    if (!started) {
      const QString message = QStringLiteral("Installer baslatilamadi.");
      setUpdateError(message);
      emit requestFailed(QStringLiteral("app-update-install"), message);
      return;
    }

    setUpdateError(QString());
    setNotice(QStringLiteral("Guncelleme indirildi. Installer baslatiliyor."));
    QTimer::singleShot(300, QCoreApplication::instance(), &QCoreApplication::quit);
  });
}

void ApiClient::fetchLiveCatalog(int page, int pageSize, const QString &search) {
  const int safePage = page > 0 ? page : 1;
  const int safePageSize = qBound(1, pageSize, 300);
  const QString safeSearch = search;

  beginRequest();
  QUrl url = resolvedUrl(QStringLiteral("/me/catalog/live"));
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("page"), QString::number(safePage));
  query.addQueryItem(QStringLiteral("pageSize"), QString::number(safePageSize));
  if (!safeSearch.trimmed().isEmpty()) {
    query.addQueryItem(QStringLiteral("search"), safeSearch.trimmed());
  }
  url.setQuery(query);

  QNetworkReply *reply = m_network.get(makeJsonRequest(url, m_accessToken));
  connect(reply, &QNetworkReply::finished, this, [this, reply, safePage, safePageSize, safeSearch]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("catalog"), [this, safePage, safePageSize, safeSearch]() {
          fetchLiveCatalog(safePage, safePageSize, safeSearch);
        });
        return;
      }

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
  const int safePage = page > 0 ? page : 1;
  const int safePageSize = qBound(1, pageSize, 300);
  const QString safeSearch = search;

  beginRequest();
  QUrl url = resolvedUrl(QStringLiteral("/me/catalog/movies"));
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("page"), QString::number(safePage));
  query.addQueryItem(QStringLiteral("pageSize"), QString::number(safePageSize));
  if (!safeSearch.trimmed().isEmpty()) {
    query.addQueryItem(QStringLiteral("search"), safeSearch.trimmed());
  }
  url.setQuery(query);

  QNetworkReply *reply = m_network.get(makeJsonRequest(url, m_accessToken));
  connect(reply, &QNetworkReply::finished, this, [this, reply, safePage, safePageSize, safeSearch]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("movies"), [this, safePage, safePageSize, safeSearch]() {
          fetchMovieCatalog(safePage, safePageSize, safeSearch);
        });
        return;
      }

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
  const int safePage = page > 0 ? page : 1;
  const int safePageSize = qBound(1, pageSize, 300);
  const QString safeSearch = search;

  beginRequest();
  QUrl url = resolvedUrl(QStringLiteral("/me/catalog/series"));
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("page"), QString::number(safePage));
  query.addQueryItem(QStringLiteral("pageSize"), QString::number(safePageSize));
  if (!safeSearch.trimmed().isEmpty()) {
    query.addQueryItem(QStringLiteral("search"), safeSearch.trimmed());
  }
  url.setQuery(query);

  QNetworkReply *reply = m_network.get(makeJsonRequest(url, m_accessToken));
  connect(reply, &QNetworkReply::finished, this, [this, reply, safePage, safePageSize, safeSearch]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("series"), [this, safePage, safePageSize, safeSearch]() {
          fetchSeriesCatalog(safePage, safePageSize, safeSearch);
        });
        return;
      }

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

void ApiClient::requestPayment(const QString &packageSlug) {
  const QString normalizedPackageSlug = packageSlug.trimmed();
  if (normalizedPackageSlug.isEmpty() || !authenticated()) {
    return;
  }

  beginRequest();
  setLastError(QString());

  QJsonObject payload;
  payload.insert(QStringLiteral("packageSlug"), normalizedPackageSlug);

  QNetworkReply *reply = m_network.post(
    authorizedRequest(QStringLiteral("/me/payment-requests")),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );

  connect(reply, &QNetworkReply::finished, this, [this, reply, normalizedPackageSlug]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("payment-request"), [this, normalizedPackageSlug]() {
          requestPayment(normalizedPackageSlug);
        });
        return;
      }

      const QString message = extractApiErrorMessage(body, QStringLiteral("Odeme talebi olusturulamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("payment-request"), message);
      return;
    }

    setNotice(QStringLiteral("Odeme talebi olusturuldu. Lutfen destek ekibi ile iletisime gecin."));
    fetchPaymentRequests();
  });
}

void ApiClient::requestTrial(const QString &note) {
  if (!authenticated()) {
    return;
  }

  beginRequest();
  setLastError(QString());

  const QString normalizedNote = note.trimmed();
  QJsonObject payload;
  if (!normalizedNote.isEmpty()) {
    payload.insert(QStringLiteral("note"), normalizedNote);
  }

  QNetworkReply *reply = m_network.post(
    authorizedRequest(QStringLiteral("/me/trial-request")),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );

  connect(reply, &QNetworkReply::finished, this, [this, reply, normalizedNote]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatus(reply);
    reply->deleteLater();
    endRequest();

    if (!ok) {
      if (authFailed) {
        handleAuthFailure(QStringLiteral("trial-request"), [this, normalizedNote]() {
          requestTrial(normalizedNote);
        });
        return;
      }

      const QString message = extractApiErrorMessage(body, QStringLiteral("Deneme talebi olusturulamadi."));
      setLastError(message);
      emit requestFailed(QStringLiteral("trial-request"), message);
      return;
    }

    setNotice(QStringLiteral("Deneme talebiniz olusturuldu."));
  });
}

bool ApiClient::copyText(const QString &value) const {
  if (value.trimmed().isEmpty()) {
    return false;
  }

  QClipboard *clipboard = QGuiApplication::clipboard();
  if (!clipboard) {
    return false;
  }

  clipboard->setText(value.trimmed());
  return true;
}

QString ApiClient::saveTextFile(const QString &nameHint, const QString &content) const {
  if (content.trimmed().isEmpty()) {
    return {};
  }

  QString baseDir = QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation);
  if (baseDir.trimmed().isEmpty()) {
    baseDir = QStandardPaths::writableLocation(QStandardPaths::HomeLocation);
  }
  if (baseDir.trimmed().isEmpty()) {
    return {};
  }

  QDir directory(baseDir);
  if (!directory.exists() && !directory.mkpath(QStringLiteral("."))) {
    return {};
  }

  const QString filename = QStringLiteral("%1-%2.txt")
                             .arg(sanitizeFileStem(nameHint))
                             .arg(QDateTime::currentDateTime().toString(QStringLiteral("yyyyMMdd-HHmmss")));
  const QString path = directory.filePath(filename);

  QFile file(path);
  if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
    return {};
  }

  file.write(content.toUtf8());
  file.close();
  return path;
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

void ApiClient::setRestoringSession(bool value) {
  if (value == m_restoringSession) {
    return;
  }

  m_restoringSession = value;
  emit restoringSessionChanged();
}

void ApiClient::setLastError(const QString &value) {
  if (value == m_lastError) {
    return;
  }

  m_lastError = value;
  emit lastErrorChanged();
}

void ApiClient::setNotice(const QString &value) {
  if (value == m_notice) {
    return;
  }

  m_notice = value;
  emit noticeChanged();
}

void ApiClient::setMe(const QVariantMap &value) {
  if (value == m_me) {
    return;
  }

  m_me = value;
  emit meChanged();
}

void ApiClient::setPackages(const QVariantList &value) {
  if (value == m_packages) {
    return;
  }

  m_packages = value;
  emit packagesChanged();
}

void ApiClient::setPaymentMethods(const QVariantList &value) {
  if (value == m_paymentMethods) {
    return;
  }

  m_paymentMethods = value;
  emit paymentMethodsChanged();
}

void ApiClient::setPaymentRequests(const QVariantList &value) {
  if (value == m_paymentRequests) {
    return;
  }

  m_paymentRequests = value;
  emit paymentRequestsChanged();
}

void ApiClient::setAppUpdate(const QVariantMap &value) {
  if (value == m_appUpdate) {
    return;
  }

  m_appUpdate = value;
  emit appUpdateChanged();
}

void ApiClient::setUpdateInProgress(bool value) {
  if (value == m_updateInProgress) {
    return;
  }

  m_updateInProgress = value;
  emit updateInProgressChanged();
}

void ApiClient::setUpdateProgress(double value) {
  const double normalized = qBound(0.0, value, 1.0);
  if (qFuzzyCompare(normalized, m_updateProgress)) {
    return;
  }

  m_updateProgress = normalized;
  emit updateProgressChanged();
}

void ApiClient::setUpdateError(const QString &value) {
  if (value == m_updateError) {
    return;
  }

  m_updateError = value;
  emit updateErrorChanged();
}

void ApiClient::beginRequest() {
  m_activeRequests += 1;
  setBusy(m_activeRequests > 0);
}

void ApiClient::endRequest() {
  m_activeRequests = qMax(0, m_activeRequests - 1);
  setBusy(m_activeRequests > 0);
}

void ApiClient::clearAuthenticatedData() {
  setMe({});
  setPaymentRequests({});
  setAppUpdate({});

  if (!m_liveChannels.isEmpty()) {
    m_liveChannels.clear();
    emit liveChannelsChanged();
  }
  if (!m_movies.isEmpty()) {
    m_movies.clear();
    emit moviesChanged();
  }
  if (!m_series.isEmpty()) {
    m_series.clear();
    emit seriesChanged();
  }
}

void ApiClient::handleAuthFailure(const QString &context, std::function<void()> retry) {
  if (m_refreshToken.trimmed().isEmpty()) {
    setLastError(QStringLiteral("Oturum suresi doldu. Lutfen tekrar giris yapin."));
    emit requestFailed(context, m_lastError);
    logout();
    return;
  }

  refreshSession([this, context, retry = std::move(retry)](bool success) {
    if (success) {
      if (retry) {
        retry();
      }
      return;
    }

    setRestoringSession(false);
    setLastError(QStringLiteral("Oturum suresi doldu. Lutfen tekrar giris yapin."));
    emit requestFailed(context, m_lastError);
    logout();
  });
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
    row.insert(QStringLiteral("streamUrl"), item.value(QStringLiteral("streamUrl")).toString());
    row.insert(QStringLiteral("playbackAllowed"), item.value(QStringLiteral("playbackAllowed")).toBool());
    row.insert(QStringLiteral("transport"), item.value(QStringLiteral("transport")).toString());
    row.insert(QStringLiteral("variantGroupKey"), item.value(QStringLiteral("variantGroupKey")).toString());
    row.insert(QStringLiteral("qualityRank"), item.value(QStringLiteral("qualityRank")).toInt(-1));
    row.insert(QStringLiteral("healthStatus"), item.value(QStringLiteral("healthStatus")).toString());
    row.insert(QStringLiteral("isVerified"), item.value(QStringLiteral("isVerified")).toBool());
    row.insert(QStringLiteral("lastCheckedAt"), item.value(QStringLiteral("lastCheckedAt")).toString());
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
