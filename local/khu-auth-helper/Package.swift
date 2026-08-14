// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "KHUAuthHelper",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .library(name: "KHUAuthCore", targets: ["KHUAuthCore"]),
        .executable(name: "khu-keychain-helper", targets: ["KHUAuthHelper"]),
        .executable(name: "khu-auth-self-test", targets: ["KHUAuthSelfTest"]),
    ],
    targets: [
        .target(
            name: "KHUAuthCore",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("LocalAuthentication"),
                .linkedFramework("Security"),
                .linkedFramework("WebKit"),
            ]
        ),
        .executableTarget(
            name: "KHUAuthHelper",
            dependencies: ["KHUAuthCore"]
        ),
        .executableTarget(
            name: "KHUAuthSelfTest",
            dependencies: ["KHUAuthCore"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
