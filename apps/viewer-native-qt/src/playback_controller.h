#pragma once

#include <QJsonObject>
#include <QList>
#include <QObject>
#include <vlc/vlc.h>

class ApiClient;

class PlaybackController : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString state READ state NOTIFY stateChanged)
  Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
  Q_PROPERTY(QString activeChannelId READ activeChannelId NOTIFY activeChannelIdChanged)
  Q_PROPERTY(QString diagnosticsSessionId READ diagnosticsSessionId NOTIFY diagnosticsSessionIdChanged)
  Q_PROPERTY(QString decoderMode READ decoderMode NOTIFY decoderModeChanged)
  Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)

public:
  explicit PlaybackController(ApiClient *apiClient, QObject *parent = nullptr);
  ~PlaybackController() override;

  QString state() const;
  QString lastError() const;
  QString activeChannelId() const;
  QString diagnosticsSessionId() const;
  QString decoderMode() const;
  bool busy() const;

  Q_INVOKABLE void playChannel(const QString &channelId);
  Q_INVOKABLE void retryCurrent();
  Q_INVOKABLE void stop();
  Q_INVOKABLE void setVideoSurfaceHandle(qulonglong handle);

signals:
  void stateChanged();
  void lastErrorChanged();
  void activeChannelIdChanged();
  void diagnosticsSessionIdChanged();
  void decoderModeChanged();
  void busyChanged();

private:
  struct ChannelCandidate {
    QString channelId;
    QString title;
    QString variantGroupKey;
    int qualityRank = -1;
  };

  void setState(const QString &value);
  void setLastError(const QString &value);
  void setActiveChannelId(const QString &value);
  void setDiagnosticsSessionId(const QString &value);
  void setDecoderMode(const QString &value);
  void setBusy(bool value);

  QList<ChannelCandidate> buildCandidateQueue(const QString &channelId) const;
  void resolveCandidateAt(int index);
  void openResolvedSource(const QJsonObject &source);
  void advanceToNextCandidate(const QString &reason);
  void retryCurrentSourceInSoftwareMode(const QString &reason);
  void recreatePlayer();
  void attachPlayerEvents();
  void bindVideoSurface();
  void reportPlaybackEvent(const QString &event, const QString &nativeState, const QString &errorCode, const QString &errorMessage);

  void handlePlaying();
  void handleBuffering(float percent);
  void handleEncounteredError();
  void handleStopped();

  static void handleVlcEvent(const libvlc_event_t *event, void *opaque);

  ApiClient *m_apiClient = nullptr;
  libvlc_instance_t *m_vlc = nullptr;
  libvlc_media_player_t *m_player = nullptr;
  qulonglong m_videoSurfaceHandle = 0;
  QList<ChannelCandidate> m_candidates;
  int m_candidateIndex = -1;
  bool m_busy = false;
  bool m_retryingSoftwareDecode = false;
  QString m_state = QStringLiteral("idle");
  QString m_lastError;
  QString m_activeChannelId;
  QString m_diagnosticsSessionId;
  QString m_decoderMode = QStringLiteral("hardware");
  QJsonObject m_lastResolvedSource;
};
