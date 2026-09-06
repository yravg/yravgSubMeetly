// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "yraverageSubMin",
    platforms: [.macOS("26.0")],
    targets: [
        // Capture / audio / translation core, shared by the app and the spikes.
        .target(name: "SubMinKit"),
        // Throwaway probe: verifies ScreenCaptureKit per-app audio capture.
        .executableTarget(name: "yraverageSubMin", dependencies: ["SubMinKit"]),
        .executableTarget(name: "spike-capture", dependencies: ["SubMinKit"]),
        .executableTarget(name: "spike-engine", dependencies: ["SubMinKit"]),
    ]
)
