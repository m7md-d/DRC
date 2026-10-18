"""Actual GNU ddrescue with generated regular-file read faults; no devices passed."""
import base64, hashlib, json, os, pathlib, selectors, signal, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[2]
arch = "aarch64" if os.uname().machine == "aarch64" else "x86_64"
program = root / "src-tauri/binaries" / f"drc-ddrescue-{arch}-unknown-linux-gnu"
assert subprocess.check_output([program, "--version"]).splitlines()[0] == b"GNU ddrescue 1.30"
def unprivileged_fixture_user():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
subprocess.run(["python3", str(root / "scripts/tests/inherited-source.py"), str(program)], check=True, preexec_fn=unprivileged_fixture_user if os.geteuid() == 0 else None)
results = []

def capture(child):
    # Use the same fixed GNU 1.30 abort prompt as the native adapter. EOF on
    # stdin can spin in the tool's map-save prompt, so retain a pipe and only
    # send q+Enter when that exact prompt is actually observed on stderr.
    prompt=b"or Q+ENTER to abort.\n"
    streams={"stdout":bytearray(),"stderr":bytearray()}
    tail=b""; supplied=b""; deadline=time.monotonic()+20
    with selectors.DefaultSelector() as ready:
        for name in streams:
            file=getattr(child,name); os.set_blocking(file.fileno(),False)
            ready.register(file,selectors.EVENT_READ,name)
        while ready.get_map():
            if time.monotonic()>deadline:
                child.kill(); child.wait(timeout=5)
                raise TimeoutError("Generated-file fault did not exit within 20s")
            for key,_ in ready.select(0.05):
                try: chunk=os.read(key.fileobj.fileno(),8192)
                except BlockingIOError: continue
                if not chunk:
                    ready.unregister(key.fileobj); key.fileobj.close(); continue
                streams[key.data].extend(chunk)
                if key.data=="stderr":
                    combined=tail+chunk
                    for _ in range(combined.count(prompt)):
                        child.stdin.write(b"q\n"); child.stdin.flush(); supplied+=b"q\n"
                    tail=combined[-(len(prompt)-1):]
    child.wait(timeout=5); child.stdin.close()
    return bytes(streams['stdout']),bytes(streams['stderr']),supplied

with tempfile.TemporaryDirectory(prefix="drc-linux-faults-") as folder:
    temp = pathlib.Path(folder)
    library = temp / "read-faults.so"
    subprocess.run(["cc", "-std=c11", "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", str(root / "scripts/linux/read-faults.c"), "-ldl", "-o", str(library)], check=True)
    source = temp / "source.img"
    payload = b"".join(hashlib.sha256(i.to_bytes(8, "little")).digest() for i in range(32768))
    source.write_bytes(payload); source.chmod(0o444)
    checksum = hashlib.sha256(payload).hexdigest()
    for mode in ("short", "enodev", "enxio", "eio", "eof", "eintr", "delayed", "output-enospc", "output-eio", "map-enospc", "small-requests", "4kn"):
        work = temp / mode; work.mkdir()
        if mode == "map-enospc": (work / "rescue.map").write_text("0 ? 1\n0 1048576 ?\n")
        with source.open("rb") as opened, (work / "image.raw").open("w+b") as output:
            env = dict(os.environ, LC_ALL="C", LD_PRELOAD=str(library), DRC_TEST_SOURCE_FD=str(opened.fileno()), DRC_TEST_DESTINATION_FD=str(output.fileno()), DRC_TEST_FAULT=mode, DRC_TEST_WORK_DIRECTORY=str(work))
            args = [str(program), "--no-trim", "--no-sweep", "--no-scrape", "--retry-passes=0", "--max-read-errors=1", "--size=1048576", "--timeout=1s", "--synchronous", "--extend-outfile=1048576", "--log-rates=rates.log", "--", f"/dev/fd/{opened.fileno()}", "image.raw", "rescue.map"]
            if mode in ("small-requests", "4kn"):
                args[1:1] = ["--cluster-size=1", f"--sector-size={4096 if mode == '4kn' else 512}"]
            start = time.monotonic()
            child = subprocess.Popen(args, cwd=work, env=env, pass_fds=(opened.fileno(),output.fileno()), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if mode == "delayed": time.sleep(0.2); child.send_signal(signal.SIGINT)
            stdout, stderr, supplied = capture(child)
            elapsed = time.monotonic() - start
        current_map = (work / "rescue.map").is_file()
        map_candidate = work / ("rescue.map" if current_map else "rescue.map.bak")
        original_map = map_candidate.read_text()
        rows = []
        for line in original_map.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[2] in ("+", "?", "*", "/", "-"):
                rows.append((int(parts[0], 0), int(parts[1], 0), parts[2]))
        finished = sum(size for _, size, status in rows if status == "+")
        covered = sum(size for _, size, _ in rows)
        assert rows and covered <= len(payload)
        unmapped = len(payload) - covered
        if mode == "eof": assert unmapped > 0 and finished < len(payload)
        else: assert unmapped == 0
        image = (work / "image.raw").read_bytes()
        for position, size, status in rows:
            if status == "+": assert image[position:position+size] == payload[position:position+size]
        if mode in ("enodev", "enxio", "eio", "output-enospc", "output-eio", "map-enospc"): assert child.returncode != 0 and finished < len(payload)
        if mode == "map-enospc": assert finished == 0 and b"No space left on device" in stderr and supplied
        else: assert not supplied and current_map
        if mode == "delayed": assert finished < len(payload) and elapsed >= 1.0
        # Resume the same image/map through reverse reading after the fault is removed.
        if current_map:
            with source.open("rb") as opened:
                args = [str(program), "--reverse", "--size=1048576", "--retry-passes=1", "--timeout=2s", "--synchronous", "--extend-outfile=1048576", "--", f"/dev/fd/{opened.fileno()}", "image.raw", "rescue.map"]
                resumed = subprocess.run(args, cwd=work, pass_fds=(opened.fileno(),), capture_output=True, timeout=30)
            assert resumed.returncode == 0
        assert (work / "image.raw").read_bytes() == payload
        assert hashlib.sha256(source.read_bytes()).hexdigest() == checksum
        results.append({"scenario": mode, "firstExit": child.returncode, "firstFinishedBytes": finished, "unmappedBytes": unmapped, "elapsedSeconds": round(elapsed, 3), "reverseResume": "byte-exact" if current_map else "blocked-no-current-map", "currentMapAvailable": current_map, "observedMapPath": map_candidate.name, "stdinSupplied": supplied.decode(), "sourceUnchanged": True, "stdoutBytes": len(stdout), "stderrBytes": len(stderr), "stdoutBase64": base64.b64encode(stdout).decode(), "stderrBase64": base64.b64encode(stderr).decode(), "firstMap": original_map, "sourceSha256": checksum, "finalImageSha256": hashlib.sha256((work / "image.raw").read_bytes()).hexdigest()})
output = {"scope": "GNU ddrescue 1.30 on Linux; userspace read/write-fault injection on generated regular files. Not physical SSD, electrical, controller firmware, or real blocked kernel I/O validation.", "results": results}
print(json.dumps({"scope":output['scope'],"results":[{k:v for k,v in r.items() if k not in ('stdoutBase64','stderrBase64','firstMap')} for r in results]}, indent=2))
(root / ".cache/linux-fault-results.json").write_text(json.dumps(output, indent=2))
