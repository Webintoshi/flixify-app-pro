#pragma once
#include <QString>
#include <QVariantMap>
#include <functional>

class PlaybackAnalytics final {
public:
    struct Sample {
        bool active = false, hasFrame = false, playing = false, loading = false, error = false;
        qint64 position = 0, duration = 0;
        bool wantsPlayback = false, recovering = false, buffering = false;
    };
    using Sink = std::function<void(QString, QVariantMap)>;
    explicit PlaybackAnalytics(Sink sink, std::function<qint64()> clock = {});
    void setEnabled(bool enabled);
    void request(const QVariantMap &item);
    void request(const QVariantMap &item, qint64 requestedAt, bool awaitAdmission);
    void admit(const QVariantMap &item);
    void preflightFailed(const QString &reason);
    static qint64 monotonicNow();
    void observe(Sample sample);
    void complete();
    void finish(const QString &reason);
private:
    void accrue(qint64 now);
    void finishBuffer(qint64 now);
    void emitEvent(const QString &name, QVariantMap params = {});
    Sink sink_;
    std::function<qint64()> clock_;
    QVariantMap content_;
    qint64 requestedAt_ = 0, sampledAt_ = 0, watchMs_ = 0, bufferAt_ = 0;
    int bufferCount_ = 0, milestones_ = 0;
    bool awaitingAdmission_ = false;
    bool enabled_ = false, active_ = false, started_ = false, errored_ = false, wasWatching_ = false, buffering_ = false;
};
