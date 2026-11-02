import XCTest
@testable import FlixifyCore
final class FirebaseClientConfigurationTests: XCTestCase {
    func testMissingMalformedAndWrongAppConfigurationCannotActivate() throws {
        let config:[String:Any] = ["BUNDLE_ID":"vip.flixify.mac", "GOOGLE_APP_ID":"1:123456789:ios:abcdef123456", "API_KEY":"AIza"+String(repeating:"x",count:35), "PROJECT_ID":"flixify-test", "GCM_SENDER_ID":"123456789"]
        let data = try PropertyListSerialization.data(fromPropertyList:config,format:.xml,options:0)
        XCTAssertTrue(FirebaseClientConfiguration.valid(data,bundleID:"vip.flixify.mac"))
        XCTAssertFalse(FirebaseClientConfiguration.valid(data,bundleID:"another.app"))
        XCTAssertFalse(FirebaseClientConfiguration.valid(Data("not a plist".utf8),bundleID:"vip.flixify.mac"))
        for key in ["GOOGLE_APP_ID","API_KEY","PROJECT_ID","GCM_SENDER_ID"] {
            var bad=config; bad[key]="invalid value"
            XCTAssertFalse(FirebaseClientConfiguration.valid(try PropertyListSerialization.data(fromPropertyList:bad,format:.xml,options:0),bundleID:"vip.flixify.mac"))
        }
    }
}
