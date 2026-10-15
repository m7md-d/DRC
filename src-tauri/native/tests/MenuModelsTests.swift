import Foundation

@main struct MenuModelsTests {
  static func main() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
      precondition(condition, message)
      checks += 1
    }
    func host(
      _ ms: String, registry: String = "41", read: String = "9007199254740993",
      write: String = "100", ticks: [String]? = ["10", "20", "70", "0"]
    ) throws -> Host {
      var object: [String: Any] = [
        "observedAt": 1000, "monotonicMs": ms, "powerSources": [], "source": "fixture",
        "diskCounters": [
          [
            "deviceId": "disk8", "registryId": registry,
            "statistics": ["Bytes (Read)": read, "Bytes (Write)": write],
          ]
        ],
      ]
      object["cpuTicks"] = ticks
      object["memory"] = [
        "activeBytes": "0", "wiredBytes": "0", "compressedBytes": "0", "inactiveBytes": "42",
        "freeBytes": "42",
      ]
      return try JSONDecoder().decode(
        Host.self, from: JSONSerialization.data(withJSONObject: object))
    }
    let before = try host("1000")
    let next = try host(
      "3000", read: "9007199254740994", write: "106", ticks: ["12", "22", "76", "0"])
    let point = observe(previous: before, next: next, segment: 0)
    check(
      point.disks["disk8"]?.read == 0.5, "Subtract exact counters before floating point conversion")
    check(point.disks["disk8"]?.write == 3, "Use monotonic elapsed time for rate")
    check(point.cpu == 40, "CPU measures non-idle tick deltas")
    check(point.memory == 0, "Zero memory is a reported value")
    check(
      observe(previous: nil, next: next, segment: 0).disks.isEmpty, "First sample cannot imply idle"
    )
    check(
      observe(previous: before, next: try host("1000"), segment: 0).disks.isEmpty,
      "Equal timestamps cannot give a rate")
    check(
      observe(previous: before, next: try host("12000"), segment: 1).cpu == nil,
      "Hidden or delayed sampling leaves a gap")
    check(
      observe(previous: before, next: try host("3000", registry: "42"), segment: 0).disks.isEmpty,
      "Reconnected BSD id is not the old driver")
    check(
      observe(previous: before, next: try host("3000", read: "1"), segment: 0).disks.isEmpty,
      "Counter reset leaves a gap")
    check(
      observe(previous: before, next: try host("3000", ticks: nil), segment: 0).cpu == nil,
      "Missing CPU is not zero")
    check(exactSum([String(UInt64.max), "1"]) == nil, "Counter overflow is rejected")
    check(byteLabel("0") == "0 B", "Zero capacity is displayed exactly")
    check(byteLabel("8589934592", memory: true) == "8.00 GiB", "RAM uses binary units")
    check(byteLabel("251000193024") == "251.00 GB", "Disk sizes use decimal units")
    check(
      byteLabel(String(UInt64.max)) == "18446.74 PB",
      "Formatting the largest counter does not overflow")
    check(rateLabel(nil) == "Not sampled", "Unavailable rate is explicit")
    check(rateLabel(0) == "0 B/s", "An observed idle rate is zero")
    let json = Data(
      #"{"id":"usb-c:1","label":"USB-C port 1","kind":"Host connector","source":"macOS host port number","fields":null,"diskIds":[],"observations":[{"source":"IORegistry","rawName":"usb-drd0-port-ss","relation":"UsbCPortNumber","fields":{"future":"18446744073709551615","bus_power_used":"100","device_speed":"super_speed"}}],"children":[]}"#
        .utf8)
    let connector = try JSONDecoder().decode(PortNode.self, from: json)
    check(connector.label == "USB-C port 1", "Native names come from the shared hardware tree")
    check(
      connector.observations[0].rawName == "usb-drd0-port-ss",
      "Raw names remain available in details")
    check(
      connector.observations[0].fields["future"].text == String(UInt64.max),
      "Source evidence keeps exact unknown fields")
    check(
      connector.readings(for: connector.observations[0].fields).contains {
        $0.0 == "Power requested" && $0.1 == "100 mA"
      }, "Power readings keep their units")
    check(
      connector.diskIDs.isEmpty && connector.children.isEmpty,
      "An empty connector never invents readable media")
    let telemetry = try JSONDecoder().decode(
      CPUTelemetry.self,
      from: Data(
        #"{"temperatureCelsius":52.5,"temperatureSensors":[],"frequencies":[{"channel":"ECPU0","cluster":"Efficiency","mhz":1000,"intervalMs":"2500"},{"channel":"PCPU0","cluster":"Performance","mhz":2400,"intervalMs":"2500"}],"frequencyScope":"Active residency","temperatureScope":"CPU thermal zones"}"#
          .utf8))
    check(
      telemetry.frequencyLabel == "E 1.00 · P 2.40 GHz",
      "Frequency header identifies both CPU tiers")
    let exact = try JSONDecoder().decode(JSONValue.self, from: Data("18446744073709551615".utf8))
    check(exact.text == String(UInt64.max), "Original JSON numbers retain exact integer precision")
    print("Native menu models: \(checks) checks passed")
  }
}
