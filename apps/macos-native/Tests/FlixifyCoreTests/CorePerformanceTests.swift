import XCTest
@testable import FlixifyCore

final class CorePerformanceTests: XCTestCase {
    func testPreparedLargeLiveCatalogueBuildsShelvesWithoutRepeatingAnalysis() {
        let groups = ["TR:ULUSAL", "TR:HABER", "TR:SPOR", "TR:COCUK", "TR:BELGESEL", "TR:MUZIK", "TR:YEREL", "TR:7/24", "TR:RADYO"]
        let items = (0..<5000).map { index in
            CatalogItem(id: String(1000 + index), kind: .live, title: "TR • PerformanceFixture\(index) FHD", categoryName: groups[index % 9], scope: "fixture-account:fixture-source")
        }
        let prepared = LiveLineup.clean(items)
        XCTAssertEqual(prepared.count, 5000)
        let started = Date()
        let shelves = Discovery.shelves(for: .live, items: prepared)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.5, "A prepared catalogue must not repeat title analysis for every category")
        XCTAssertEqual(shelves.map(\.id), ["live-national", "live-news", "live-sports", "live-kids", "live-documentary", "live-music", "live-local", "live-themed", "live-radio"])
        XCTAssertEqual(shelves.map { $0.items.count }, [556, 556, 556, 556, 556, 555, 555, 555, 555])
        XCTAssertEqual(Set(shelves.flatMap(\.items).map(\.id)).count, 5000)
    }

    func testLiveAnalysisUsesExactSourceTitleAndGroupAfterInputsChange() {
        var item = CatalogItem(id: "10", kind: .live, title: "Display title", categoryName: "TR:SPOR", sourceTitle: "TR • Example FHD")
        let sports = LiveLineup.info(item)
        XCTAssertEqual(sports.name, "Example"); XCTAssertEqual(sports.countryID, "tr"); XCTAssertEqual(sports.categoryID, "sports")
        item.categoryName = "TR:HABER"
        let news = LiveLineup.info(item)
        XCTAssertEqual(news.name, "Example"); XCTAssertEqual(news.categoryID, "news")
        item.sourceTitle = "DE • Neuer Sender FHD"
        let german = LiveLineup.info(item)
        XCTAssertEqual(german.name, "Neuer Sender"); XCTAssertEqual(german.countryID, "de"); XCTAssertEqual(german.categoryID, "news")
        item.sourceTitle = ""; item.title = "TR • Yeni Kanal FHD"; item.categoryName = "TR:ULUSAL"
        let fallback = LiveLineup.info(item)
        XCTAssertEqual(fallback.name, "Yeni Kanal"); XCTAssertEqual(fallback.countryID, "tr"); XCTAssertEqual(fallback.categoryID, "national")
        item.title = "USA Example FHD"; item.categoryName = ""
        XCTAssertEqual(LiveLineup.info(item).countryID, "other")
        item.sourceTitle = item.title
        XCTAssertEqual(LiveLineup.info(item).countryID, "us")
    }
}
