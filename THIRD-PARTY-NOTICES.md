# Third-party notices

## GNU ddrescue

GNU ddrescue 1.30, Copyright (C) 2004–2026 Antonio Diaz Diaz. Licensed under GNU GPL version 2 or later. Source: https://ftp.gnu.org/gnu/ddrescue/ddrescue-1.30.tar.lz

The bundled tool includes a DRC modification dated 18 October 2026: rescue input paths of the form `/dev/fd/N` duplicate an inherited read-only descriptor instead of reopening it. Writable inputs are reopened read-only and checked against the original file identity; the copy stops with the original OS error if that fails. Incompatible open flags are rejected. The original source archive, exact patch, license and build instructions are included in `Contents/Resources/GNUddrescue` on macOS and `/usr/share/doc/drc` on Linux.


## macmon telemetry research and adapted ABI definitions

Reference: https://github.com/vladkens/macmon/tree/v0.7.2/src

MIT License

Copyright (c) 2024 vladkens

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
