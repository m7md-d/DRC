import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { root, currentVersion } from './version.mjs';
import { updateReadme } from './readme.mjs';

if (process.platform !== 'darwin') throw new Error('Native README capture currently runs on macOS.');
if (process.argv.slice(2).some(arg => arg !== '--built')) throw new Error('Usage: npm run screenshots [-- --built]');
if (!process.argv.includes('--built')) execFileSync('npm', ['run', 'desktop:build'], { cwd: root, stdio: 'inherit' });
const bundle = resolve(root, 'DRC.app');
const version = currentVersion();
const bundledVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
if (bundledVersion !== version) throw new Error('Build the current app before taking screenshots.');
const work = mkdtempSync('/private/tmp/DRC-readme-');
const output = join(work, 'frames');
mkdirSync(output);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  execFileSync('python3', ['scripts/make_fat_fixture.py', join(work, 'fixture')], { cwd: root, stdio: 'pipe' });
  const image = join(work, 'fixture/fat16-volume.img');
  const before = hash(image);
  const log = [];
  console.log('Capturing disk overview, generated-image files and Linux command reference.');
  await new Promise((accept, reject) => {
    const child = spawn(join(bundle, 'Contents/MacOS/drc'), [], {
      cwd: root,
      env: { ...process.env, DRC_CAPTURE_DIR: output, DRC_CAPTURE_IMAGE: image, DRC_CAPTURE_STORE: join(work, 'session') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Documentation capture exceeded 150 seconds.')); }, 150_000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.push(data.toString()); if (log.length > 200) log.shift(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', (code, signal) => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`Capture failed (exit ${code}, signal ${signal}): ${log.join('').slice(-5000)}`)); });
  });
  if (hash(image) !== before) throw new Error('The generated source image changed during capture.');
  const entries = [
    ['overview', 'Disk overview', 'Device capacity, connection readings and inspection or imaging controls.'],
    ['image-files', 'Image files', 'Allocated and deleted entries read from a generated FAT16 image through the normal image reader.'],
    ['command-reference', 'Command reference', 'Linux installation commands, tool flags and copyable examples.'],
  ];
  const images = entries.map(([name, title, description]) => {
    const file = `${name}.png`;
    const bytes = readFileSync(join(output, file));
    if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.length < 10_000) throw new Error(`Invalid screenshot: ${file}`);
    return { file, title, description, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: hash(join(output, file)) };
  });
  mkdirSync(resolve(root, 'docs/images'), { recursive: true });
  for (const entry of images) copyFileSync(join(output, entry.file), resolve(root, 'docs/images', entry.file));
  writeFileSync(resolve(root, 'docs/images/manifest.json'), JSON.stringify({ version, source: 'native-desktop', generatedImageUnchanged: true, images }, null, 2) + '\n');
  updateReadme();
  console.log(`Saved ${images.length} native workspace screenshots; generated source unchanged; README updated.`);
} finally { rmSync(work, { recursive: true, force: true }); }
