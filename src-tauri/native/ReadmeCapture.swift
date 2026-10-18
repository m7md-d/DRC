import AppKit
import WebKit

// Capture only this application's own rendered WKWebView. No screen recording,
// Accessibility automation, synthetic UI or external application is involved.
@MainActor @_cdecl("drc_readme_snapshot") public func readmeSnapshot(
  _ pointer: UnsafeMutableRawPointer, _ path: UnsafePointer<CChar>,
  _ context: UnsafeMutableRawPointer,
  _ callback: @escaping @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer) -> Void
) {
  let destination = String(cString: path)
  let window = Unmanaged<NSWindow>.fromOpaque(pointer).takeUnretainedValue()
  func webview(_ view: NSView) -> WKWebView? {
    if let web = view as? WKWebView { return web }
    return view.subviews.lazy.compactMap { webview($0) }.first
  }
  func finish(_ message: String?) {
    if let message { message.withCString { callback($0, context) } }
    else { callback(nil, context) }
  }
  guard let content = window.contentView, let web = webview(content) else {
    finish("The workspace webview is not available."); return
  }
  let configuration = WKSnapshotConfiguration()
  configuration.afterScreenUpdates = true
  // Capture the visible view without a crop: WebKit may offset cropped snapshots
  // after focus moves between independently scrolling workspaces.
  web.takeSnapshot(with: configuration) { image, error in
    guard let image else { finish(error?.localizedDescription ?? "The workspace snapshot is empty."); return }
    // Window controls are native views above the webview. Composite their actual
    // rendered views, rather than drawing imitation traffic lights.
    let rendered = NSImage(size: image.size, flipped: false) { bounds in
      image.draw(in: bounds)
      for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
        guard let button = window.standardWindowButton(kind), !button.isHidden,
          let bitmap = button.bitmapImageRepForCachingDisplay(in: button.bounds) else { continue }
        button.cacheDisplay(in: button.bounds, to: bitmap)
        let frame = web.convert(button.bounds, from: button)
        let destination = NSRect(x: frame.minX, y: web.isFlipped ? bounds.height - frame.maxY : frame.minY,
          width: frame.width, height: frame.height)
        guard bounds.contains(destination) else { continue }
        let control = NSImage(size: button.bounds.size)
        control.addRepresentation(bitmap)
        control.draw(in: destination)
      }
      return true
    }
    guard let tiff = rendered.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
      finish("The workspace snapshot could not be encoded as PNG."); return
    }
    do { try png.write(to: URL(fileURLWithPath: destination), options: .atomic); finish(nil) }
    catch { finish(error.localizedDescription) }
  }
}
