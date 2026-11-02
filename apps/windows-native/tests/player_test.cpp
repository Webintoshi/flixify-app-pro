#include "fake_vlc_runtime.h"
#include "player.h"
#include "playback_analytics.h"
#include <QCoreApplication>
#include <QDateTime>
#include <QSemaphore>
#include <QtTest>
#include <atomic>
#include <functional>
#include <thread>
#include <limits>

namespace {
QVariantMap media(const QString &id = "1") {
  return {{"item", QVariantMap{{"kind", "movie"}, {"id", id}, {"scope", "fixture:source"}}},
          {"url", "https://fixture.invalid/video.mp4"}, {"scope", "fixture:source"},
          {"expiresAt", QDateTime::currentMSecsSinceEpoch() + 60000}};
}
bool guiRunsWhileVlcBlocked(const QString &operation, const std::function<void()> &action,
                           const std::function<void()> &whileBlocked = {}) {
  FakeVlc::block(operation);
  QSemaphore marker;
  std::atomic_bool finished = false, responsive = false;
  std::thread observer([&] {
    if (FakeVlc::awaitBlocked()) {
      QMetaObject::invokeMethod(QCoreApplication::instance(), [&] {
        if (whileBlocked) whileBlocked();
        marker.release();
      }, Qt::QueuedConnection);
      responsive = marker.tryAcquire(1, 1500);
    }
    FakeVlc::unblock(); finished = true;
  });
  action();
  const bool observed = QTest::qWaitFor([&] { return finished.load(); }, 7000);
  observer.join();
  QCoreApplication::processEvents();
  return observed && responsive;
}
}

