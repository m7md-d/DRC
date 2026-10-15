import Foundation

// Device measurements arrive as decimal strings. Never decode byte counters through Double.
indirect enum JSONValue: Codable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Decimal)
  case bool(Bool)
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([String: JSONValue].self) {
      self = .object(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .number(try c.decode(Decimal.self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let x): try c.encode(x)
    case .array(let x): try c.encode(x)
    case .string(let x): try c.encode(x)
    case .number(let x): try c.encode(x)
    case .bool(let x): try c.encode(x)
    case .null: try c.encodeNil()
    }
  }
  var formatted: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return (try? encoder.encode(self)).flatMap { String(data: $0, encoding: .utf8) }
      ?? "Unavailable"
  }
  subscript(_ key: String) -> JSONValue {
    if case .object(let v) = self { return v[key] ?? .null }
    return .null
  }
  var text: String? {
    switch self {
    case .string(let s): return s
    case .number(let n): return NSDecimalNumber(decimal: n).stringValue
    default: return nil
    }
  }
  var flag: Bool? {
    if case .bool(let v) = self { return v }
    return nil
  }
  var entries: [String: JSONValue] {
    if case .object(let v) = self { return v }
    return [:]
  }
  var list: [JSONValue] {
    if case .array(let v) = self { return v }
    return []
  }
  var objects: [JSONValue] {
    switch self {
    case .array(let v):
      return v.filter {
        if case .object = $0 { return true }
        return false
      }
    case .object: return [self]
    default: return []
    }
  }
  var display: String { text ?? flag.map { $0 ? "true" : "false" } ?? "Not reported" }
}

struct Disk: Decodable, Identifiable {
  let id: String, identityKey: String, name: String
  let sizeBytes: String?, `internal`: Bool?, `protocol`: String?, content: String?
  let partitions: [JSONValue]
  let metadataOnly: Bool?, infoError: String?
}
struct Discovery: Decodable {
  let devices: [Disk]
  let observedAt: UInt64
}
struct Record: Decodable {
  let startedAt: UInt64
  let exitCode: Int?
  let timedOut: Bool?
}
struct Query: Decodable {
  let fields: JSONValue?
  let record: Record
  let parseError: String?
  let topology: [PortNode]?
}
struct Snapshot: Decodable {
  let discovery: Discovery?, connection: Query?, invalidatedAt: UInt64?, activity: String?
  let smartReports: [String: Query]
}
struct Memory: Decodable {
  let activeBytes: String, wiredBytes: String, compressedBytes: String, inactiveBytes: String,
    freeBytes: String
}
struct DiskCounter: Decodable {
  let deviceId: String, registryId: String
  let statistics: [String: JSONValue]
}
struct CPUFrequency: Decodable {
  let channel: String, cluster: String
  let mhz: Double
  let intervalMs: String
}
struct CPUSensor: Decodable {
  let name: String, source: String
  let celsius: Double
}
struct CPUTelemetry: Decodable {
  let temperatureCelsius: Double?, temperatureSensors: [CPUSensor], frequencies: [CPUFrequency]
  let frequencyScope: String, temperatureScope: String
  func mhz(_ cluster: String) -> Double? {
    let values = frequencies.filter { $0.cluster == cluster }.map { $0.mhz }
    return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
  }
  var frequencyLabel: String {
    let e = mhz("Efficiency").map { String(format: "E %.2f", $0 / 1000) }
    let p = mhz("Performance").map { String(format: "P %.2f", $0 / 1000) }
    let labels = [e, p].compactMap { $0 }
    return labels.isEmpty ? "— GHz" : labels.joined(separator: " · ") + " GHz"
  }
}
struct Host: Decodable {
  let observedAt: UInt64, monotonicMs: String
  let model: String?, chip: String?, osVersion: String?, logicalCores: Int?, memoryBytes: String?,
    memory: Memory?
  let cpuTelemetry: CPUTelemetry?
  let cpuTicks: [String]?, loadAverage: [Double]?, uptimeSeconds: String?
  let powerSources: [JSONValue], diskCounters: [DiskCounter]
  let source: String
  var memoryFootprint: UInt64? {
    guard let m = memory else { return nil }
    return exactSum([m.activeBytes, m.wiredBytes, m.compressedBytes])
  }
  var battery: JSONValue? {
    powerSources.first { $0["Type"].text == "InternalBattery" } ?? powerSources.first
  }
  var batteryPercent: Double? {
    guard let battery, let current = battery["Current Capacity"].text.flatMap(Double.init),
      let max = battery["Max Capacity"].text.flatMap(Double.init), max > 0
    else { return nil }
    return current / max * 100
  }
}
struct Rates { let read: Double, write: Double, registryID: String }
struct Sample: Identifiable {
  let id = UUID(), seconds: Double, segment: Int
  let cpu: Double?, memory: UInt64?, disks: [String: Rates]
}
func exactSum(_ values: [String]) -> UInt64? {
  var total: UInt64 = 0
  for value in values {
    guard let n = UInt64(value) else { return nil }
    let (next, overflow) = total.addingReportingOverflow(n)
    if overflow { return nil }
    total = next
  }
  return total
}
func observe(previous: Host?, next: Host, segment: Int) -> Sample {
  let now = UInt64(next.monotonicMs) ?? 0
  let before = previous.flatMap { UInt64($0.monotonicMs) }
  let elapsed = before.flatMap { now > $0 ? Double(now - $0) / 1000 : nil }
  let valid = elapsed.map { $0 > 0 && $0 <= 10 } ?? false
  var cpu: Double?
  var rates: [String: Rates] = [:]
  if valid, let old = previous?.cpuTicks, let new = next.cpuTicks, old.count == 4, new.count == 4 {
    var delta: [UInt64] = []
    for i in 0..<4 {
      if let a = UInt64(old[i]), let b = UInt64(new[i]), b >= a { delta.append(b - a) }
    }
    if delta.count == 4, let total = exactSum(delta.map(String.init)), total > 0 {
      cpu = Double(total - delta[2]) / Double(total) * 100
    }
  }
  if valid, let previous, let elapsed {
    for disk in next.diskCounters {
      guard
        let old = previous.diskCounters.first(where: {
          $0.deviceId == disk.deviceId && $0.registryId == disk.registryId
        }),
        let r = disk.statistics["Bytes (Read)"]?.text.flatMap(UInt64.init),
        let w = disk.statistics["Bytes (Write)"]?.text.flatMap(UInt64.init),
        let pr = old.statistics["Bytes (Read)"]?.text.flatMap(UInt64.init),
        let pw = old.statistics["Bytes (Write)"]?.text.flatMap(UInt64.init), r >= pr, w >= pw
      else { continue }
      rates[disk.deviceId] = Rates(
        read: Double(r - pr) / elapsed, write: Double(w - pw) / elapsed, registryID: disk.registryId
      )
    }
  }
  return Sample(
    seconds: Double(now) / 1000, segment: segment, cpu: cpu, memory: next.memoryFootprint,
    disks: rates)
}
func byteLabel(_ value: String?, memory: Bool = false) -> String {
  guard let value, let bytes = UInt64(value) else { return "Not reported" }
  let unit: UInt64
  let suffix: String
  if memory {
    unit = bytes >= 1_073_741_824 ? 1_073_741_824 : 1_048_576
    suffix = unit == 1_073_741_824 ? "GiB" : "MiB"
  } else {
    let names = ["B", "KB", "MB", "GB", "TB", "PB"]
    var index = 0
    var divisor: UInt64 = 1
    while bytes / divisor >= 1000 && index < names.count - 1 {
      divisor *= 1000
      index += 1
    }
    unit = divisor
    suffix = names[index]
  }
  if unit == 1 { return "\(bytes) B" }
  let fraction = bytes % unit * 100 / unit
  return "\(bytes/unit).\(String(format:"%02llu",fraction)) \(suffix)"
}
func rateLabel(_ value: Double?) -> String {
  guard let value, value.isFinite, value >= 0, value < Double(UInt64.max) else {
    return "Not sampled"
  }
  return byteLabel(String(UInt64(value.rounded()))) + "/s"
}
func observedTime(_ value: UInt64?) -> String {
  guard let value else { return "Not collected" }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.dateFormat = "HH:mm:ss"
  return formatter.string(from: Date(timeIntervalSince1970: Double(value) / 1000))
}
func uptimeLabel(_ value: String?) -> String {
  guard let value, let seconds = UInt64(value) else { return "Not reported" }
  return "\(seconds/86400)d \(seconds/3600%24)h"
}

