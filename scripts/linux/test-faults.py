"""Actual GNU ddrescue with generated regular-file read faults; no devices passed."""
import base64, hashlib, json, os, pathlib, signal, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[2]
arch = "aarch64" if os.uname().machine == "aarch64" else "x86_64"
program = root / "src-tauri/binaries" / f"drc-ddrescue-{arch}-unknown-linux-gnu"
assert subprocess.check_output([program, "--version"]).splitlines()[0] == b"GNU ddrescue 1.30"
results = []
with tempfile.TemporaryDirectory(prefix="drc-linux-faults-") as folder:
    temp = pathlib.Path(folder)
    library = temp / "read-faults.so"
    subprocess.run(["cc", "-std=c11", "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", str(root / "scripts/linux/read-faults.c"), "-ldl", "-o", str(library)], check=True)
    source = temp / "source.img"
    payload = b"".join(hashlib.sha256(i.to_bytes(8, "little")).digest() for i in range(32768))
    source.write_bytes(payload); source.chmod(0o444)
    checksum = hashlib.sha256(payload).hexdigest()
    for mode in ("short", "enodev", "delayed"):
        work = temp / mode; work.mkdir()
        with source.open("rb") as opened:
            env = dict(os.environ, LD_PRELOAD=str(library), DRC_TEST_SOURCE_FD=str(opened.fileno()), DRC_TEST_FAULT=mode)
            args = [str(program), "--no-trim", "--no-sweep", "--no-scrape", "--retry-passes=0", "--timeout=1s", "--synchronous", "--extend-outfile=1048576", "--log-rates=rates.log", "--", f"/dev/fd/{opened.fileno()}", "image.raw", "rescue.map"]
            start = time.monotonic()
            child = subprocess.Popen(args, cwd=work, env=env, pass_fds=(opened.fileno(),), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if mode == "delayed": time.sleep(0.2); child.send_signal(signal.SIGINT)
            stdout, stderr = child.communicate(timeout=20)
            elapsed = time.monotonic() - start
        original_map = (work / "rescue.map").read_text()
        rows = []
        for line in original_map.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[2] in ("+", "?", "*", "/", "-"):
                rows.append((int(parts[0], 0), int(parts[1], 0), parts[2]))
        finished = sum(size for _, size, status in rows if status == "+")
        assert rows and sum(size for _, size, _ in rows) == len(payload)
        image = (work / "image.raw").read_bytes()
        for position, size, status in rows:
            if status == "+": assert image[position:position+size] == payload[position:position+size]
        if mode == "enodev": assert finished < len(payload)
        if mode == "delayed": assert finished < len(payload) and elapsed >= 1.0
        # Resume the same image/map through reverse reading after the fault is removed.
        with source.open("rb") as opened:
            args = [str(program), "--reverse", "--retry-passes=1", "--timeout=2s", "--synchronous", "--extend-outfile=1048576", "--", f"/dev/fd/{opened.fileno()}", "image.raw", "rescue.map"]
            resumed = subprocess.run(args, cwd=work, pass_fds=(opened.fileno(),), capture_output=True, timeout=30)
        assert resumed.returncode == 0
        assert (work / "image.raw").read_bytes() == payload
        assert hashlib.sha256(source.read_bytes()).hexdigest() == checksum
        results.append({"scenario": mode, "firstExit": child.returncode, "firstFinishedBytes": finished, "elapsedSeconds": round(elapsed, 3), "reverseResume": "byte-exact", "sourceUnchanged": True, "stdoutBytes": len(stdout), "stderrBytes": len(stderr), "stdoutBase64": base64.b64encode(stdout).decode(), "stderrBase64": base64.b64encode(stderr).decode(), "firstMap": original_map, "sourceSha256": checksum, "finalImageSha256": hashlib.sha256((work / "image.raw").read_bytes()).hexdigest()})
output = {"scope": "GNU ddrescue 1.30 on Linux; userspace read-fault injection on generated regular files. Not physical SSD, electrical, controller firmware, or real blocked kernel I/O validation.", "results": results}
print(json.dumps(output, indent=2))
(root / ".cache/linux-fault-results.json").write_text(json.dumps(output, indent=2))
