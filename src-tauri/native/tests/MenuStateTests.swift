import Foundation

@main struct MenuStateTests {
  @MainActor static func main() throws {
    let model = MenuModel()
    var requests: [Int32] = []
    model.action = { code, _ in requests.append(code) }
    func update(_ time: String, _ cpu: [String], visible: Bool) throws {
      let value: [String: Any] = [
        "observedAt": 1000, "monotonicMs": time, "cpuTicks": cpu, "powerSources": [],
        "diskCounters": [], "source": "fixture",
      ]
      let data = try JSONSerialization.data(withJSONObject: ["kind": "host", "value": value])
      model.receive(data, visible: visible)
    }
    try update("1000", ["10", "20", "70", "0"], visible: false)
    model.begin()
    try update("3500", ["20", "30", "150", "0"], visible: true)
    let firstIDs = model.samples.map(\.id)
    let segment = model.samples.last!.segment
    model.expanded.insert("usb-c:1")
    model.begin()
    try update("6000", ["30", "40", "230", "0"], visible: false)
    model.begin()
    precondition(model.samples.count == 3, "Hidden samples must remain in the chart")
    precondition(
      Array(model.samples.prefix(2)).map(\.id) == firstIDs,
      "Reopening must preserve existing history")
    precondition(model.samples.last?.cpu == 20, "Reopening must not reset the delta baseline")
    precondition(model.samples.last?.segment == segment, "Panel visibility is not a telemetry gap")
    precondition(model.expanded.contains("usb-c:1"), "Reopening preserves disclosure state")
    precondition(requests == [1, 1, 1], "Showing the panel only refreshes cached metadata")
    try update("30000", ["40", "50", "310", "0"], visible: false)
    precondition(model.samples.last?.cpu == nil, "Actual missing intervals remain gaps")
    precondition(
      model.samples.last?.segment != segment,
      "Sleep or missing telemetry starts a distinct chart segment")
    print("Native menu state: 8 continuity checks passed")
  }
}