class PlayerTest : public QObject {
  Q_OBJECT
 private slots:
  void init() { FakeVlc::reset(); }
  void actualBufferingEventsAreObservedWithoutChangingPlaybackOrLoading() {
    DesktopPlayer player;player.setSurface(1);player.open(media());
    QTRY_VERIFY(player.playing()&&player.hasVideoFrame());
    FakeVlc::bufferAt(0);QTRY_VERIFY(player.buffering());
    QVERIFY(player.playing());QVERIFY(!player.loading());QVERIFY(player.wantsPlayback());
    FakeVlc::bufferAt(std::numeric_limits<float>::quiet_NaN());QTest::qWait(350);QVERIFY(player.buffering());
    FakeVlc::bufferAt(std::numeric_limits<float>::infinity());QTest::qWait(350);QVERIFY(player.buffering());
    FakeVlc::bufferAt(99);QTest::qWait(350);QVERIFY(player.buffering());
    FakeVlc::bufferAt(100);QTRY_VERIFY(!player.buffering());
    FakeVlc::bufferAt(-20);QTRY_VERIFY(player.buffering());
    FakeVlc::bufferAt(200);QTRY_VERIFY(!player.buffering());
    QVERIFY(player.playing());QVERIFY(!player.loading());player.releaseSurface(1);
  }
  void realPlayerSamplesExcludePauseFromBufferAndWatchDurations() {
    DesktopPlayer player;qint64 now=0;QList<QPair<QString,QVariantMap>> events;
    PlaybackAnalytics tracker([&](QString name,QVariantMap values){events.append({name,values});},[&]{return now;});
    tracker.setEnabled(true);tracker.request({{"kind","movie"},{"id","1"}});
    connect(&player,&DesktopPlayer::stateChanged,&player,[&]{tracker.observe({player.active(),player.hasVideoFrame(),player.playing(),player.loading(),!player.error().isEmpty(),player.positionMs(),player.durationMs(),player.wantsPlayback(),player.recovering(),player.buffering()});});
    player.setSurface(1);player.open(media());QTRY_VERIFY(player.hasVideoFrame());
    now=1000;FakeVlc::bufferAt(0);QTRY_VERIFY(player.buffering());
    now=3000;player.togglePause();QVERIFY(!player.wantsPlayback());
    now=23000;player.togglePause();QVERIFY(player.wantsPlayback());
    now=25000;FakeVlc::bufferAt(100);QTRY_VERIFY(!player.buffering());
    now=26000;player.close();player.releaseSurface(1);
    qint64 bufferMs=0,watchMs=-1;int buffers=0;
    for(const auto &event:events){if(event.first=="playback_buffer"){bufferMs+=event.second.value("buffer_ms").toLongLong();buffers++;}if(event.first=="playback_end")watchMs=event.second.value("watch_ms").toLongLong();}
    QCOMPARE(buffers,2);QCOMPARE(bufferMs,4000);QCOMPARE(watchMs,2000);
  }
  void lateBufferingFromReplacedSessionIsIgnored() {
    DesktopPlayer player;player.setSurface(1);player.open(media("old"));QTRY_VERIFY(player.hasVideoFrame());
    bool staleBuffer=false;connect(&player,&DesktopPlayer::stateChanged,&player,[&]{if(player.item().value("id")=="new"&&player.buffering())staleBuffer=true;});
    FakeVlc::bufferAt(0);
    QVERIFY(guiRunsWhileVlcBlocked("time",[]{},[&]{player.open(media("new"));}));
    QTRY_VERIFY(player.playing()&&player.item().value("id")=="new");QVERIFY(!player.buffering());QVERIFY(!staleBuffer);player.releaseSurface(1);
  }
  void failedBufferingAttachmentKeepsPrefixTeardownSafe() {
    DesktopPlayer player;player.setSurface(1);FakeVlc::failAttach(0x103);player.open(media());QTRY_VERIFY(!player.error().isEmpty());player.releaseSurface(1);
    const auto calls=FakeVlc::calls();QCOMPARE(calls.count("attach"),6);QCOMPARE(calls.count("detach"),5);QCOMPARE(calls.count("invalidDetachWouldAbortVlc"),0);QCOMPARE(calls.count("play"),0);
  }
  void recoveryWaitIsMeasuredWithoutChangingLiveLoadingBehavior() {
    DesktopPlayer player;qint64 now=0;QList<QPair<QString,QVariantMap>> events;
    PlaybackAnalytics tracker([&](QString name,QVariantMap values){events.append({name,values});},[&]{return now;});tracker.setEnabled(true);tracker.request({{"kind","live"},{"id","1"}});
    connect(&player,&DesktopPlayer::stateChanged,&player,[&]{tracker.observe({player.active(),player.hasVideoFrame(),player.playing(),player.loading(),!player.error().isEmpty(),player.positionMs(),0,player.wantsPlayback(),player.recovering(),player.buffering()});});
    auto input=media();auto item=input.value("item").toMap();item["kind"]="live";input["item"]=item;player.setSurface(1);player.open(input);QTRY_VERIFY(player.hasVideoFrame());
    now=1000;FakeVlc::finishAt(10000,120000);QTRY_VERIFY(player.recovering());QVERIFY(!player.loading());QVERIFY(player.wantsPlayback());
    now=6000;player.open(input);QTRY_VERIFY(player.playing());now=7000;player.close();player.releaseSurface(1);
    int starts=0; qint64 buffer=-1,watch=-1;
    for(const auto &event:events){starts+=event.first=="video_start";if(event.first=="playback_buffer")buffer=event.second.value("buffer_ms").toLongLong();if(event.first=="playback_end")watch=event.second.value("watch_ms").toLongLong();}
    QCOMPARE(starts,1);QCOMPARE(buffer,5000);QCOMPARE(watch,2000);
  }
  void engineStartupDoesNotBlockGui() {
    DesktopPlayer player; player.setSurface(1);
    const bool responsive = guiRunsWhileVlcBlocked("create", [&] { player.open(media()); });
    player.releaseSurface(1);
    QVERIFY2(responsive, "GUI event loop could not run while libVLC engine initialization was blocked");
  }
  void mediaPlayDoesNotBlockGui() {
    DesktopPlayer player; player.setSurface(1);
    const bool responsive = guiRunsWhileVlcBlocked("play", [&] { player.open(media()); });
    player.releaseSurface(1);
    QVERIFY2(responsive, "GUI event loop could not run while libVLC play was blocked");
  }
  void pollingDoesNotBlockGui() {
    DesktopPlayer player; player.setSurface(1); player.open(media());
    QTRY_VERIFY(player.playing());
    const bool responsive = guiRunsWhileVlcBlocked("videoSize", [] {});
    player.releaseSurface(1);
    QVERIFY2(responsive, "GUI event loop could not run while libVLC video polling was blocked");
  }
  void trackDiscoveryDoesNotBlockGui() {
    DesktopPlayer player; player.setSurface(1);
    const bool responsive = guiRunsWhileVlcBlocked("audioTracks", [&] { player.open(media()); });
    player.releaseSurface(1);
    QVERIFY2(responsive, "GUI event loop could not run while libVLC track discovery was blocked");
  }
  void controlsDoNotBlockGui_data() {
    QTest::addColumn<QString>("operation");
    for (const QString &operation : {"pause", "seek", "volume", "mute", "audio", "subtitle", "rate", "aspect"})
      QTest::newRow(qPrintable(operation)) << operation;
  }
  void controlsDoNotBlockGui() {
    QFETCH(QString, operation);
    DesktopPlayer player; player.setSurface(1); player.open(media());
    QTRY_VERIFY(player.playing() && player.durationMs() > 0 && !player.audioTracks().isEmpty());
    const bool responsive = guiRunsWhileVlcBlocked(operation, [&] {
      if (operation == "pause") player.togglePause();
      else if (operation == "seek") player.seek(15000);
      else if (operation == "volume") player.setVolume(40);
      else if (operation == "mute") player.setMuted(true);
      else if (operation == "audio") player.selectAudio(1);
      else if (operation == "subtitle") player.selectSubtitle(2);
      else if (operation == "rate") player.setRate(1.5);
      else player.setAspect("16:9");
    });
    player.releaseSurface(1);
    QVERIFY2(responsive, qPrintable("GUI event loop could not run while libVLC " + operation + " was blocked"));
  }
  void supersededStartupCannotPlay() {
    DesktopPlayer player; player.setSurface(1);
    const bool responsive = guiRunsWhileVlcBlocked("create", [&] {
      player.open(media("old"));
    }, [&] { player.open(media("new")); });
    QTRY_VERIFY(player.item().value("id").toString() == "new" && player.playing());
    player.releaseSurface(1);
    QVERIFY(responsive);
    QCOMPARE(FakeVlc::calls().count("play"), 1);
    QVERIFY(!FakeVlc::calledOnGuiThread());
    QCOMPARE(FakeVlc::concurrentCalls(), 1);
  }
  void rapidControlsAreCoalesced() {
    DesktopPlayer player; player.setSurface(1); player.open(media());
    QTRY_VERIFY(player.playing() && player.durationMs() > 0);
    const bool responsive = guiRunsWhileVlcBlocked("volume", [&] { player.setVolume(1); }, [&] {
      for (int i = 0; i < 10000; ++i) { player.setVolume(i % 101); player.seek(10000 + i); }
    });
    QTRY_COMPARE(player.positionMs(), 19999);
    player.releaseSurface(1);
    QVERIFY(responsive);
    QVERIFY2(FakeVlc::calls().count("volume") <= 3, "Repeated slider changes accumulated instead of replacing pending volume");
    QVERIFY2(FakeVlc::calls().count("seek") <= 1, "Repeated scrubbing accumulated instead of replacing pending seek");
  }
  void closeSupersedesQueuedControls() {
    DesktopPlayer player; player.setSurface(1); player.open(media("old"));
    QTRY_VERIFY(player.playing() && player.durationMs() > 0);
    const bool responsive = guiRunsWhileVlcBlocked("volume", [&] { player.setVolume(1); }, [&] {
      for (int i = 0; i < 10000; ++i) player.seek(10000 + i);
      player.close(); player.open(media("new"));
    });
    QTRY_VERIFY(player.item().value("id").toString() == "new" && player.playing());
    player.releaseSurface(1);
    QVERIFY(responsive);
    QCOMPARE(FakeVlc::calls().count("seek"), 0);
    QCOMPARE(FakeVlc::calls().count("play"), 2);
    QCOMPARE(FakeVlc::concurrentCalls(), 1);
  }
  void staleSnapshotCannotUndoSeek() {
    DesktopPlayer player; player.setSurface(1); player.open(media());
    QTRY_VERIFY(player.playing() && player.durationMs() > 0);
    player.togglePause();
    bool stalePosition = false;
    const bool responsive = guiRunsWhileVlcBlocked("videoSize", [] {}, [&] {
      player.seek(60000);
      connect(&player, &DesktopPlayer::stateChanged, &player, [&] {
        if (player.positionMs() != 60000) stalePosition = true;
      });
    });
    QTest::qWait(300);
    player.releaseSurface(1);
    QVERIFY(responsive);
    QVERIFY2(!stalePosition, "A polling result captured before seeking replaced the requested position");
  }
  void surfaceReleaseDrainsStop() {
    DesktopPlayer player; player.setSurface(1); player.open(media());
    QTRY_VERIFY(player.playing());
    player.releaseSurface(1);
    const auto calls = FakeVlc::calls();
    QVERIFY(calls.contains("stop"));
    QVERIFY(calls.indexOf("stop") < calls.indexOf("releasePlayer"));
    QVERIFY(calls.indexOf("releasePlayer") < calls.indexOf("release"));
    QVERIFY(!FakeVlc::calledOnGuiThread());
    QCOMPARE(FakeVlc::concurrentCalls(), 1);
  }
  void endUsesFinalWorkerSnapshot() {
    DesktopPlayer player; player.setSurface(1);
    auto episode = media(); auto item = episode.value("item").toMap();
    item["kind"] = "episode"; item["seriesID"] = "11"; item["season"] = 1; item["episode"] = 1;
    auto next = item; next["id"] = "2"; next["episode"] = 2;
    episode["item"] = item; episode["next"] = next;
    QSignalSpy progress(&player, &DesktopPlayer::progress);
    player.open(episode); QTRY_VERIFY(player.playing() && player.positionMs() == 10000);
    FakeVlc::finishAt(119500, 120000);
    QTRY_VERIFY(player.nextCountdown() > 0);
    QCOMPARE(player.positionMs(), 119500);
    bool completed = false;
    for (const auto &entry : progress) if (entry.at(3).toBool()) completed = true;
    player.releaseSurface(1);
    QVERIFY(completed);
    QVERIFY(!FakeVlc::calledOnGuiThread());
  }
  void settingsValidateAndPersist() {
    DesktopPlayer player; player.setSurface(1);
    player.setRate(1.5); player.setAspect("4:3");
    player.setRate(1.3); player.setAspect("invalid");
    QCOMPARE(player.rate(), 1.5); QCOMPARE(player.aspect(), "4:3");
    player.open(media()); QTRY_VERIFY(player.playing());
    QCOMPARE(FakeVlc::appliedRate(), 1.5); QCOMPARE(FakeVlc::appliedAspect(), "4:3");
    auto live = media("live"); auto item = live.value("item").toMap(); item["kind"] = "live"; live["item"] = item;
    player.open(live); QTRY_VERIFY(player.playing());
    QCOMPARE(FakeVlc::appliedRate(), 1.0);
    player.setRate(2.0); QCOMPARE(player.rate(), 1.5);
    player.setAspect("Otomatik"); QTRY_COMPARE(FakeVlc::appliedAspect(), QString());
    player.releaseSurface(1);
  }
  void resumePositionIsNotLostWhenClosingDuringStartup_data() {
    QTest::addColumn<QString>("operation");
    QTest::newRow("initialization") << QString("create");
    QTest::newRow("resume seek") << QString("seek");
  }
  void resumePositionIsNotLostWhenClosingDuringStartup() {
    QFETCH(QString, operation);
    DesktopPlayer player; player.setSurface(1);
    auto input = media(); input["resumeMs"] = 60000;
    QSignalSpy progress(&player, &DesktopPlayer::progress);
    const bool responsive = guiRunsWhileVlcBlocked(operation, [&] { player.open(input); }, [&] { player.close(); });
    player.releaseSurface(1);
    QVERIFY(responsive);
    QVERIFY(!progress.isEmpty());
    QCOMPARE(progress.last().at(1).toLongLong(), qint64(60000));
  }
  void supersededMediaSetupOnlyDetachesRegisteredCallbacks_data() {
    QTest::addColumn<QString>("operation");
    for (const QString &operation : {"player", "media", "setMedia"}) QTest::newRow(qPrintable(operation)) << operation;
  }
  void supersededMediaSetupOnlyDetachesRegisteredCallbacks() {
    QFETCH(QString, operation);
    DesktopPlayer player; player.setSurface(1);
    const bool responsive = guiRunsWhileVlcBlocked(operation, [&] {
      player.open(media("old"));
    }, [&] { player.open(media("new")); });
    QTRY_VERIFY(player.item().value("id").toString() == "new" && player.playing());
    player.releaseSurface(1);
    QVERIFY(responsive);
    QCOMPARE(FakeVlc::calls().count("invalidDetachWouldAbortVlc"), 0);
  }
  void failedEventAttachmentDisposesOnlyRegisteredCallbacks() {
    DesktopPlayer player; player.setSurface(1);
    FakeVlc::failAttach(0x105);
    player.open(media());
    QTRY_VERIFY(!player.error().isEmpty());
    player.releaseSurface(1);
    const auto calls = FakeVlc::calls();
    QCOMPARE(calls.count("attach"), 3);
    QCOMPARE(calls.count("detach"), 2);
    QCOMPARE(calls.count("invalidDetachWouldAbortVlc"), 0);
    QCOMPARE(calls.count("play"), 0);
    QVERIFY(calls.contains("releasePlayer") && calls.contains("release"));
  }
  void incompletePlaybackCannotCompleteFromUnconfirmedResume() {
    DesktopPlayer player; player.setSurface(1);
    auto input = media(); auto item = input.value("item").toMap();
    item["kind"] = "episode"; item["seriesID"] = "11"; item["season"] = 1; item["episode"] = 1;
    auto next = item; next["id"] = "2"; next["episode"] = 2;
    input["item"] = item; input["next"] = next; input["resumeMs"] = 119000;
    QSignalSpy progress(&player, &DesktopPlayer::progress);
    FakeVlc::finishAt(10000, 120000);
    player.open(input);
    QTRY_VERIFY(player.nextCountdown() > 0 || !player.error().isEmpty());
    const auto countdown = player.nextCountdown();
    player.releaseSurface(1);
    QCOMPARE(countdown, 0);
    for (const auto &entry : progress) {
      QVERIFY(!entry.at(3).toBool());
      QVERIFY2(!Playback::watched(entry.at(1).toLongLong(), entry.at(2).toLongLong()),
               "An admitted resume target was emitted as confirmed watched progress");
    }
    QCOMPARE(FakeVlc::calls().count("seek"), 0);
  }
};
QTEST_GUILESS_MAIN(PlayerTest)
#include "player_test.moc"
