// swift-tools-version: 5.9
// Shortme Mac-Helfer: Hardware-Messung (RAM, Speicherdruck, Temperatur, Metal) und Apple SoundAnalysis über eine ganze Tonspur.
// Bauen: swift build -c release --package-path native/mac-worker  → .build/release/shortme-mac-worker
import PackageDescription

let package = Package(
    name: "ShortmeMacWorker",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "shortme-mac-worker", targets: ["ShortmeMacWorker"])],
    targets: [.executableTarget(name: "ShortmeMacWorker")]
)
