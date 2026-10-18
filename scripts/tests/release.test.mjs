import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, nextVersion, syncVersion, checkVersion, currentVersion, versionFiles } from '../version.mjs';
import { renderReadme, updateReadme } from '../readme.mjs';
import { publishPrepared, release } from '../release.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'drc-release-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, 'src-tauri'));
  mkdirSync(join(base, 'docs/images'), { recursive: true });
  for (const file of [...versionFiles, 'src-tauri/build.rs']) copyFileSync(join(root, file), join(base, file));
  writeFileSync(join(base, 'docs/README.template.md'), '# DRC {{version}}\n{{projectBadges}}\n{{technologyBadges}}\n{{screenshots}}');
  return base;
}
function screenshots(base, version) {
  const data = Buffer.from('owned test image bytes');
  writeFileSync(join(base, 'docs/images/overview.png'), data);
  writeFileSync(join(base, 'docs/images/manifest.json'), JSON.stringify({ version, source: 'native-desktop', images: [{ file: 'overview.png', title: 'Overview', description: 'Test capture', sha256: createHash('sha256').update(data).digest('hex') }] }));
}
test('bumps exact semantic versions and rejects invalid, equal or lower versions', () => {
  assert.equal(nextVersion('0.5.0', 'patch'), '0.5.1');
  assert.equal(nextVersion('0.5.9', 'minor'), '0.6.0');
  assert.equal(nextVersion('0.5.9', 'major'), '1.0.0');
  assert.equal(nextVersion('0.5.0', '0.8.0'), '0.8.0');
  for (const bad of ['0.5.0', '0.4.9', '01.2.3', '1.2', 'v1.2.3', '1.2.3;echo', '--publish']) assert.throws(() => nextVersion('0.5.0', bad));
});
test('updates all current versions without changing unrelated Cargo package versions', t => {
  const base = fixture(t);
  const original = readFileSync(join(base, 'src-tauri/Cargo.lock'), 'utf8');
  syncVersion('0.6.0', base);
  assert.equal(checkVersion(base, 'v0.6.0'), '0.6.0');
  const updated = readFileSync(join(base, 'src-tauri/Cargo.lock'), 'utf8');
  assert.equal(updated.replace('name = "drc"\nversion = "0.6.0"', `name = "drc"\nversion = "${currentVersion()}"`), original);
  assert.throws(() => checkVersion(base, 'v0.5.0'), /Tag/);
});
test('invalid lockfile aborts before any version file is written', t => {
  const base = fixture(t);
  writeFileSync(join(base, 'src-tauri/Cargo.lock'), '[[package]]\nname = "other"\nversion = "1.0.0"\n');
  assert.throws(() => syncVersion('0.6.0', base), /Expected one/);
  assert.equal(currentVersion(base), currentVersion());
});
test('README rejects old capture versions, changed image bytes and stale text', t => {
  const base = fixture(t);
  const version = currentVersion(base);
  assert.throws(() => renderReadme(base), /screenshots are missing/);
  screenshots(base, '0.0.1');
  assert.throws(() => renderReadme(base), /Capture README/);
  screenshots(base, version);
  updateReadme(base); updateReadme(base, true);
  writeFileSync(join(base, 'README.md'), 'stale');
  assert.throws(() => updateReadme(base, true), /stale/);
  writeFileSync(join(base, 'docs/images/overview.png'), 'changed');
  assert.throws(() => renderReadme(base), /Screenshot changed/);
});
test('dry-run reports a release without changing files or making a tag', t => {
  const base = fixture(t);
  release(['patch', '--dry-run'], base);
  assert.equal(currentVersion(base), currentVersion());
  assert.throws(() => release(['patch', '--publish', '--dry-run'], base), /Usage/);
});
test('standard README badges follow the project version and reject stale text', t => {
  const base = fixture(t);
  const original = currentVersion(base);
  screenshots(base, original);
  updateReadme(base);
  const path = join(base, 'README.md');
  assert(readFileSync(path, 'utf8').includes(`Source v${original}`));
  const next = nextVersion(original, 'patch');
  syncVersion(next, base);
  screenshots(base, next);
  updateReadme(base);
  const svg = readFileSync(path, 'utf8');
  assert(svg.includes(`Source v${next}`));
  assert(!svg.includes(`Source v${original}`));
  assert(svg.includes('macOS') && svg.includes('Linux'));
  updateReadme(base, true);
  writeFileSync(path, svg.replace(`Source v${next}`, `Source v${original}`));
  assert.throws(() => updateReadme(base, true), /README is stale/);
});
test('README badges use locked package versions and actual language settings', t => {
  const base = fixture(t);
  screenshots(base, currentVersion(base));
  updateReadme(base);
  const lockPath = join(base, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/react'].version = '99.1.2';
  writeFileSync(lockPath, JSON.stringify(lock));
  assert.throws(() => updateReadme(base, true), /README is stale/);
  const cargoPath = join(base, 'src-tauri/Cargo.lock');
  writeFileSync(cargoPath, readFileSync(cargoPath, 'utf8').replace(/(name = "tauri"\nversion = ")[^"]+("\n)/, '$19.8.7$2'));
  const buildPath = join(base, 'src-tauri/build.rs');
  writeFileSync(buildPath, readFileSync(buildPath, 'utf8').replace(/("-swift-version",\s*)"5"/, '$1"6"'));
  updateReadme(base);
  const svg = readFileSync(join(base, 'README.md'), 'utf8');
  assert(svg.includes('React 99.1.2'));
  assert(svg.includes('Tauri 9.8.7'));
  assert(svg.includes('SwiftUI Swift 6 mode'));
  assert(svg.includes('Rust edition 2021'));
  assert(svg.includes('License GPL v3'));
  assert(svg.includes('https://img.shields.io/static/v1?'));
  assert(!svg.includes('docs/assets/stack.svg'));
  assert(svg.includes('href="LICENSE"'));
  updateReadme(base, true);
});
test('release commit and annotated tag reach an owned local remote atomically', t => {
  const base = fixture(t);
  const remote = join(base, 'remote.git');
  const repo = join(base, 'repo'); mkdirSync(repo);
  const git = (a, cwd = repo) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', remote], base); git(['init', '-b', 'main']);
  git(['config', 'user.name', 'DRC release test']); git(['config', 'user.email', 'test@localhost']);
  writeFileSync(join(repo, 'version.txt'), '1'); git(['add', 'version.txt']); git(['commit', '-m', 'Initial']);
  git(['remote', 'add', 'origin', remote]); git(['push', '-u', 'origin', 'main']);
  writeFileSync(join(repo, 'version.txt'), '2');
  publishPrepared(repo, '1.0.1', ['version.txt']);
  assert.equal(git(['rev-parse', 'refs/heads/main'], remote), git(['rev-parse', 'v1.0.1^{}'], remote));
  assert.equal(git(['cat-file', '-t', 'v1.0.1'], remote), 'tag');
  assert.equal(git(['status', '--porcelain']), '');
});
test('failed push retains the local release tag and provides a retry command', t => {
  const base = fixture(t);
  const calls = [];
  assert.throws(() => publishPrepared(base, '1.2.3', ['README.md'], (program, args) => {
    calls.push(args);
    if (args[0] === 'symbolic-ref') return 'main\n';
    if (args[0] === 'push') throw new Error('offline');
    return '';
  }), /local commit and tag are retained.*git push/);
  assert(calls.some(a => a[0] === 'tag'));
  assert(!calls.some(a => ['reset', 'revert'].includes(a[0])));
});
test('unrelated staged work prevents the release commit and tag', t => {
  const base = fixture(t);
  const calls = [];
  assert.throws(() => publishPrepared(base, '1.2.3', ['README.md'], (_program, args) => {
    calls.push(args);
    if (args[0] === 'symbolic-ref') return 'main\n';
    if (args[0] === 'diff') return 'README.md\0src/unrelated.ts\0';
    return '';
  }), /Unrelated staged changes/);
  assert(!calls.some(args => ['commit', 'tag', 'push'].includes(args[0])));
});
