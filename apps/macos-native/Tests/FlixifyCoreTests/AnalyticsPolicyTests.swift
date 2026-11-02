import XCTest
@testable import FlixifyCore

final class AnalyticsPolicyTests: XCTestCase {
    func testOnlyPublicSafeCatalogueLabelsAreKept() {
        var sent=[[String:Any]]();let p=AnalyticsPolicy(configured:true) { _,v in sent.append(v) };p.choice(accepted:true,version:1)
        p.event("select_content",["content_name":"Şebeke (2023)"])
        XCTAssertEqual(sent.first?["content_name"] as? String,"Şebeke (2023)")
        for value in ["user@example.com","https://provider/user/pass","ABCDEFGHIJKLMNOP","movie\u{200b}","username=secret","secret%20token","http:private","HTTPS:private","mailto:private","data:private","file:private","javascript:private","movie\u{2028}","movie\u{2029}","session:private","session_id=private-value","TOKEN_ID:private","ftp:private"] {
            p.event("select_content",["content_name":value]);XCTAssertNil(sent.last?["content_name"])
        }
        XCTAssertEqual(sent.count,19)
    }
    func testConsentAndStaleWorkAcrossWithdrawal() {
        var sent = [String]()
        let policy = AnalyticsPolicy(configured: true) { name, _ in sent.append(name) }
        policy.event("login"); XCTAssertTrue(sent.isEmpty)
        policy.choice(accepted: true, version: 1); let old = policy.epoch
        policy.event("login"); XCTAssertEqual(sent, ["login"])
        policy.choice(accepted: false, version: 1); policy.choice(accepted: true, version: 1)
        policy.event("login", epoch: old); XCTAssertEqual(sent.count, 1)
        policy.choice(accepted: true, version: 0); policy.event("login"); XCTAssertEqual(sent.count, 1)
    }
    func testSensitiveAndUnknownParametersCannotLeave() {
        var sent = [[String:Any]]()
        let policy = AnalyticsPolicy(configured: true) { _, values in sent.append(values) }
        policy.choice(accepted: true, version: 1)
        policy.event("search", ["query_length": 5, "result_count": 2, "search_term": "a@example.com", "url": "https://host/u/p", "token": "secret"])
        XCTAssertEqual(sent.count, 1); guard let event = sent.first else { return }
        XCTAssertEqual(Set(event.keys), Set(["query_length", "result_count"]))
        policy.event("unknown", ["result_count": 2]); XCTAssertEqual(sent.count, 1)
        let unavailable = AnalyticsPolicy(configured: false) { _, _ in XCTFail("Unconfigured collection") }
        unavailable.choice(accepted: true, version: 1); unavailable.event("login")
    }
}
