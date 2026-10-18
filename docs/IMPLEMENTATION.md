# Implementation notes

The current feature and installation summary is in [README](../README.md) and [Linux installation](LINUX-INSTALL.md). Easy and Professional share the same sessions and native source protections. Linux uses its own metadata/backing/connection adapter and may obtain a read-only exclusive descriptor through UDisks2. Physical Linux authorization and device exclusion remain unvalidated on hardware; file-image acquisition/extraction use the same tested core. The following earlier implementation notes describe their dated stages and are not a current capability checklist.

# DRC 0.1 implementation

The user is here to inspect connected storage, see every reported field and run explicitly selected queries from a standalone desktop application.

## Interface

The current [interface design](DESIGN.md) uses compact controls, system typography and monospace for technical values. Displayed readings and progress must come from reported data.

Interface copy is English. Localized names and string values reported by macOS are retained unchanged as source data.

## Boundaries

`src-tauri/src/query.rs` defines the complete executable query allowlist. IPC commands do not accept shell text, arbitrary program paths, free-form options or writing operations. The normal user process executes metadata commands without sudo or a privileged helper.

Physical macOS imaging separately requests native administrator authorization when opening the selected raw source is denied. A one-shot broker mode opens only a reviewed external whole disk with `O_RDONLY`, passes that descriptor over a private Unix socket and waits for the app's acknowledgement before exiting. It rechecks the IOMedia registry ID, capacity, device-node identity and mount state. The app verifies the root peer, request nonce, returned descriptor and current medium; the copy process stays unprivileged. The broker cannot open destinations or change device permissions. Cancellation and original authorization output remain visible.

The bundled GNU ddrescue 1.30 has one input-handling modification: `/dev/fd/N` rescue sources duplicate an inherited `O_RDONLY` handle. This avoids reopening a protected device node after authorization. Writable handles are reopened read-only and their file/device identity is checked before use; a denied reopen retains its OS error. The macOS receiver applies the same normalization. No writable descriptor is used for copying, and incompatible flags are refused. The source archive, patch and build instructions ship with each desktop package.

During imaging, a missing or changed source requests SIGINT so ddrescue can save its map. Kernel I/O may delay exit. Resume preserves the original image/map pair and range. A changed source descriptor requires comparison and a separate typed confirmation; conflicting recorded identifiers, capacity or sector size are rejected. Each new attempt records its actual source descriptor without replacing the original source record.

`PlatformBackend` supplies device metadata, SMART and connection reports. `contracts.rs` keeps filesystem-reader operations separate from platform access and raw block sources. It does not pretend that an unimplemented filesystem backend is available.

The desktop frontend consumes native IPC and events. The browser preview is explicitly disconnected and never supplies fake media. Production packaging embeds the built assets and requires no HTTP server.

## Data preservation

- Plist integer values and parsed JSON numbers are transmitted as exact decimal strings to avoid JavaScript rounding. Raw outputs preserve their original encoding.
- Every stdout/stderr stream is retained both as display text and base64 of the original bytes. Invalid UTF-8 is flagged.
- Unknown/vendor fields and empty arrays/objects survive parsing and remain in the complete field table.
- All filters are explicit and display the filtered count. No hidden classifier or health score is computed.
- smartctl's exit bitmask is displayed separately from its full JSON. An error flag does not discard valid data.
- Terminal controls are rendered inert; the original stream remains in session export. No shell or clipboard escape sequences execute from tool output.

## Connection handling

`diskutil activity` is a read-only Disk Arbitration event subscriber. A debounced event triggers a fresh metadata snapshot, not a sector scan. Queries are serialized; a pending refresh runs when a current query ends. The child event process is stopped when the application exits or the user disables watching.

Device selection survives a refresh only when its reported descriptor matches. A disappearing/replaced device clears the selection. SMART rechecks the descriptor before executing and refuses expired session tokens. This does not establish a forensic hardware identity or eliminate every transport race.

## Scope of verification

Unit checks cover metadata preservation, exact large counters, unknown fields, zero versus missing, SMART bitmasks, hostile device identifiers, fixed read-information flags, changed descriptors and inert terminal control sequences. Real-device validation is restricted to metadata queries and host connection reports.

No write testing is performed on the user's drives. Raw acquisition, filesystem readers and persistent case storage require their own later implementation and acceptance checks.
