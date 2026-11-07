import XCTest
@testable import FlixifyCore

final class TrialCountdownTests: XCTestCase {
    private func payload(_ status: String = "active", server: String = "2026-11-07T11:00:00.000Z", end: Any = "2026-11-07T14:00:00.000Z") -> [String: Any] {
        ["status": status, "serverNow": server, "endsAt": end]
    }
    func testServerDeadlineAdvancesOnlyByMonotonicElapsedTime() {
        let countdown = TrialCountdown.parse(payload(), at: 100)
        XCTAssertEqual(countdown.status(at: 100), .active)
        XCTAssertEqual(countdown.remainingSeconds(at: 100), 10800)
        XCTAssertEqual(countdown.remainingSeconds(at: 101.2), 10799)
        XCTAssertEqual(countdown.text(at: 100), "Deneme · 03:00:00")
    }
    func testRelaunchUsesRemainingServerDurationInsteadOfResettingThreeHours() {
        let countdown = TrialCountdown.parse(payload(server: "2026-11-07T11:10:00.000Z"), at: 900)
        XCTAssertEqual(countdown.remainingSeconds(at: 900), 10200)
    }
    func testZeroIsExpiredAndNeverNegative() {
        let countdown = TrialCountdown.parse(payload(), at: 100)
        XCTAssertEqual(countdown.status(at: 10900), .expired)
        XCTAssertEqual(countdown.remainingSeconds(at: 10901), 0)
        XCTAssertEqual(countdown.text(at: 10900), "Denemen sona erdi")
    }
    func testPaidResponseHidesTheCountdownImmediately() {
        let countdown = TrialCountdown.parse(payload("none", end: NSNull()), at: 100)
        XCTAssertEqual(countdown.status(at: 100), .none)
        XCTAssertEqual(countdown.remainingSeconds(at: 100), 0)
        XCTAssertEqual(countdown.text(at: 100), "")
    }
    func testPendingAndUnavailableNeverStartAClock() {
        for (status, expected) in [("pending", TrialCountdown.Status.pending), ("unavailable", .unavailable)] {
            let countdown = TrialCountdown.parse(payload(status, end: NSNull()), at: 100)
            XCTAssertEqual(countdown.status(at: 100), expected)
            XCTAssertEqual(countdown.remainingSeconds(at: 10000), 0)
        }
    }
    func testMissingMetadataNeverInventsThreeHours() {
        XCTAssertEqual(TrialCountdown.parse(nil, at: 100).status(at: 100), .none)
        XCTAssertEqual(TrialCountdown.parse(["status": "unknown"], at: 100).status(at: 100), .none)
    }
    func testMalformedActiveMetadataIsUnavailable() {
        for value in [payload(server: "invalid"), payload(end: NSNull()), payload(end: "2026-11-07T10:59:59.000Z")] {
            let countdown = TrialCountdown.parse(value, at: 100)
            XCTAssertEqual(countdown.status(at: 100), .unavailable)
            XCTAssertEqual(countdown.remainingSeconds(at: 100), 0)
        }
        XCTAssertEqual(TrialCountdown.parse(payload(), at: .infinity).status(at: 100), .unavailable)
    }
    func testLegacyTrialUsesItsActualDeadline() {
        let countdown = TrialCountdown.parse(payload(end: "2026-11-08T11:00:00.000Z"), at: 100)
        XCTAssertEqual(countdown.remainingSeconds(at: 100), 86400)
        XCTAssertEqual(countdown.text(at: 100), "Deneme · 24:00:00")
    }
    func testExpiredSnapshotDoesNotResume() {
        let countdown = TrialCountdown.parse(payload("expired", end: "2026-11-07T10:59:59.000Z"), at: 100)
        XCTAssertEqual(countdown.status(at: 100), .expired)
        XCTAssertEqual(countdown.remainingSeconds(at: 0), 0)
    }
}
