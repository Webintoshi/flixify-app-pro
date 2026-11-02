import XCTest
@testable import FlixifyCore
final class PlaybackAnalyticsTests: XCTestCase {
    func testConfirmedFramesAndEndAreCountedOnce() {
        var names = [String](); var values = [[String:Any]]()
        let p = PlaybackAnalytics(item: [:], now: 100) { name, value in names.append(name); values.append(value) }
        XCTAssertEqual(names, ["playback_request"])
        p.sample(now: 200, position: 5, duration: 10, playing: true, buffering: false)
        XCTAssertFalse(names.contains("video_start"))
        p.firstFrame(now: 400); p.firstFrame(now: 500)
        for i in 1...80 { p.sample(now: 400 + Double(i)*100, position: 5, duration: 10, playing: true, buffering: false) }
        XCTAssertEqual(names.filter { $0 == "video_start" }.count, 1)
        XCTAssertEqual(names.filter { $0 == "video_progress" }.count, 2)
        p.sample(now: 9000, position: 9.5, duration: 10, playing: true, buffering: false)
        XCTAssertFalse(names.contains("video_complete"))
        p.end(now: 9100, reason: "completed", complete: true); p.end(now: 9200, reason: "completed", complete: true)
        XCTAssertEqual(names.filter { $0 == "video_complete" }.count, 1)
        XCTAssertEqual(names.filter { $0 == "playback_end" }.count, 1)
        if let start = names.firstIndex(of: "video_start") { XCTAssertEqual(values[start]["startup_ms"] as? Int, 300) }
    }
    func testFailedStartupNeverCountsSuccess() {
        var names = [String]()
        let p = PlaybackAnalytics(item: [:], now: 0) { name, _ in names.append(name) }
        p.sample(now: 100, position: 0, duration: 10, playing: false, buffering: true)
        p.end(now: 200, reason: "decoder", complete: false)
        XCTAssertFalse(names.contains("video_start")); XCTAssertFalse(names.contains("video_complete"))
        XCTAssertTrue(names.contains("playback_end"))
    }
    func testPausedTimeAndBufferSamplesHaveBoundedTotals() {
        var sent=[String:[String:Any]]()
        let p=PlaybackAnalytics(item:[:],now:0) { sent[$0]=$1 }
        p.firstFrame(now:0)
        p.sample(now:0,position:0,duration:0,playing:true,buffering:false)
        p.sample(now:1000,position:0,duration:0,playing:true,buffering:false)
        p.sample(now:2000,position:0,duration:0,playing:false,buffering:false)
        p.sample(now:9000,position:0,duration:0,playing:false,buffering:true)
        p.sample(now:9500,position:0,duration:0,playing:false,buffering:true)
        p.sample(now:10000,position:0,duration:0,playing:false,buffering:false)
        p.end(now:20000,reason:"closed",complete:false)
        XCTAssertEqual(sent["playback_end"]?["watch_ms"] as? Int,2000)
        XCTAssertEqual(sent["playback_buffer"]?["buffer_ms"] as? Int,1000)
    }
}
