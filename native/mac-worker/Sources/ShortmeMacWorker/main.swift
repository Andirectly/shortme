// Shortme Mac-Helfer (ein Aufruf = eine Aufgabe, Ergebnis als JSON auf stdout, Fehler auf stderr + Exit-Code ≠ 0).
//   shortme-mac-worker probe                                   → Hardware-Momentaufnahme
//   shortme-mac-worker sound-events <audio> [window] [overlap] → JSON-Zeilen je Fenster: {"t":start,"d":dauer,"c":{label:konfidenz}}
// Herkunft Probe: docs/implementation/shortme-mac/starter/HardwareProbe (erweitert um Speicherdruck und verfügbaren Speicher).
import Darwin
import Foundation
import Metal
import SoundAnalysis
import AVFoundation

// ---------------------------------------------------------------------------------------------------- probe
struct DeviceSnapshot: Encodable {
    let probeVersion: Int
    let appleSilicon: Bool
    let metalName: String?
    let physicalMemoryBytes: UInt64
    /// frei + inaktiv + entfernbar (grobe Obergrenze dessen, was ein neuer Prozess ohne Auslagern bekommt). Physischer RAM ist NICHT freier RAM.
    let availableMemoryBytes: UInt64?
    let swapUsedBytes: UInt64?
    /// Richtwert von Metal, NICHT freier GPU-Speicher
    let metalRecommendedWorkingSetBytes: UInt64?
    let metalCurrentAllocatedBytes: UInt64?
    let cpuCount: Int
    let performanceCores: Int?
    let modelIdentifier: String?
    let osVersion: String
    let lowPowerMode: Bool
    let thermalState: String
    /// normal | warn | critical (Kernel-Stufe kern.memorystatus_vm_pressure_level)
    let memoryPressure: String
    let timestampUtc: String
}

func sysctlInt(_ key: String) -> Int64? {
    var v: Int64 = 0
    var size = MemoryLayout<Int64>.size
    guard sysctlbyname(key, &v, &size, nil, 0) == 0 else { return nil }
    // 32-Bit-Werte stehen in den unteren Bytes
    return size == 4 ? Int64(Int32(truncatingIfNeeded: v)) : v
}

func sysctlString(_ key: String) -> String? {
    var n = 0
    guard sysctlbyname(key, nil, &n, nil, 0) == 0, n > 0 else { return nil }
    var buf = [CChar](repeating: 0, count: n)
    guard sysctlbyname(key, &buf, &n, nil, 0) == 0 else { return nil }
    return String(cString: buf)
}

func availableMemory() -> UInt64? {
    var stats = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
    let rc = withUnsafeMutablePointer(to: &stats) { p in
        p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) }
    }
    guard rc == KERN_SUCCESS else { return nil }
    let page = UInt64(vm_kernel_page_size)
    return (UInt64(stats.free_count) + UInt64(stats.inactive_count) + UInt64(stats.purgeable_count)) * page
}

func swapUsed() -> UInt64? {
    var sw = xsw_usage()
    var size = MemoryLayout<xsw_usage>.size
    guard sysctlbyname("vm.swapusage", &sw, &size, nil, 0) == 0 else { return nil }
    return sw.xsu_used
}

func thermalName(_ s: ProcessInfo.ThermalState) -> String {
    switch s { case .nominal: return "nominal"; case .fair: return "fair"; case .serious: return "serious"; case .critical: return "critical"; @unknown default: return "unknown" }
}

func pressureName() -> String {
    switch sysctlInt("kern.memorystatus_vm_pressure_level") { case 1: return "normal"; case 2: return "warn"; case 4: return "critical"; default: return "unknown" }
}

