import Darwin
import Foundation
import Metal

// STANDALONE STARTER, intended to be compiled/tested by Claude Code on a real Mac.
// ProcessInfo.physicalMemory is physical RAM, NOT free RAM.
// MTLDevice.recommendedMaxWorkingSetSize is guidance, NOT spare GPU memory.
// The memory-pressure field remains "unknown" until the runtime observer has sampled it.

struct DeviceSnapshot: Encodable {
    let probe_version: Int
    let apple_silicon: Bool
    let metal_supported: Bool
    let metal_name: String?
    let metal_has_unified_memory: Bool?
    let physical_memory_bytes: UInt64
    let metal_recommended_working_set_bytes: UInt64?
    let metal_current_allocated_bytes: UInt64?
    let logical_cpu_count: Int
    let active_cpu_count: Int
    let hardware_model_identifier: String?
    let os_version: String
    let low_power_mode: Bool
    let thermal_state: String
    let memory_pressure: String
    let timestamp_utc: String
}

func sysctlInt(_ key: String) -> Int32? {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    let rc = sysctlbyname(key, &value, &size, nil, 0)
    return rc == 0 ? value : nil
}

func sysctlString(_ key: String) -> String? {
    var byteCount = 0
    guard sysctlbyname(key, nil, &byteCount, nil, 0) == 0, byteCount > 0 else { return nil }
    var buffer = [CChar](repeating: 0, count: byteCount)
    let result = buffer.withUnsafeMutableBufferPointer { ptr in
        sysctlbyname(key, ptr.baseAddress, &byteCount, nil, 0)
    }
    guard result == 0 else { return nil }
    return String(cString: buffer)
}

func thermalName(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
}

func collect() -> DeviceSnapshot {
    let p = ProcessInfo.processInfo
    let gpu = MTLCreateSystemDefaultDevice()
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return DeviceSnapshot(
        probe_version: 1,
        apple_silicon: sysctlInt("hw.optional.arm64") == 1,
        metal_supported: gpu != nil,
        metal_name: gpu?.name,
        metal_has_unified_memory: gpu?.hasUnifiedMemory,
        physical_memory_bytes: p.physicalMemory,
        metal_recommended_working_set_bytes: gpu?.recommendedMaxWorkingSetSize,
        metal_current_allocated_bytes: gpu.map { UInt64(max(0, $0.currentAllocatedSize)) },
        logical_cpu_count: p.processorCount,
        active_cpu_count: p.activeProcessorCount,
        hardware_model_identifier: sysctlString("hw.model"),
        os_version: p.operatingSystemVersionString,
        low_power_mode: p.isLowPowerModeEnabled,
        thermal_state: thermalName(p.thermalState),
        memory_pressure: "unknown",
        timestamp_utc: formatter.string(from: Date())
    )
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
do {
    let data = try encoder.encode(collect())
    print(String(decoding: data, as: UTF8.self))
} catch {
    fputs("probe error: \(error)\n", stderr)
    exit(1)
}
