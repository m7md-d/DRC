# DRC interface audit — 0.5

Design baseline: 17 October 2026. This is an implementation record, not the deferred user manual.

## Product and brand interpretation

DRC is a work tool for inspecting storage, acquiring images and inspecting evidence. Visible copy names the object, operation, observation or failure. No slogans, welcome campaigns, artificial health scores or decorative terminal language.

The owner's [brand system](../BRAND-SYSTEM.md) specifies structural identity at L1, with L2 only where technical evidence benefits. Its typography choices are adaptable. The implementation therefore uses the platform UI font for navigation and prose, JetBrains Mono for paths and exact machine values, quiet neutral surfaces, restrained state colors and inspectable original output. Recovery policy and exact source identity remain operational information rather than decoration.

## Audit and resulting structure

| Area | Previous problem | Implemented treatment |
| --- | --- | --- |
| Window | A near-screen-sized default, plus oversized custom header | 1180 × 780 default; real macOS window controls inset into the existing 48-point app header; no separate title strip |
| Global navigation | Unrelated tools crowded into one toolbar | Devices and workspace tools in one leading sidebar; primary checks and refresh in toolbar |
| Sidebar | Large device tiles, repeated protocol text and ornamental footer | Compact source rows; short section names; connection watch and scope in quiet footer; hide/show control |
| Easy overview | Marketing headline, decorative ring and giant action cards | Actual device name and capacity, four aligned readings, actionable task rows, connection inspector |
| Professional overview | Oversized heading, card-like readings with weak hierarchy | Compact source identity, tab navigation, aligned facts and grouped property tables |
| Recovery | Scrolling setup column and a long wall of repeated step paragraphs | Source strip, disclosed configuration/optional routes, progress, selectable check list and separate result inspector; fixed actions |
| Unavailable storage | Large heading and four large cards that resembled a diagnosis | Compact, separate enumeration stages; explicit observed limitation; original registry evidence retained |
| Acquisition | Long form competed with long job history | Two independently scrollable panes, consistent form scale, aligned source/destination review; stacks when narrow |
| Image workspace | Large fields and unclear boundaries between setup and browser | Setup/browser split; compact controls and striped tables; full-width reflow on narrow windows |
| Command reference | Large article cards and oversized category controls | Category list, search/OS controls and compact command/flag cards; scrolling confined to each pane |
| Sessions | Repeated oversized rows | Dense saved-record list with import/export operations at a shared control scale |
| Port map | Nested card-heavy readings | Outline with indentation and real disclosure state, selected-node inspector, property rows and optional raw properties |
| SMART / host evidence | Important result competed with raw fields | Action + report status first; original grouped fields and command records below |
| Field tables | All groups expanded into a wall; very small headings | Initial core groups, explicit Expand all/Collapse all, search reveals matches, flat original paths always available |
| Output dock | Heavy chrome and a tall footprint in every context | Compact 32-point header; expandable original output; command/event streams and complete-copy behavior preserved |
| Controls | Mixed form geometry and inconsistent selection treatment | One button, checkbox, search, popup, segmented-control, focus and disclosure vocabulary |
| Tooltips | Generic repeated text attached to arbitrary headings | Task-specific help and precise field-path explanation; exact byte values retained on hover/focus |
| macOS menu monitor | Already native SwiftUI/AppKit, with resident sampling | Retained native controls and compact popover; continuity tests protect history across repeated opening |

## Interaction architecture

- Long-running tools are nonmodal workspace pages. They do not obscure the source list or original-output dock. Opening another tool replaces the visible page; only one page is mounted at a time.
- Returning to a source preserves backend recovery runs, acquisitions, extraction jobs and saved command records. Source handles and plans retain their existing backend identity checks.
- Closing an acquisition review invalidates its prepared ticket through the existing cleanup. Leaving the image workspace closes its reader through the existing cleanup.
- Read-only policy remains a focused modal explanation. File and destination selection continues to use native system pickers.
- Recovery checks and imaging remain distinct. Passing a sample does not claim that the disk has been imaged or fully tested. Unexecuted prerequisites do not count as completed progress.
- Optional exclusive USB/SCSI access and reconnection remain off by default, disclosed and explicitly enabled. The redesign does not change the recovery backend or safety policy.
- Exact failures, scope, original evidence and command links remain available per selected check. The stop summary states the observed limit rather than inventing a hardware cause.

## Component scale

These values are DRC implementation decisions, not claims of Apple-mandated pixel measurements.

