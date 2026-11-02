import XCTest
@testable import FlixifyCore

final class AnalyticsIntegrationTests: XCTestCase {
    func testAdmissionIncludesPreflightTimeWithoutDuplicateRequest() {
        var events=[(String,[String:Any])]();let emit:(String,[String:Any])->Void={events.append(($0,$1))}
        let context=PlaybackAnalyticsContext.begin(item:["content_type":"series"],startedAt:1000,epoch:4,enabled:true,emit:emit)!
        let observer=context.admit(item:["content_type":"episode"],epoch:4,enabled:true,emit:emit)!
        XCTAssertEqual(events.map(\.0),["playback_request"])
        observer.firstFrame(now:6500);observer.firstFrame(now:7000)
        XCTAssertEqual(events.map(\.0),["playback_request","video_start"])
        XCTAssertEqual(events.last?.1["startup_ms"] as? Int,5500)
    }
    func testUnknownAndWithdrawnAttemptsCannotAdmitHistoricalPlayback() {
        var beforeConsent=[String]()
        XCTAssertNil(PlaybackAnalyticsContext.begin(item:[:],startedAt:1,epoch:0,enabled:false,emit:{ name,_ in beforeConsent.append(name) }))
        XCTAssertTrue(beforeConsent.isEmpty)
        let context=PlaybackAnalyticsContext(startedAt:1,epoch:2,enabled:true)!
        var events=[String]();let emit:(String,[String:Any])->Void={name,_ in events.append(name)}
        XCTAssertNil(context.admit(item:[:],epoch:3,enabled:false,emit:emit))
        XCTAssertNil(context.admit(item:[:],epoch:4,enabled:true,emit:emit))
        XCTAssertTrue(events.isEmpty)
    }
    func testFailedPreflightEmitsErrorAndEndWithoutVideoStart() {
        var events=[(String,[String:Any])]();let emit:(String,[String:Any])->Void={events.append(($0,$1))}
        let context=PlaybackAnalyticsContext(startedAt:100,epoch:3,enabled:true)!
        context.fail(item:["content_type":"movie"],epoch:3,enabled:true,reason:"network",emit:emit)
        XCTAssertEqual(events.map(\.0),["playback_error","playback_end"])
        XCTAssertEqual(events.last?.1["watch_ms"] as? Int,0)
        context.fail(item:[:],epoch:5,enabled:true,reason:"network",emit:emit)
        XCTAssertEqual(events.count,2)
    }
    func testZeroAndAbandonedSearchesAreMeasuredOnceWithoutQueryText() {
        let search=SearchAnalyticsSession();let zero=search.begin(query:"nobody@example.com",epoch:1,enabled:true)!
        XCTAssertEqual(search.complete(zero,resultCount:0,epoch:1,enabled:true),["query_length":18,"result_count":0])
        XCTAssertNil(search.complete(zero,resultCount:0,epoch:1,enabled:true))
        let abandoned=search.begin(query:"Avengers",epoch:1,enabled:true)!
        let values=search.complete(abandoned,resultCount:4,epoch:1,enabled:true)
        XCTAssertEqual(values,["query_length":8,"result_count":4])
        XCTAssertEqual(Set(values!.keys),Set(["query_length","result_count"]))
    }
    func testSearchConsentEpochAndStaleQueryCompletionAreRejected() {
        let search=SearchAnalyticsSession();let unknown=search.begin(query:"before",epoch:0,enabled:false)!
        XCTAssertNil(search.complete(unknown,resultCount:4,epoch:1,enabled:true))
        let previous=search.begin(query:"old",epoch:1,enabled:true)!
        let current=search.begin(query:"new",epoch:1,enabled:true)!
        XCTAssertNil(search.complete(previous,resultCount:9,epoch:1,enabled:true))
        XCTAssertNil(search.complete(current,resultCount:2,epoch:3,enabled:true))
        XCTAssertNil(search.begin(query:"  ",epoch:3,enabled:true))
    }
}