func probe() throws {
    let p = ProcessInfo.processInfo
    let gpu = MTLCreateSystemDefaultDevice()
    let iso = ISO8601DateFormatter()
    let snap = DeviceSnapshot(
        probeVersion: 2,
        appleSilicon: sysctlInt("hw.optional.arm64") == 1,
        metalName: gpu?.name,
        physicalMemoryBytes: p.physicalMemory,
        availableMemoryBytes: availableMemory(),
        swapUsedBytes: swapUsed(),
        metalRecommendedWorkingSetBytes: gpu?.recommendedMaxWorkingSetSize,
        metalCurrentAllocatedBytes: gpu.map { UInt64(max(0, $0.currentAllocatedSize)) },
        cpuCount: p.activeProcessorCount,
        performanceCores: sysctlInt("hw.perflevel0.logicalcpu").map { Int($0) },
        modelIdentifier: sysctlString("hw.model"),
        osVersion: p.operatingSystemVersionString,
        lowPowerMode: p.isLowPowerModeEnabled,
        thermalState: thermalName(p.thermalState),
        memoryPressure: pressureName(),
        timestampUtc: iso.string(from: Date())
    )
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    print(String(decoding: try enc.encode(snap), as: UTF8.self))
}

// ---------------------------------------------------------------------------------------------------- sound-events
/// Schreibt je Analysefenster die Klassen ab einer Mindestkonfidenz als JSON-Zeile (die Auswertung mit Hysterese macht der Aufrufer).
final class Collector: NSObject, SNResultsObserving {
    let minConfidence: Double
    var failed: Error?
    var windows = 0
    let out = FileHandle.standardOutput
    init(minConfidence: Double) { self.minConfidence = minConfidence }
    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let r = result as? SNClassificationResult else { return }
        var c: [String: Double] = [:]
        for k in r.classifications where k.confidence >= minConfidence { c[k.identifier] = (k.confidence * 1000).rounded() / 1000 }
        let t = r.timeRange.start.seconds, d = r.timeRange.duration.seconds
        guard t.isFinite, d.isFinite else { return }
        let line: [String: Any] = ["t": (t * 1000).rounded() / 1000, "d": (d * 1000).rounded() / 1000, "c": c]
        if let data = try? JSONSerialization.data(withJSONObject: line, options: [.sortedKeys]) { out.write(data); out.write("\n".data(using: .utf8)!) }
        windows += 1
    }
    func request(_ request: SNRequest, didFailWithError error: Error) { failed = error }
    func requestDidComplete(_ request: SNRequest) {}
}

func soundEvents(_ path: String, window: Double, overlap: Double) throws {
    let url = URL(fileURLWithPath: path)
    let req = try SNClassifySoundRequest(classifierIdentifier: .version1)
    req.windowDuration = CMTime(seconds: window, preferredTimescale: 48_000)
    req.overlapFactor = overlap
    let analyzer = try SNAudioFileAnalyzer(url: url)
    let col = Collector(minConfidence: 0.05)
    try analyzer.add(req, withObserver: col)
    analyzer.analyze()  // blockiert bis zum Ende der Datei
    if let e = col.failed { throw e }
    FileHandle.standardError.write("windows=\(col.windows) classes=\(req.knownClassifications.count)\n".data(using: .utf8)!)
}

// ---------------------------------------------------------------------------------------------------- main
let args = CommandLine.arguments
do {
    switch args.count > 1 ? args[1] : "" {
    case "probe": try probe()
    case "sound-events":
        guard args.count > 2 else { throw NSError(domain: "args", code: 2, userInfo: [NSLocalizedDescriptionKey: "sound-events <audio> [window] [overlap]"]) }
        try soundEvents(args[2], window: args.count > 3 ? Double(args[3]) ?? 1.5 : 1.5, overlap: args.count > 4 ? Double(args[4]) ?? 0.5 : 0.5)
    case "labels":
        print((try SNClassifySoundRequest(classifierIdentifier: .version1)).knownClassifications.joined(separator: "\n"))
    default:
        throw NSError(domain: "args", code: 2, userInfo: [NSLocalizedDescriptionKey: "Befehl: probe | sound-events <audio> [window] [overlap] | labels"])
    }
} catch {
    FileHandle.standardError.write("Fehler: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
