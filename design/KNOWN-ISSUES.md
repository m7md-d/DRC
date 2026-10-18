# Known interface issues

## UI-001 · Reclaim the window-control inset in fullscreen

- Status: fixed and checked in the packaged macOS app, 17 October 2026.
- Observed: after entering macOS fullscreen, the workspace toolbar still reserves space for the three window buttons, leaving a visible gap at the edge. On the owner's Arabic macOS host, this is the right edge.
- Expected: when macOS hides the window buttons in fullscreen, the toolbar controls should smoothly move into the released space. Restore the correct inset when leaving fullscreen. Keep the English workspace layout and follow the system's window-control side.
- Acceptance: test entering/exiting fullscreen repeatedly, both left/right control sides, narrow/wide windows, and unchanged button hit targets. Respect Reduce Motion by updating without the transition. Normal window zoom that keeps the traffic lights visible must retain their inset.
- Scope: layout and animation only; no storage operation or source policy changes.
- Fix: AppKit publishes the actual fullscreen state and the system's window-control side. The toolbar changes its reserved inset from 88 to 12 points with a 220 ms transition, then restores it on exit. Repeated native layout events do not restart the transition. The existing Reduce Motion rule disables this animation.
- Verification: two live fullscreen enter/exit cycles, including entry from an ordinarily zoomed window; correct right-side restoration on the Arabic macOS host; the moved policy button remained clickable. Forty native presentation checks cover both control sides, small/large ordinary windows, repeated transitions and startup already in fullscreen. Reduce Motion was checked in the stylesheet; the owner's system preference was not changed.

Reproduction captures are kept locally and are excluded from public assets.
