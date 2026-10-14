"""Isolated Linux VM kernel test: ONLY a newly generated read-only loop image."""
import errno, hashlib, json, os, pathlib, subprocess, tempfile
with tempfile.TemporaryDirectory(prefix='drc-exclusive-loop-') as folder:
    root = pathlib.Path(folder); image = root / 'generated.img'; target = root / 'mount'; target.mkdir()
    with image.open('xb') as opened: opened.truncate(16 * 1024 * 1024)
    subprocess.run(['mkfs.ext4', '-q', '-F', '-O', '^has_journal', str(image)], check=True)
    original = hashlib.sha256(image.read_bytes()).hexdigest()
    control = os.open('/dev/loop-control', os.O_RDWR)
    import fcntl
    number = fcntl.ioctl(control, 0x4C82)  # LOOP_CTL_GET_FREE: allocate an unused slot.
    os.close(control)
    node = pathlib.Path(f'/dev/loop{number}')
    if not node.exists(): os.mknod(node, 0o600 | 0o060000, os.makedev(7, number))
    subprocess.run(['losetup', '--read-only', str(node), str(image)], check=True)
    mounted = False; fd = None
    try:
        descriptor = subprocess.check_output(['losetup', '--list', '--json', '--output', 'NAME,BACK-FILE,RO', str(node)])
        bound = json.loads(descriptor)['loopdevices'][0]
        assert pathlib.Path(bound['back-file']) == image
        assert bound['ro'] is True
        fd = os.open(node, os.O_RDONLY | os.O_EXCL | os.O_CLOEXEC | os.O_NONBLOCK)
        assert os.pread(fd, 4096, 1024) == image.read_bytes()[1024:5120]
        try: os.write(fd, b'X'); raise AssertionError('read-only descriptor accepted a write')
        except OSError as error: assert error.errno == errno.EBADF
        attempt = subprocess.run(['mount', '-t', 'ext4', '-o', 'ro,noload', str(node), str(target)], capture_output=True)
        assert attempt.returncode != 0
        os.close(fd); fd = None
        subprocess.run(['mount', '-t', 'ext4', '-o', 'ro,noload', str(node), str(target)], check=True); mounted = True
        try: os.open(node, os.O_RDONLY | os.O_EXCL); raise AssertionError('mounted source acquired exclusively')
        except OSError as error: assert error.errno == errno.EBUSY
        subprocess.run(['umount', str(target)], check=True); mounted = False
        assert hashlib.sha256(image.read_bytes()).hexdigest() == original
        print(json.dumps({'scope':'Linux kernel exclusive/read-only semantics on an OWN generated loop image; no physical disk, UDisks authorization, firmware or real kernel hang tested','mountWhileExclusive':'refused','exclusiveWhileMounted':'EBUSY','readonlyWriteAttempt':'EBADF','sourceUnchanged':True,'sourceSha256':original}, indent=2))
    finally:
        if fd is not None: os.close(fd)
        if mounted: subprocess.run(['umount', str(target)], check=True)
        current = json.loads(subprocess.check_output(['losetup', '--list', '--json', '--output', 'NAME,BACK-FILE,RO', str(node)]))['loopdevices'][0]
        assert pathlib.Path(current['back-file']) == image, 'Loop binding changed; refusing to detach another mapping'
        subprocess.run(['losetup', '--detach', str(node)], check=True)
