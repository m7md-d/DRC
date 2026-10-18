"""Read-only inherited-input regression using generated files, no devices."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile

program = str(Path(sys.argv[1]).resolve())
assert os.geteuid() != 0, "Run this permission regression as a non-root user."
with tempfile.TemporaryDirectory(prefix="drc-fd-input-") as directory:
    folder = Path(directory)
    source = folder / "generated.bin"
    data = bytes(range(251)) * 4096
    source.write_bytes(data)
    original_hash = hashlib.sha256(data).hexdigest()
    descriptor = os.open(source, os.O_RDONLY)
    source.chmod(0)
    try:
        try:
            reopened = os.open(source, os.O_RDONLY)
        except PermissionError:
            pass
        else:
            os.close(reopened)
            raise AssertionError("Fixture unexpectedly permits reopening the source")
        result = subprocess.run(
            [program, "--quiet", f"--size={len(data)}", "--", f"/dev/fd/{descriptor}", str(folder / "image.raw"), str(folder / "rescue.map")],
            pass_fds=(descriptor,), capture_output=True, check=False,
        )
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        assert (folder / "image.raw").read_bytes() == data
    finally:
        os.close(descriptor)
        source.chmod(0o600)
    # A writable capability is reopened as read-only and bound to the same
    # object. The copy tool drops its inherited writable descriptor.
    descriptor = os.open(source, os.O_RDWR)
    try:
        result = subprocess.run(
            [program, "--quiet", "--", f"/dev/fd/{descriptor}", str(folder / "normalized.raw"), str(folder / "normalized.map")],
            pass_fds=(descriptor,), capture_output=True, check=False,
        )
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        assert (folder / "normalized.raw").read_bytes() == data
    finally:
        os.close(descriptor)
    # If the OS denies the read-only reopen, do not silently use the writable
    # handle. The exact failure remains visible; no output is created.
    descriptor = os.open(source, os.O_RDWR)
    source.chmod(0)
    try:
        result = subprocess.run(
            [program, "--", f"/dev/fd/{descriptor}", str(folder / "refused.raw"), str(folder / "refused.map")],
            pass_fds=(descriptor,), capture_output=True, check=False,
        )
        assert result.returncode == 1
        assert b"Permission denied" in result.stderr
        assert not (folder / "refused.raw").exists()
    finally:
        os.close(descriptor)
        source.chmod(0o600)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == original_hash
print("Read-only input copied; writable input reopened read-only; denied reopen retained its OS error; source unchanged.")