- UI body: 13; controls: 12; compact supporting labels: 10–11; page titles: 18–20.
- Raw field values: 11 mono, with selectable text and wrapping for long identifiers.
- Buttons and popups: 28–29 minimum height; checkboxes: 14; restrained 5–8 corner radii.
- Main content inset: 22 wide / 16 compact; related items share alignment and 6–14 spacing.
- Sidebar: 224 wide, independently scrollable; toolbar: 48; path strip: 30; output header: 32.
- Selection has a filled background and control state; errors retain icon, text and code rather than color alone.
- Charts retain their original domains and units. Layout changes never invent samples, fill unknown gaps or convert a reported capacity into a verified capacity.

## Adaptation and accessibility

The workspace uses container-based reflow. Its overview inspector moves below task rows, readings change from four to two columns, controls move below their related descriptions, and the port inspector stacks below the tree. Below 900 window width the source sidebar is a dismissible overlay; opening a tool returns its width to content. It remains explicitly available from the toolbar and Command/Control–backslash.

Tool pages fill the content region instead of maintaining a large fixed dialog canvas. Forms and results stack at narrow widths. Recovery keeps the compact checks list adjacent to its result inspector, with separate scrolling and stable footer actions. Tables that require comparison retain horizontal scrolling rather than cutting fields out.

Buttons, popups, disclosures and source selection are keyboard reachable. Help works on hover and keyboard focus. Popup Escape consumes the event before the workspace handles it. The policy dialog retains its focus trap; nonmodal workspaces do not trap focus. Reduced-motion preference disables ornamental transitions. No fake macOS traffic lights are drawn.

## Platform implementation boundary

The main desktop workspace remains the existing Tauri/WKWebView application on macOS and the existing Tauri desktop runtime on Linux. This redesign follows macOS utility interaction patterns; it does not claim that HTML controls are AppKit controls. Window controls, menu integration and file pickers remain native. On macOS, the transparent overlay titlebar places the actual AppKit close/minimize/fullscreen buttons inside the shared app header. A small AppKit presentation controller keeps their inset stable on right-to-left hosts and after resizing or fullscreen transitions. The control side follows the user’s preferred macOS language rather than the English bundle’s layout direction; the workspace reserves the matching side. Interactive toolbar controls remain in the workspace; empty header regions support native dragging and double-click zoom. The menu-bar monitor remains implemented in SwiftUI/AppKit. Maintaining the shared workspace preserves Linux feature parity.

The reference system follows the available macOS 15 host conventions. Newer HIG material guidance does not justify simulating unsupported Liquid Glass across the app.

## Primary design references

Reviewed official Apple guidance, with decisions adapted to this task and the existing platform boundary:

- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos): comfortable density, resizable windows and precise keyboard/pointer input.
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): alignment, grouping, importance and adaptive disclosure.
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): readable hierarchy and system typography.
- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars): shallow hierarchy, concise groups and hide/show affordance.
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): prioritize content-relevant actions and reduce clutter.
- [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets): keep extended workflows in workspace views; reserve modality for focused decisions.
- [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls): put advanced information behind descriptive, stateful disclosure.

## Validation record

- TypeScript and production frontend build: passed.
- Frontend regression checks after workspace conversion: 24 passed.
- Native model checks: 27 passed; continuity checks: 8 passed; native window presentation: 16 passed, including a right-to-left layout fixture. Sampling remains resident across popover openings.
- Desktop visual review: verified the 1180 × 780 workspace and approximately 709 × 859 portrait window, including automatic sidebar adaptation, reference navigation and grouped-field filtering. The recovery report was also verified with the output dock expanded: its summary and footer actions remain visible, and original command output opens alongside the selected result. The configured 640 × 540 minimum was not separately pixel-reviewed.

Color checks on the implemented sRGB palette: primary text 15.25:1; supporting text 8.59:1; primary action text 5.33:1; error text 5.85:1; selected text 8.06:1. These pair checks do not constitute a whole-app accessibility certification.

Recovery configuration is initially disclosed for a new run and collapsed when a saved result is present. Its summary always names the next target. A raw-command link expands the output dock without dismissing the current check report. Identical step/issue detail is presented once.

Window chrome verification: the Arabic macOS host reserves the right side for the real window buttons, with no unused left inset. Entering and leaving fullscreen was checked in the packaged app; the buttons return aligned with the center of the existing header. Header double-click zoom was also verified. The separate monitor change removes primary-app activation and sets fullscreen auxiliary behavior; its presentation flags and history continuity are covered by native checks. A direct status-item click over another application’s fullscreen Space was not completed through the available UI automation.

The fullscreen window-control inset and its transition are fixed; implementation and validation details are tracked as UI-001 in [Known interface issues](KNOWN-ISSUES.md).

Functional state colors use saturated green, cyan, amber and red on neutral surfaces. The active connection switch is #30D158; checked inputs use #299DF5 with a dark checkmark (6.02:1). Policy text contrasts 7.70:1 on its background.
