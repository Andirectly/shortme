// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ShortMeHardwareProbe",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "shortme-hardware-probe", targets: ["ShortMeHardwareProbe"])],
    targets: [.executableTarget(name: "ShortMeHardwareProbe")]
)
