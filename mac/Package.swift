// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LocalTransSub",
    platforms: [.macOS("26.0")],
    targets: [
        // Capture / audio / translation core, shared by the app and the spikes.
        .target(name: "TransSubKit"),
        // Throwaway probe: verifies ScreenCaptureKit per-app audio capture.
        .executableTarget(name: "LocalTransSub", dependencies: ["TransSubKit"]),
        .executableTarget(name: "spike-capture", dependencies: ["TransSubKit"]),
        .executableTarget(name: "spike-engine", dependencies: ["TransSubKit"]),
    ]
)