struct PortObservation: Decodable {
  let source: String, rawName: String, relation: String, fields: JSONValue
}
struct PortNode: Decodable, Identifiable {
  let id: String, label: String, kind: String, source: String, fields: JSONValue,
    children: [PortNode], diskIDs: [String]
  let observations: [PortObservation]
  enum CodingKeys: String, CodingKey {
    case id, label, kind, source, fields, children, observations
    case diskIDs = "diskIds"
  }
  var readings: [(String, String, String)] { readings(for: fields) }
  func readings(for fields: JSONValue) -> [(String, String, String)] {
    let speedNames = [
      "low_speed": "Up to 1.5 Mb/s", "full_speed": "Up to 12 Mb/s", "high_speed": "Up to 480 Mb/s",
      "super_speed": "Up to 5 Gb/s", "super_speed_plus": "Up to 10 Gb/s",
      "super_speed_plus_by_2": "Up to 20 Gb/s",
    ]
    let definitions: [(String, [String], String)] = [
      (
        "Link / speed", ["device_speed", "speed", "current_speed_key", "current_link_speed"],
        "Reported link or descriptor; not measured disk throughput."
      ),
      (
        "Power requested", ["bus_power_used", "bMaxPower", "USB Power Requested"],
        "Declared USB power request; not measured current into the SSD."
      ),
      (
        "Power available",
        [
          "bus_power", "bus_power_available", "kUSBWakePortCurrentLimit",
          "kUSBSleepPortCurrentLimit",
        ], "Host-reported budget; not proof of voltage or current reaching the SSD."
      ),
      (
        "Port / power state",
        [
          "IOPowerManagement.CurrentPowerState", "receptacle_status_key", "IOServiceState",
          "authorized",
        ], "Original reported state; does not diagnose the disk inside an enclosure."
      ),
    ]
    return definitions.compactMap { label, keys, hint in
      for key in keys {
        let field =
          key == "IOPowerManagement.CurrentPowerState"
          ? fields["IOPowerManagement"]["CurrentPowerState"] : fields[key]
        guard let text = field.text ?? field.flag.map({ $0 ? "true" : "false" }) else { continue }
        let value: String
        if key == "device_speed" {
          value = speedNames[text] ?? text
        } else if [
          "bus_power", "bus_power_used", "bus_power_available", "kUSBWakePortCurrentLimit",
          "kUSBSleepPortCurrentLimit",
        ].contains(key), UInt64(text) != nil {
          value = text + " mA"
        } else {
          value = text
        }
        return (label, value, hint)
      }
      return nil
    }
  }
}
