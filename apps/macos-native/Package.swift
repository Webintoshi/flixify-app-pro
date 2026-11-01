// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FlixifyMac",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "FlixifyCore", targets: ["FlixifyCore"]),
        .executable(name: "FlixifyMac", targets: ["FlixifyMac"])
    ],
    targets: [
        .binaryTarget(name: "VLCKit", path: "Vendor/VLCKit.xcframework"),
        .target(name: "FlixifyCore", linkerSettings: [.linkedFramework("Security")]),
        .executableTarget(name: "FlixifyMac", dependencies: ["FlixifyCore", "VLCKit"],
            resources: [.process("Resources")],
            swiftSettings: [.define("FIXTURE_QA", .when(configuration: .debug))],
            linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("AVFoundation")]),
        .testTarget(name: "FlixifyCoreTests", dependencies: ["FlixifyCore"])
    ],
    swiftLanguageVersions: [.v5]
)
