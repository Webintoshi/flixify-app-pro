import Foundation
import XCTest
@testable import FlixifyCore

final class UniversalBinaryPolicyTests: XCTestCase {
    private let valid = Data([
        0xca,0xfe,0xba,0xbe, 0,0,0,2,
        1,0,0,12, 0,0,0,0, 0,0,0,48, 0,0,0,16, 0,0,0,0,
        1,0,0,7, 0,0,0,3, 0,0,0,64, 0,0,0,16, 0,0,0,0
    ])
    func testUniversalFatHeaderRequiresBothArchitectures() throws { try UniversalBinaryPolicy.validateHeader(valid, fileSize: 80) }
    func testMissingArchitectureAndDuplicateCPUAreRejected() {
        var missing = valid; missing[31] = 8
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(missing, fileSize: 80))
        var duplicate = valid; duplicate[31] = 12
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(duplicate, fileSize: 80))
    }
    func testOverlappingOrOutOfBoundsSlicesAreRejected() {
        var overlap = valid; overlap[39] = 56
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(overlap, fileSize: 80))
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(valid, fileSize: 79))
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(Data(valid.prefix(35)), fileSize: 80))
    }
    func testThinBinaryAndUnboundedTablesAreRejected() {
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(Data([0xcf,0xfa,0xed,0xfe,1,0,0,12]), fileSize: 80))
        var excessive = valid; excessive[7] = 255
        XCTAssertThrowsError(try UniversalBinaryPolicy.validateHeader(excessive, fileSize: 80))
    }
    func testSymbolicLinkCannotPassAsDownloadedExecutable() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("main"), link = folder.appendingPathComponent("link")
        try (valid + Data(repeating: 0, count: 32)).write(to: file)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
        try UniversalBinaryPolicy.verify(file)
        XCTAssertThrowsError(try UniversalBinaryPolicy.verify(link))
    }
}
