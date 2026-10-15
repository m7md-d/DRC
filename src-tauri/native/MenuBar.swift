import AppKit
import Charts
import SwiftUI

public typealias DRCMenuCallback = @convention(c) (Int32, UnsafePointer<CChar>?) -> Void

@MainActor final class MenuModel: ObservableObject {
  @Published var snapshot: Snapshot?
  @Published var host: Host?
  @Published var samples: [Sample] = []
  @Published var section = 0
  @Published var selectedID = ""
  @Published var busy: String?
  @Published var error: String?
  @Published var activity: String?
  @Published var expanded: Set<String> = []
  @Published var hostRaw = ""
  @Published var panelHeight: CGFloat = 400
  private var knownNodes: Set<String> = []
  private var previous: Host?
  private var segment = 0
  var hostInFlight = false
  var action: ((Int32, String?) -> Void)?
  var disk: Disk? { snapshot?.discovery?.devices.first { $0.id == selectedID } }
  var ports: [PortNode] { portTree(snapshot?.connection?.fields) }
  var queryDisabled: Bool { busy != nil || activity != nil }
  func begin() {
    previous = nil
    segment += 1
    hostInFlight = false
    action?(1, nil)
    sample()
  }
  func sample() {
    if !hostInFlight {
      hostInFlight = true
      action?(2, nil)
    }
  }
  func refresh(_ section: Int) {
    busy = section == 3 ? "disks" : "ports"
    error = nil
    action?(Int32(section), nil)
  }
  func open(_ section: String = "overview", diskID: String? = nil) {
    let value: [String: Any] = ["section": section, "deviceId": diskID as Any? ?? NSNull()]
    if let data = try? JSONSerialization.data(withJSONObject: value),
      let text = String(data: data, encoding: .utf8)
    {
      action?(5, text)
    }
  }
  func binding(_ id: String) -> Binding<Bool> {
    Binding(
      get: { self.expanded.contains(id) },
      set: { if $0 { self.expanded.insert(id) } else { self.expanded.remove(id) } })
  }
  func receive(_ data: Data, visible: Bool) {
    struct Header: Decodable { let kind: String }
    struct SnapshotMessage: Decodable { let value: Snapshot }
    struct HostMessage: Decodable {
      let value: Host
      let activity: String?
    }
    struct QueryMessage: Decodable {
      let error: String?
      let busy: String?
    }
    let decoder = JSONDecoder()
    do {
      switch try decoder.decode(Header.self, from: data).kind {
      case "snapshot":
        let next = try decoder.decode(SnapshotMessage.self, from: data).value
        snapshot = next
        activity = next.activity
        if !next.discovery.map({ $0.devices.contains { $0.id == selectedID } }).isTrue {
          selectedID =
            (next.discovery?.devices.first { $0.internal == false } ?? next.discovery?.devices.first)?
            .id ?? ""
        }
        for root in portTree(next.connection?.fields) where !knownNodes.contains(root.id) {
          if root.id == "usb" { expanded.insert(root.id) }
          knownNodes.insert(root.id)
        }
      case "host":
        hostInFlight = false
        guard visible else { return }
        let next = try decoder.decode(HostMessage.self, from: data)
        // Every absent/reset counter starts a separate chart series: no bridge across a gap.
        if let previous, let a = UInt64(previous.monotonicMs),
          let b = UInt64(next.value.monotonicMs), b <= a || b - a > 10_000
        {
          segment += 1
        }
        let point = observe(previous: previous, next: next.value, segment: segment)
        samples.append(point)
        samples = Array(samples.suffix(48))
        previous = next.value
        host = next.value
        activity = next.activity
        hostRaw = String(data: data, encoding: .utf8) ?? ""
      case "query":
        let result = try decoder.decode(QueryMessage.self, from: data)
        busy = result.busy
        error = result.error
      case "host-error":
        hostInFlight = false
        if visible { error = try decoder.decode(QueryMessage.self, from: data).error }
      default: break
      }
    } catch {
      self.error = "Cannot decode the native monitor update: \(error.localizedDescription)"
      hostInFlight = false
    }
  }
}
extension Optional where Wrapped == Bool { fileprivate var isTrue: Bool { self == true } }

