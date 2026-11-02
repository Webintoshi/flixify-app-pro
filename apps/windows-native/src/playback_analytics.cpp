#include "playback_analytics.h"
#include "analytics.h"
#include <chrono>
#include <utility>

PlaybackAnalytics::PlaybackAnalytics(Sink sink, std::function<qint64()> clock)
    : sink_(std::move(sink)), clock_(std::move(clock)) {
    if (!clock_) clock_ = &PlaybackAnalytics::monotonicNow;
}
qint64 PlaybackAnalytics::monotonicNow() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
void PlaybackAnalytics::setEnabled(bool enabled) {
    if (enabled_ == enabled) return;
    enabled_ = enabled; active_ = false; started_ = false; wasWatching_ = false;
    awaitingAdmission_ = false; buffering_ = false; errored_ = false; content_.clear(); watchMs_ = 0;
}
void PlaybackAnalytics::emitEvent(const QString &name, QVariantMap params) {
    if (!enabled_ || !active_) return;
    for (auto it = content_.cbegin(); it != content_.cend(); ++it) params.insert(it.key(), it.value());
    if (DesktopAnalytics::safeEvent(name, params)) sink_(name, std::move(params));
}
void PlaybackAnalytics::request(const QVariantMap &item) { request(item,clock_(),false); }
void PlaybackAnalytics::request(const QVariantMap &item,qint64 requestedAt,bool awaitAdmission) {
    if (!enabled_) return;
    const auto reference = DesktopAnalytics::contentReference(item);
    if (reference.isEmpty()) return;
    finish("replaced");
    content_ = {{"content_type", item.value("kind").toString().toLower()}, {"content_id", reference}};
    const auto label = DesktopAnalytics::catalogLabel(item.value("title").toString());
    if (!label.isEmpty()) content_.insert("content_name", label);
    requestedAt_ = qBound(qint64(0),requestedAt,clock_()); sampledAt_=clock_();awaitingAdmission_=awaitAdmission; watchMs_ = 0; bufferAt_ = 0;
    bufferCount_ = milestones_ = 0; active_ = true; started_ = errored_ = wasWatching_ = buffering_ = false;
    emitEvent("playback_request", {{"status", "requested"}});
}
void PlaybackAnalytics::admit(const QVariantMap &item) {
    if(!enabled_||!active_||!awaitingAdmission_)return;const auto reference=DesktopAnalytics::contentReference(item);if(reference.isEmpty())return;
    content_={{"content_type",item.value("kind").toString().toLower()},{"content_id",reference}};const auto label=DesktopAnalytics::catalogLabel(item.value("title").toString());if(!label.isEmpty())content_["content_name"]=label;awaitingAdmission_=false;sampledAt_=clock_();
}
void PlaybackAnalytics::preflightFailed(const QString &reason) {
    if(!enabled_||!active_||!awaitingAdmission_)return;if(reason!="canceled")emitEvent("playback_error",{{"reason",reason},{"status","error"}});errored_=reason!="canceled";finish(reason);
}
void PlaybackAnalytics::accrue(qint64 now) {
    if (wasWatching_) watchMs_ = qMin(qint64(86400000), watchMs_ + qBound(qint64(0), now - sampledAt_, qint64(60000)));
    sampledAt_ = now;
}
void PlaybackAnalytics::finishBuffer(qint64 now) {
    if (!buffering_) return;
    buffering_ = false;
    emitEvent("playback_buffer", {{"buffer_ms", qBound(qint64(0), now - bufferAt_, qint64(86400000))}, {"buffer_count", bufferCount_}});
}
void PlaybackAnalytics::observe(Sample sample) {
    if (!enabled_ || !active_ || awaitingAdmission_) return;
    const auto now = clock_(); accrue(now);
    if (sample.error && !errored_) {
        errored_ = true; emitEvent("playback_error", {{"reason", "unknown"}, {"status", "error"}});
    }
    if (!sample.active) { finish(sample.error ? "error" : "user"); return; }
    if (!started_ && sample.hasFrame) {
        started_ = true;
        emitEvent("video_start", {{"startup_ms", qBound(qint64(0), now - requestedAt_, qint64(600000))}, {"status", "playing"}});
    }
    const bool waitingForMedia=sample.wantsPlayback&&(sample.buffering||sample.recovering||sample.loading);
    if (started_ && waitingForMedia && !buffering_) {
        buffering_ = true; bufferAt_ = now; bufferCount_ = qMin(bufferCount_ + 1, 10000);
    }
    if (buffering_ && (!sample.wantsPlayback||sample.error||sample.playing&&!waitingForMedia)) finishBuffer(now);
    wasWatching_ = started_ && sample.hasFrame && sample.wantsPlayback && sample.playing && !waitingForMedia && !sample.error;
    if (started_ && content_.value("content_type") != "live" && sample.duration > 0 && sample.position >= 0) {
        for (int milestone = 0; milestone < 3; ++milestone) {
            const int percent = 25 * (milestone + 1);
            if (!(milestones_ & (1 << milestone)) && double(sample.position) / double(sample.duration) >= double(percent) / 100.0) {
                milestones_ |= 1 << milestone;
                emitEvent("video_progress", {{"progress_percent", percent}, {"watch_ms", watchMs_}});
            }
        }
    }
}
void PlaybackAnalytics::complete() {
    if (!enabled_ || !active_ || !started_ || content_.value("content_type") == "live") return;
    const auto now = clock_(); accrue(now); wasWatching_ = false;
    finishBuffer(now);
    emitEvent("video_complete", {{"progress_percent", 100}, {"watch_ms", watchMs_}, {"status", "completed"}});
    finish("completed");
}
void PlaybackAnalytics::finish(const QString &reason) {
    if (!enabled_ || !active_) return;
    const auto now = clock_(); accrue(now); wasWatching_ = false;
    finishBuffer(now);
    emitEvent("playback_end", {{"reason", reason}, {"watch_ms", watchMs_}, {"status", errored_ ? "error" : "closed"}});
    active_ = false; content_.clear();
}
