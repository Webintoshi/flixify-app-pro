import XCTest
@testable import FlixifyCore

final class NextEpisodePolicyTests: XCTestCase {
    private func episode(_ id: String = "1", season: Int = 1, number: Int = 1, scope: String = "a", series: String = "s") -> CatalogItem {
        CatalogItem(id: id, kind: .episode, title: "Bölüm", scope: scope, seriesID: series, season: season, episode: number)
    }

    func testCountdownStartsOnlyAtActualEndCallAndClaimsOnceAfterFiveSeconds() {
        let now = Date(timeIntervalSince1970: 100)
        var policy = NextEpisodePolicy()
        XCTAssertFalse(policy.pending)
        XCTAssertTrue(policy.begin(item: episode(), next: episode("2", number: 2), duration: 120, now: now))
        XCTAssertEqual(policy.remainingSeconds(now: now), 5)
        XCTAssertFalse(policy.claim(now: now.addingTimeInterval(4.99)))
        XCTAssertTrue(policy.claim(now: now.addingTimeInterval(5)))
        XCTAssertFalse(policy.claim(now: now.addingTimeInterval(9)))
        XCTAssertTrue(policy.handled)
    }

    func testCrossSeasonSuccessorIsValid() {
        XCTAssertTrue(NextEpisodePolicy.validSuccessor(episode("9", number: 9), episode("10", season: 2)))
    }

    func testSameEarlierWrongSeriesAndWrongScopeAreRejected() {
        let current = episode()
        for next in [current, episode("2", number: 0), episode("2", number: 2, scope: "b"), episode("2", number: 2, series: "other")] {
            XCTAssertFalse(NextEpisodePolicy.validSuccessor(current, next))
        }
        XCTAssertFalse(NextEpisodePolicy.validSuccessor(current, nil))
        XCTAssertFalse(NextEpisodePolicy.validSuccessor(CatalogItem(id: "m", kind: .movie, title: "Film"), episode("2", number: 2)))
    }

    func testCancelSurvivesRepeatedEndEventsForSelectedEpisode() {
        var policy = NextEpisodePolicy()
        XCTAssertTrue(policy.begin(item: episode(), next: episode("2", number: 2), duration: 100))
        policy.cancel()
        XCTAssertFalse(policy.pending)
        XCTAssertFalse(policy.claim(immediately: true))
        XCTAssertFalse(policy.begin(item: episode(), next: episode("2", number: 2), duration: 100))
    }

    func testBackgroundCancellationBeforeActualEndCannotArmOrClaim() {
        var policy = NextEpisodePolicy()
        policy.cancel()
        XCTAssertFalse(policy.begin(item: episode(), next: episode("2", number: 2), duration: 100))
        XCTAssertFalse(policy.pending)
        XCTAssertFalse(policy.claim(immediately: true))
    }

    func testUnknownInvalidDurationAndFinalEpisodeDoNotArm() {
        for duration in [0, -1, Double.nan, .infinity] {
            var policy = NextEpisodePolicy()
            XCTAssertFalse(policy.begin(item: episode(), next: episode("2", number: 2), duration: duration))
        }
        var policy = NextEpisodePolicy()
        XCTAssertFalse(policy.begin(item: episode(), next: nil, duration: 100))
    }

    func testExplicitNextCanClaimImmediatelyButNotTwice() {
        var policy = NextEpisodePolicy()
        XCTAssertTrue(policy.begin(item: episode(), next: episode("2", number: 2), duration: 100))
        XCTAssertTrue(policy.claim(immediately: true))
        XCTAssertFalse(policy.claim(immediately: true))
    }
}