private struct ExactBytes: View {
  let value: String?
  var memory = false
  var body: some View {
    Text(byteLabel(value, memory: memory)).monospacedDigit().help(
      value.map { "\($0) bytes exactly · \(memory ? "binary GiB/MiB":"decimal GB/MB")" }
        ?? "The host did not return this reading.")
  }
}
private struct Reading: View {
  let label: String, value: String
  var hint = ""
  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(label).foregroundStyle(.secondary)
      Spacer(minLength: 12)
      Text(value).multilineTextAlignment(.trailing).textSelection(.enabled).monospacedDigit()
    }.font(.caption).help(hint)
  }
}
private struct SampleChart: View {
  let samples: [Sample]
  let primary: (Sample) -> Double?
  var secondary: ((Sample) -> Double?)? = nil
  var percent = false
  var label: String
  private var plotted: [ChartPoint] {
    var points: [ChartPoint] = []
    for (series, read) in [primary, secondary].enumerated() {
      guard let read else { continue }
      var group = 0
      var previousSegment: Int? = nil
      for sample in samples {
        guard let value = read(sample), value.isFinite, value >= 0 else {
          group += 1
          continue
        }
        if previousSegment != sample.segment { group += 1 }
        previousSegment = sample.segment
        points.append(
          ChartPoint(
            id: "\(series)-\(sample.id)", time: sample.seconds, value: value, series: series,
            segment: "\(series)-\(group)"))
      }
    }
    return points
  }
  var body: some View {
    let points = plotted
    if points.count < 2 {
      Text("Waiting for current samples").font(.caption).foregroundStyle(.secondary).frame(
        maxWidth: .infinity, minHeight: 28, alignment: .leading)
    } else {
      Chart(points) { point in
        LineMark(
          x: .value("Time", point.time), y: .value("Value", point.value),
          series: .value("Segment", point.segment)
        )
        .foregroundStyle(point.series == 0 ? Color.accentColor : Color.orange)
        .lineStyle(StrokeStyle(lineWidth: 1.7))
      }
      .chartXAxis(.hidden).chartYAxis(.hidden).chartYScale(
        domain: 0...(percent ? 100 : max(1, points.map(\.value).max() ?? 1))
      )
      .frame(height: 28).accessibilityLabel(label).help(
        "\(label). Recent visible samples only; missing or reset counters are gaps.")
    }
  }
  private struct ChartPoint: Identifiable {
    let id: String, time: Double, value: Double, series: Int, segment: String
  }
}
private struct SystemSection: View {
  @ObservedObject var model: MenuModel
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      GroupBox {
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Label("CPU", systemImage: "cpu").font(.headline)
            Spacer()
            Text(model.samples.last?.cpu.map { String(format: "%.1f%%", $0) } ?? "Sampling…")
              .monospacedDigit().font(.headline)
          }.help(
            "User + system + nice time across the logical cores, from differences in Mach CPU ticks."
          )
          SampleChart(
            samples: model.samples, primary: { $0.cpu }, percent: true, label: "Host CPU usage")
        }.padding(2)
      }
      GroupBox {
        VStack(alignment: .leading, spacing: 4) {
          HStack {
            Label("Memory", systemImage: "memorychip").font(.headline)
            Spacer()
            ExactBytes(value: model.host?.memoryFootprint.map(String.init), memory: true).font(
              .headline)
          }.help(
            "Active + wired + compressed physical pages. This is an explicit counter sum, not a memory pressure score."
          )
          SampleChart(
            samples: model.samples, primary: { $0.memory.map { Double($0) / 1_073_741_824 } },
            label: "Active + wired + compressed memory in GiB")
          Reading(label: "Installed", value: byteLabel(model.host?.memoryBytes, memory: true))
        }.padding(2)
      }
      GroupBox {
        VStack(spacing: 5) {
          HStack {
            Label("Battery", systemImage: "battery.100").font(.headline)
            Spacer()
            Text(model.host?.batteryPercent.map { String(format: "%.0f%%", $0) } ?? "Not reported")
              .monospacedDigit()
          }
          if let percent = model.host?.batteryPercent {
            ProgressView(value: min(100, max(0, percent)), total: 100).tint(.green)
              .accessibilityLabel("Battery charge")
          }
          HStack {
            Text(model.host?.battery?["Power Source State"].display ?? "Not reported")
            Spacer()
            Text(
              model.host?.battery?["Is Charging"].flag.map { $0 ? "Charging" : "Not charging" }
                ?? "Not reported")
          }.font(.caption).foregroundStyle(.secondary)
        }.padding(2)
      }
      DisclosureGroup("More readings", isExpanded: model.binding("system-details")) {
        VStack(spacing: 7) {
          Reading(
            label: "Logical cores",
            value: model.host?.logicalCores.map(String.init) ?? "Not reported")
          Reading(
            label: "Load · 1 / 5 / 15 min",
            value: model.host?.loadAverage?.map { String(format: "%.2f", $0) }.joined(
              separator: " / ") ?? "Not reported",
            hint: "Kernel load averages, not CPU percentages.")
          Reading(label: "Active", value: byteLabel(model.host?.memory?.activeBytes, memory: true))
          Reading(label: "Wired", value: byteLabel(model.host?.memory?.wiredBytes, memory: true))
          Reading(
            label: "Compressed", value: byteLabel(model.host?.memory?.compressedBytes, memory: true)
          )
          Reading(label: "Uptime", value: uptimeLabel(model.host?.uptimeSeconds))
          Text("CPU / GPU temperatures are not exposed by this monitor.").font(.caption)
            .foregroundStyle(.secondary)
          DisclosureGroup("Original host sample", isExpanded: model.binding("host-raw")) {
            ScrollView {
              Text(model.hostRaw).font(.system(.caption2, design: .monospaced)).textSelection(
                .enabled
              ).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(height: 100)
            Button("Copy original sample") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(model.hostRaw, forType: .string)
            }.disabled(model.hostRaw.isEmpty)
          }
        }.padding(.top, 6)
      }.font(.caption).padding(.horizontal, 3)
    }
  }
}
private struct DisksSection: View {
  @ObservedObject var model: MenuModel
  private var disk: Disk? { model.disk }
  private var counter: DiskCounter? { model.host?.diskCounters.first { $0.deviceId == disk?.id } }
  private var rates: Rates? { disk.flatMap { model.samples.last?.disks[$0.id] } }
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Connected disks").font(.headline)
        Spacer()
        Button {
          model.refresh(3)
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }.disabled(model.queryDisabled).help(
          "Read discovery metadata. No SMART, benchmark, or sector scan.")
      }
      Text("Observed \(observedTime(model.snapshot?.discovery?.observedAt))").font(.caption)
        .foregroundStyle(.secondary)
      if model.snapshot?.invalidatedAt != nil {
        Label("Connection event since this snapshot", systemImage: "info.circle").font(.caption)
          .foregroundStyle(.secondary)
      }
      if let disk {
        Picker("Disk", selection: $model.selectedID) {
          ForEach(model.snapshot?.discovery?.devices ?? []) { d in Text(d.name).tag(d.id) }
        }.labelsHidden().frame(maxWidth: .infinity)
        GroupBox {
          VStack(alignment: .leading, spacing: 10) {
            HStack {
              Image(systemName: "externaldrive").font(.title2).foregroundStyle(.secondary)
              VStack(alignment: .leading) {
                Text("/dev/\(disk.id)").font(.headline)
                Text(disk.protocol ?? "Protocol not reported").font(.caption).foregroundStyle(
                  .secondary)
              }
              Spacer()
              ExactBytes(value: disk.sizeBytes).font(.headline)
            }
            Reading(
              label: disk.internal == true ? "Internal" : "External / unreported",
              value: disk.content ?? "Layout not reported")
            if disk.metadataOnly == true {
              Label("Metadata only", systemImage: "lock.shield").font(.caption)
            }
            DisclosureGroup(
              "\(disk.partitions.count) reported partitions",
              isExpanded: model.binding("partitions-\(disk.id)")
            ) {
              ForEach(Array(disk.partitions.enumerated()), id: \.offset) { _, p in
                Reading(
                  label: p["VolumeName"].text ?? p["DeviceIdentifier"].text ?? "Partition",
                  value: byteLabel(p["Size"].text))
              }
            }.font(.caption)
            Button("All disk readings…") { model.open("device", diskID: disk.id) }.frame(
              maxWidth: .infinity, alignment: .trailing)
            if let error = disk.infoError { Text(error).font(.caption).foregroundStyle(.secondary) }
          }.padding(4)
        }
        GroupBox {
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text("Disk activity").font(.headline)
              Spacer()
              Text("All applications").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
              VStack(alignment: .leading) {
                Label("Read", systemImage: "arrow.down").foregroundStyle(Color.accentColor)
                Text(rateLabel(rates?.read)).font(.headline).monospacedDigit()
              }
              Spacer()
              Divider()
              Spacer()
              VStack(alignment: .leading) {
                Label("Write", systemImage: "arrow.up").foregroundStyle(.orange)
                Text(rateLabel(rates?.write)).font(.headline).monospacedDigit()
              }
            }.fixedSize(horizontal: false, vertical: true)
            SampleChart(
              samples: model.samples,
              primary: { point in
                guard let value = point.disks[disk.id], value.registryID == counter?.registryId
                else { return nil }
                return value.read
              },
              secondary: { point in
                guard let value = point.disks[disk.id], value.registryID == counter?.registryId
                else { return nil }
                return value.write
              }, label: "Disk read and write activity")
            Reading(
              label: "Driver bytes read",
              value: byteLabel(counter?.statistics["Bytes (Read)"]?.text),
              hint: "Cumulative driver-instance counter, not SMART lifetime bytes.")
            Reading(
              label: "Driver bytes written",
              value: byteLabel(counter?.statistics["Bytes (Write)"]?.text),
              hint:
                "Includes the OS and all apps. DRC does not generate writes to obtain this counter."
            )
          }.padding(4)
        }.help("Passive IOBlockStorageDriver counters; not a benchmark.")
        DisclosureGroup("SMART readings", isExpanded: model.binding("smart-" + disk.identityKey)) {
          smartSection(disk)
        }.font(.caption)
      } else {
        Label("No disks in the live snapshot", systemImage: "externaldrive.badge.questionmark")
          .foregroundStyle(.secondary).padding(.vertical, 20)
      }
      Button {
        model.open("acquisition", diskID: disk?.id)
      } label: {
        Label("Create or resume an image…", systemImage: "doc.on.doc")
      }.help("Opens the existing source, destination and command review. Does not start copying.")
    }
  }
  private func smartSection(_ disk: Disk) -> some View {
    let report = model.snapshot?.smartReports[disk.identityKey]
    let passed = report?.fields?["smart_status"]["passed"].flag
    let temp =
      report?.fields?["temperature"]["current"].text
      ?? report?.fields?["nvme_smart_health_information_log"]["temperature"].text
    return GroupBox {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("SMART · tool reported").font(.headline)
          Spacer()
          Text(report.map { observedTime($0.record.startedAt) } ?? "Not read this run").font(
            .caption
          ).foregroundStyle(.secondary)
        }
        Reading(
          label: "Reported status", value: passed.map { $0 ? "PASSED" : "FAILED" } ?? "Not reported"
        )
        Reading(label: "Temperature", value: temp.map { $0 + " °C" } ?? "Not reported")
        Text("Explicit reads remain in the workspace. No DRC health score.").font(.caption)
          .foregroundStyle(.secondary)
      }.padding(4)
    }
  }
}
private struct PortBranch: View {
  let node: PortNode
  @ObservedObject var model: MenuModel
  var body: some View {
    DisclosureGroup(isExpanded: model.binding(node.id)) {
      VStack(alignment: .leading, spacing: 9) {
        if node.kind != "Report" {
          ForEach(Array(node.readings.enumerated()), id: \.offset) { _, r in
            Reading(label: r.0, value: r.1, hint: r.2)
          }
          if node.readings.isEmpty {
            Text("No link or power values reported at this node.").font(.caption).foregroundStyle(
              .secondary)
          }
          if !node.diskIDs.isEmpty {
            Reading(label: "Reported media", value: node.diskIDs.joined(separator: ", "))
          }
        }
        ForEach(node.children) { child in PortBranch(node: child, model: model) }
      }.padding(.vertical, 6)
    } label: {
      HStack(alignment: .top, spacing: 8) {
        Image(
          systemName: node.children.isEmpty
            ? "cable.connector" : "point.3.connected.trianglepath.dotted"
        ).foregroundStyle(.secondary)
        VStack(alignment: .leading, spacing: 2) {
          Text(node.label)
          Text(node.kind == "Report" ? node.source : node.kind).font(.caption).foregroundStyle(
            .secondary)
        }
      }
    }
    .help(
      "Expand or collapse \(node.label). The disclosure indicator follows this node's actual expanded state."
    )
    .accessibilityIdentifier("port-\(node.id)")
  }
}
private struct PortsSection: View {
  @ObservedObject var model: MenuModel
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Ports & enclosures").font(.headline)
        Spacer()
        Button {
          model.refresh(4)
        } label: {
          Label(model.busy == "ports" ? "Reading…" : "Refresh", systemImage: "arrow.clockwise")
        }.disabled(model.queryDisabled).help(
          "Collect host connection metadata without reading disk sectors.")
      }
      Text("Observed \(observedTime(model.snapshot?.connection?.record.startedAt))").font(.caption)
        .foregroundStyle(.secondary)
      Label(
        "Reported power budgets · not measured draw.",
        systemImage: "info.circle"
      ).font(.caption).foregroundStyle(.secondary).help(
        "Actual current or voltage reaching the SSD requires electrical measurement hardware.")
      if model.ports.isEmpty {
        Text(
          "Refresh to see buses, hubs and attached devices, including enclosures without an accessible disk."
        ).foregroundStyle(.secondary).padding(.vertical, 15)
      }
      ForEach(model.ports) { root in GroupBox { PortBranch(node: root, model: model).padding(4) } }
      if let error = model.snapshot?.connection?.parseError {
        Text(error).font(.caption).foregroundStyle(.secondary)
      }
      Button("Open full port map…") { model.open("ports") }
    }
  }
}
private struct NativeRoot: View {
  @ObservedObject var model: MenuModel
  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 9) {
        Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 22, height: 22)
        Text("DRC").font(.headline)
        Text("Quick Look").foregroundStyle(.secondary)
        Spacer()
        Button {
          nativeMenu?.hide()
        } label: {
          Image(systemName: "xmark")
        }.buttonStyle(.plain).help("Close Quick Look")
      }
      HStack {
        Text(model.host?.chip ?? model.host?.model ?? "Your Mac")
        Spacer()
        Text(model.host?.osVersion.map { "macOS " + $0 } ?? "macOS").foregroundStyle(.secondary)
      }.font(.caption)
      Picker("Section", selection: $model.section) {
        Label("System", systemImage: "cpu").tag(0)
        Label("Disks", systemImage: "externaldrive").tag(1)
        Label("Ports", systemImage: "cable.connector").tag(2)
      }.pickerStyle(.segmented).labelsHidden()
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          if let error = model.error {
            Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(
              .secondary
            ).textSelection(.enabled)
          }
          if let activity = model.activity {
            HStack {
              ProgressView().controlSize(.small)
              Text(activity).font(.caption)
            }
          }
          switch model.section {
          case 1: DisksSection(model: model)
          case 2: PortsSection(model: model)
          default: SystemSection(model: model)
          }
        }.padding(.horizontal, 2).padding(.vertical, 3).frame(
          maxWidth: .infinity, alignment: .leading)
      }.id(model.section)
      Divider()
      HStack {
        Button {
          model.open()
        } label: {
          Label("Open workspace", systemImage: "macwindow")
        }.keyboardShortcut(.return, modifiers: [])
        Spacer()
        Button {
          model.action?(6, nil)
        } label: {
          Image(systemName: "power")
        }.help("Quit DRC. Active recovery operations use the existing stop-and-save guard.")
      }
    }.padding(12).frame(width: 360, height: model.panelHeight).controlSize(.small)
      .environment(\.locale, Locale(identifier: "en_US"))
  }
}

