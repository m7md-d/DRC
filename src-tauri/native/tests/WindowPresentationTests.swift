import AppKit

// Simulate AppKit's reported state without entering a Space or presenting UI.
@MainActor private final class PresentationFixture: NSWindow {
  var reportedFullscreen = false
  override var styleMask: NSWindow.StyleMask {
    get {
      var mask = super.styleMask
      if reportedFullscreen { mask.insert(.fullScreen) }
      return mask
    }
    set { super.styleMask = newValue }
  }
}

@main struct WindowPresentationTests {
  @MainActor static func main() async {
    _ = NSApplication.shared
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) {
      precondition(condition(), message)
      checks += 1
    }
    // Invisible fixtures only; do not move or focus any user windows.
    let workspace = NSWindow(contentRect: .zero,
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    workspace.isReleasedWhenClosed = false
    workspace.styleMask.insert(.fullSizeContentView)
    let close = workspace.standardWindowButton(.closeButton)!
    let minimize = workspace.standardWindowButton(.miniaturizeButton)!
    let zoom = workspace.standardWindowButton(.zoomButton)!
    // Reproduce negative spacing from a right-to-left system titlebar.
    close.setFrameOrigin(NSPoint(x: 80, y: close.frame.origin.y))
    minimize.setFrameOrigin(NSPoint(x: 60, y: minimize.frame.origin.y))
    zoom.setFrameOrigin(NSPoint(x: 40, y: zoom.frame.origin.y))
    let presentation = WorkspaceWindowPresentation(window: workspace, rightToLeft: false)
    check(close.frame.minX == 16 && minimize.frame.minX == 36 && zoom.frame.minX == 56,
      "Real window controls stay visible on a right-to-left host")
    check(workspace.standardWindowButton(.closeButton) === close,
      "Retain AppKit's actual window buttons")
    workspace.setContentSize(NSSize(width: 640, height: 540))
    presentation.layout()
    check(close.frame.minX == 16 && zoom.frame.minX == 56, "Resize retains the inset")
    check(workspace.titleVisibility == .hidden && workspace.toolbar == nil,
      "Window controls are inset into the app header without a second toolbar")
    let rtlPresentation = WorkspaceWindowPresentation(window: workspace, rightToLeft: true)
    check(close.frame.maxX == close.superview!.bounds.width - 16,
      "A right-to-left host keeps the close control on its native side")
    check(minimize.frame.maxX == close.frame.maxX - 20 && zoom.frame.maxX == close.frame.maxX - 40,
      "Right-to-left window controls keep standard ordering and spacing")
    workspace.setContentSize(NSSize(width: 900, height: 600))
    rtlPresentation.layout()
    check(close.frame.maxX == close.superview!.bounds.width - 16,
      "Right-to-left resizing keeps controls inside the header")
    let rect = close.convert(close.bounds, to: workspace.contentView)
    check(rect.minX >= 0 && rect.maxX <= workspace.contentView!.bounds.width,
      "Controls remain inside the content width rather than only their local frame")
    let topInset = workspace.contentView!.bounds.height - rect.midY
    check(abs(topInset - 24) < 0.5, "Window controls align with the center of the 48-point app header")
    let systemPresentation = WorkspaceWindowPresentation(window: workspace)
    let expectedRTL = Locale.Language(identifier: Locale.preferredLanguages.first ?? "en").characterDirection == .rightToLeft
    check(systemPresentation.rightToLeft == expectedRTL,
      "Use system language direction even when the application bundle is English")
    let originalBehavior = workspace.collectionBehavior
    let monitor = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered, defer: false)
    monitor.isReleasedWhenClosed = false
    configureMonitorPresentation(monitor)
    check(monitor.collectionBehavior.contains(.fullScreenAuxiliary), "Monitor can join a fullscreen Space")
    check(monitor.collectionBehavior.contains(.canJoinAllApplications), "Monitor can join another application's fullscreen Space")
    check(monitor.collectionBehavior.contains(.canJoinAllSpaces), "Monitor is available in the current Space")
    check(!monitor.collectionBehavior.contains(.fullScreenPrimary), "Monitor never becomes the primary fullscreen window")
    check(workspace.collectionBehavior == originalBehavior, "The main workspace keeps ordinary Space behavior")
    configureMonitorPresentation(monitor)
    check(workspace.collectionBehavior == originalBehavior, "Repeated presentation never reconfigures the main workspace")
    for rightToLeft in [false, true] {
      let fixture = PresentationFixture(contentRect: NSRect(x: 0, y: 0, width: 640, height: 540),
        styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
        backing: .buffered, defer: false)
      fixture.isReleasedWhenClosed = false
      var changes: [(Bool, Bool)] = []
      let controller = WorkspaceWindowPresentation(window: fixture, rightToLeft: rightToLeft) {
        changes.append(($0, $1))
      }
      check(changes.count == 1 && changes[0].0 == rightToLeft && !changes[0].1,
        "Initial state contains the system control side and actual fullscreen state")
      fixture.setContentSize(NSSize(width: 1400, height: 900))
      controller.layout()
      check(changes.count == 1, "A large ordinary window retains its window-control inset")
      func notify(_ name: Notification.Name) async {
        NotificationCenter.default.post(name: name, object: fixture)
        // The observer queues layout on the main dispatch queue. Wait behind
        // that work instead of assuming a runner drains it within 20 ms.
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
          DispatchQueue.main.async { continuation.resume() }
        }
      }
      for _ in 0..<3 {
        let before = changes.count
        fixture.reportedFullscreen = true
        await notify(NSWindow.didEnterFullScreenNotification)
        check(changes.count == before + 1 && changes.last!.1,
          "Fullscreen entry releases the inset on either control side")
        await notify(NSWindow.didUpdateNotification)
        await notify(NSWindow.didResizeNotification)
        check(changes.count == before + 1, "Repeated native layout events do not restart the transition")
        fixture.reportedFullscreen = false
        await notify(NSWindow.didExitFullScreenNotification)
        let button = fixture.standardWindowButton(.closeButton)!
        let inset = rightToLeft ? button.superview!.bounds.width - button.frame.maxX : button.frame.minX
        check(changes.count == before + 2 && !changes.last!.1 && inset == 16,
          "Fullscreen exit restores the inset and real buttons on the correct side")
      }
      fixture.reportedFullscreen = true
      var restoredFullscreen = false
      let restored = WorkspaceWindowPresentation(window: fixture, rightToLeft: rightToLeft) {
        restoredFullscreen = $1
      }
      check(restoredFullscreen, "A workspace restored directly into fullscreen starts without the inset")
      withExtendedLifetime((controller, restored)) {}
    }
    print("Native window presentation: \(checks) checks passed")
  }
}
