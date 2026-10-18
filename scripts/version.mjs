import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (base, path) => readFileSync(resolve(base, path), 'utf8');
export const versionFiles = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
export function currentVersion(base = root) { return JSON.parse(read(base, 'package.json')).version; }
export function nextVersion(current, requested) {
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!semver.test(current)) throw new Error(`Invalid current version: ${current}`);
  const parts = current.split('.').map(Number);
  let target = requested;
  if (['major', 'minor', 'patch'].includes(requested)) {
    const index = ['major', 'minor', 'patch'].indexOf(requested);
    parts[index]++;
    for (let i = index + 1; i < 3; i++) parts[i] = 0;
    target = parts.join('.');
  }
  if (!semver.test(target ?? '')) throw new Error('Use patch, minor, major, or an X.Y.Z version.');
  const newer = target.split('.').map(Number);
  const old = current.split('.').map(Number);
  const first = newer.findIndex((v, i) => v !== old[i]);
  if (first < 0 || newer[first] < old[first]) throw new Error('The release version must increase.');
  return target;
}
function replacePackageVersion(text, name, version) {
  const sections = text.split(/(?=^\[\[package\]\])/m);
  let matched = 0;
  const updated = sections.map(section => {
    if (!new RegExp(`^name = "${name}"$`, 'm').test(section)) return section;
    matched++;
    return section.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
  }).join('');
  if (matched !== 1) throw new Error(`Expected one ${name} package in Cargo.lock, found ${matched}.`);
  return updated;
}
export function versionPlan(version, base = root) {
  const files = new Map();
  for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
    const data = JSON.parse(read(base, file));
    data.version = version;
    if (file === 'package-lock.json') data.packages[''].version = version;
    files.set(file, JSON.stringify(data, null, 2) + '\n');
  }
  const cargo = read(base, 'src-tauri/Cargo.toml');
  if (!/^\[package\]\nname = "drc"\nversion = "[^"]+"/m.test(cargo)) throw new Error('Unexpected DRC Cargo.toml package header.');
  files.set('src-tauri/Cargo.toml', cargo.replace(/^(\[package\]\nname = "drc"\nversion = ")[^"]+("$)/m, `$1${version}$2`));
  files.set('src-tauri/Cargo.lock', replacePackageVersion(read(base, 'src-tauri/Cargo.lock'), 'drc', version));
  return files;
}
export function syncVersion(version, base = root) {
  // Validate every input before writing; dependency and historical versions stay intact.
  for (const [file, text] of versionPlan(version, base)) writeFileSync(resolve(base, file), text);
}
export function checkVersion(base = root, tag) {
  const version = currentVersion(base);
  const stale = [...versionPlan(version, base)].filter(([file, text]) => read(base, file) !== text).map(([file]) => file);
  if (stale.length) throw new Error(`Version mismatch: ${stale.join(', ')}`);
  if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version ${version}.`);
  return version;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`Version ${checkVersion(root, process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined)}: consistent`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