@MainActor private final class MenuController: NSObject, NSPopoverDelegate {
  let model = MenuModel()
  let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  let popover = NSPopover()
  let callback: DRCMenuCallback
  private var timer: Timer?
  init(callback: @escaping DRCMenuCallback) {
    self.callback = callback
    super.init()
    model.action = { [weak self] code, text in self?.send(code, text) }
    popover.behavior = .transient
    popover.animates = true
    popover.delegate = self
    popover.contentViewController = NSHostingController(rootView: NativeRoot(model: model))
    if let button = status.button {
      button.image = NSImage(
        systemSymbolName: "externaldrive", accessibilityDescription: "DRC Quick Look")
      button.image?.isTemplate = true
      button.toolTip = "DRC · disks and connections"
      button.target = self
      button.action = #selector(clicked(_:))
      button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }
  }
  func send(_ code: Int32, _ text: String? = nil) {
    if let text { text.withCString { callback(code, $0) } } else { callback(code, nil) }
  }
  @objc private func clicked(_ sender: Any?) {
    if NSApp.currentEvent?.type == .rightMouseUp {
      let menu = NSMenu()
      let open = NSMenuItem(title: "Open DRC", action: #selector(openWorkspace), keyEquivalent: "")
      open.target = self
      menu.addItem(open)
      menu.addItem(.separator())
      let quit = NSMenuItem(title: "Quit DRC", action: #selector(quit), keyEquivalent: "")
      quit.target = self
      menu.addItem(quit)
      if let button = status.button {
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
      }
    } else if popover.isShown {
      hide()
    } else {
      show()
    }
  }
  @objc private func openWorkspace() { model.open() }
  @objc private func quit() { send(6) }
  func show() {
    guard !popover.isShown, let button = status.button else { return }
    let height = button.window?.screen?.visibleFrame.height ?? 800
    model.panelHeight = min(400, max(300, height - 70))
    popover.contentSize = NSSize(width: 360, height: model.panelHeight)
    NSApp.activate(ignoringOtherApps: true)
    popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
    popover.contentViewController?.view.window?.title = "DRC Quick Look"
    popover.contentViewController?.view.window?.makeKey()
  }
  func hide() { popover.performClose(nil) }
  func popoverDidShow(_ notification: Notification) {
    send(7, "1")
    model.begin()
    timer?.invalidate()
    let timer = Timer(timeInterval: 2.5, repeats: true) { [weak self] _ in
      Task { @MainActor [weak self] in self?.model.sample() }
    }
    self.timer = timer
    RunLoop.main.add(timer, forMode: .common)
  }
  func popoverDidClose(_ notification: Notification) {
    timer?.invalidate()
    timer = nil
    send(7, "0")
  }
  func receive(_ text: String) {
    guard let data = text.data(using: .utf8) else { return }
    model.receive(data, visible: popover.isShown)
  }
}
@MainActor private var nativeMenu: MenuController?

@_cdecl("drc_native_menu_install") public func installNativeMenu(
  _ callback: @escaping DRCMenuCallback
) {
  DispatchQueue.main.async {
    if nativeMenu == nil { nativeMenu = MenuController(callback: callback) }
  }
}
@_cdecl("drc_native_menu_show") public func showNativeMenu() {
  DispatchQueue.main.async { nativeMenu?.show() }
}
@_cdecl("drc_native_menu_hide") public func hideNativeMenu() {
  DispatchQueue.main.async { nativeMenu?.hide() }
}
@_cdecl("drc_native_menu_receive") public func receiveNativeMenu(_ pointer: UnsafePointer<CChar>) {
  // Copy before returning across the ABI; Rust owns the transient input buffer.
  let text = String(cString: pointer)
  DispatchQueue.main.async { nativeMenu?.receive(text) }
}
