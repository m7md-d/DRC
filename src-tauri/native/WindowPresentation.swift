import AppKit

// Only transient monitor windows join other applications' fullscreen Spaces.
// The primary workspace keeps the system's ordinary window/Space behavior.
@MainActor func configureMonitorPresentation(_ window: NSWindow) {
  window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .canJoinAllApplications, .transient, .ignoresCycle]
}

// Preserve the host's native side for window controls, including right-to-left
// systems. The workspace reserves that side without changing its English layout.
// Keep the actual NSButtons and their standard close/minimize/fullscreen actions.
@MainActor final class WorkspaceWindowPresentation {
  private weak var window: NSWindow?
  private var observers: [NSObjectProtocol] = []
  private var applying = false
  private var reportedFullscreen: Bool?
  private let onPresentationChange: (Bool, Bool) -> Void
  let rightToLeft: Bool

  init(window: NSWindow, rightToLeft: Bool? = nil,
       onPresentationChange: @escaping (Bool, Bool) -> Void = { _, _ in }) {
    self.window = window
    self.onPresentationChange = onPresentationChange
    // NSApp reports the bundle's English layout, which can differ from the
    // user's Arabic macOS chrome. Read the user's preferred system language.
    let language = Locale.preferredLanguages.first ?? "en"
    self.rightToLeft = rightToLeft ?? (Locale.Language(identifier: language).characterDirection == .rightToLeft)
    layout()
    for name in [NSWindow.didResizeNotification, NSWindow.didEnterFullScreenNotification,
                 NSWindow.didExitFullScreenNotification,
                 NSWindow.didBecomeKeyNotification, NSWindow.didDeminiaturizeNotification,
                 NSWindow.didUpdateNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: window,
        queue: .main) { [weak self] _ in
          // AppKit restores titlebar geometry during these transitions. Apply
          // the inset after that layout, without replacing Tauri's delegate.
          DispatchQueue.main.async { self?.layout() }
        })
    }
  }

  deinit {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
  }

  func layout() {
    guard !applying, let window else { return }
    // Read AppKit's actual state, including restored fullscreen windows. Window
    // size and ordinary zoom do not tell us whether the titlebar is hidden.
    let fullscreen = window.styleMask.contains(.fullScreen)
    if reportedFullscreen != fullscreen {
      reportedFullscreen = fullscreen
      onPresentationChange(rightToLeft, fullscreen)
    }
    guard !fullscreen,
      let close = window.standardWindowButton(.closeButton),
      let minimize = window.standardWindowButton(.miniaturizeButton),
      let zoom = window.standardWindowButton(.zoomButton),
      let titlebar = close.superview, let container = titlebar.superview else { return }
    applying = true
    defer { applying = false }
    if window.titleVisibility != .hidden { window.titleVisibility = .hidden }
    if !window.titlebarAppearsTransparent { window.titlebarAppearsTransparent = true }
    var frame = container.frame
    frame.size.height = 48
    frame.origin.y = window.frame.height - frame.height
    if container.frame != frame { container.frame = frame }
    for (index, button) in [close, minimize, zoom].enumerated() {
      let offset = 16 + CGFloat(index) * 20
      let x = rightToLeft ? titlebar.bounds.width - offset - button.frame.width : offset
      let position = NSPoint(x: x, y: (titlebar.bounds.height - button.frame.height) / 2)
      let mask: NSView.AutoresizingMask = rightToLeft ? [.minXMargin, .minYMargin] : [.maxXMargin, .minYMargin]
      if button.autoresizingMask != mask { button.autoresizingMask = mask }
      if button.frame.origin != position { button.setFrameOrigin(position) }
    }
  }
}

@MainActor private var workspacePresentation: WorkspaceWindowPresentation?

@MainActor @_cdecl("drc_native_workspace_presentation") public func installWorkspacePresentation(
  _ pointer: UnsafeMutableRawPointer,
  _ callback: @escaping @convention(c) (Int32, Int32) -> Void
) {
  let window = Unmanaged<NSWindow>.fromOpaque(pointer).takeUnretainedValue()
  let presentation = WorkspaceWindowPresentation(window: window) { rightToLeft, fullscreen in
    callback(rightToLeft ? 1 : 0, fullscreen ? 1 : 0)
  }
  workspacePresentation = presentation
}
