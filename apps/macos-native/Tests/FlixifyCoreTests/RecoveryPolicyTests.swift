import XCTest
@testable import FlixifyCore

final class RecoveryPolicyTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 100)

    func testTwoClaimsAcrossFreshAdmissionsUntilNewUserSelection() {
        var policy = RecoveryPolicy(scope: "a", itemKey: "movie:1", expiresAt: start.addingTimeInterval(100))
        XCTAssertTrue(policy.claim(scope: "a", itemKey: "movie:1", now: start))
        XCTAssertTrue(policy.admit(scope: "a", itemKey: "movie:1", expiresAt: start.addingTimeInterval(200), now: start))
        XCTAssertTrue(policy.claim(scope: "a", itemKey: "movie:1", now: start))
        XCTAssertFalse(policy.claim(scope: "a", itemKey: "movie:1", now: start))
        XCTAssertEqual(policy.attempts, 2)
        var newSelection = RecoveryPolicy(scope: "a", itemKey: "movie:1", expiresAt: start.addingTimeInterval(100))
        XCTAssertTrue(newSelection.claim(scope: "a", itemKey: "movie:1", now: start))
    }

    func testChangedScopeSelectionExpiryAndStopFailClosed() {
        for mismatch in [("b", "movie:1"), ("a", "movie:2")] {
            var policy = RecoveryPolicy(scope: "a", itemKey: "movie:1", expiresAt: start.addingTimeInterval(100))
            XCTAssertFalse(policy.claim(scope: mismatch.0, itemKey: mismatch.1, now: start))
            XCTAssertFalse(policy.claim(scope: "a", itemKey: "movie:1", now: start))
        }
        var expired = RecoveryPolicy(scope: "a", itemKey: "movie:1", expiresAt: start)
        XCTAssertFalse(expired.claim(scope: "a", itemKey: "movie:1", now: start))
        var stopped = RecoveryPolicy(scope: "a", itemKey: "movie:1", expiresAt: start.addingTimeInterval(100))
        stopped.stop()
        XCTAssertFalse(stopped.admit(scope: "a", itemKey: "movie:1", expiresAt: start.addingTimeInterval(200), now: start))
    }

    func testOnlyLiveEOFIsRecoverableAndVODEndIsNeverRetried() {
        XCTAssertTrue(RecoveryPolicy.recovers(.ended, kind: .live))
        XCTAssertFalse(RecoveryPolicy.recovers(.ended, kind: .movie))
        XCTAssertFalse(RecoveryPolicy.recovers(.ended, kind: .episode))
        XCTAssertFalse(RecoveryPolicy.recovers(.decoderError, kind: .series))
        XCTAssertTrue(RecoveryPolicy.recovers(.decoderError, kind: .movie))
    }

    func testStartupHasThirtySecondsBeforeAnyFirstFrame() {
        var watchdog = RecoveryWatchdog(now: start)
        XCTAssertFalse(watchdog.stalled(now: start.addingTimeInterval(29.99), position: 0, wantsPlay: true, ready: false, playing: false, ended: false, interacting: false))
        XCTAssertTrue(watchdog.stalled(now: start.addingTimeInterval(30), position: 0, wantsPlay: true, ready: false, playing: false, ended: false, interacting: false))
    }

    func testEstablishedPlaybackStallsAfterTwelveSecondsWithoutProgress() {
        var watchdog = RecoveryWatchdog(now: start)
        watchdog.firstFrame(now: start)
        XCTAssertFalse(watchdog.stalled(now: start.addingTimeInterval(11.99), position: 0, wantsPlay: true, ready: true, playing: true, ended: false, interacting: false))
        XCTAssertTrue(watchdog.stalled(now: start.addingTimeInterval(12), position: 0, wantsPlay: true, ready: true, playing: true, ended: false, interacting: false))
        XCTAssertFalse(watchdog.stalled(now: start.addingTimeInterval(13), position: 0.2, wantsPlay: true, ready: true, playing: true, ended: false, interacting: false))
    }

    func testPauseInteractionAndActualEndCannotTriggerStall() {
        for reason in 0..<3 {
            var watchdog = RecoveryWatchdog(now: start)
            watchdog.firstFrame(now: start)
            XCTAssertFalse(watchdog.stalled(now: start.addingTimeInterval(60), position: 0, wantsPlay: reason != 0, ready: true, playing: reason != 0, ended: reason == 1, interacting: reason == 2))
        }
        var loading = RecoveryWatchdog(now: start)
        XCTAssertFalse(loading.stalled(now: start.addingTimeInterval(60), position: 0, wantsPlay: false, ready: false, playing: false, ended: false, interacting: false))
        XCTAssertFalse(loading.stalled(now: start.addingTimeInterval(89), position: 0, wantsPlay: true, ready: false, playing: false, ended: false, interacting: false))
    }
}
