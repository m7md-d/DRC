- Added an in-app macOS source-unmount step before creating or resuming a disk image.
- Show mounted volume paths and read-only/read-write status before unmounting.
- Recheck source identity, system backing and destination before opening the read-only source. Keep original unmount errors and output.

macOS archives are ad-hoc signed, not notarized.
