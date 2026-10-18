import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { root, currentVersion } from './version.mjs';

const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function headerBadges(base = root) {
  const read = path => readFileSync(resolve(base, path), 'utf8');
  const lock = JSON.parse(read('package-lock.json'));
  const npm = name => {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    if (typeof version !== 'string' || !version) throw new Error(`Missing locked version: ${name}`);
    return version;
  };
  const cargo = read('src-tauri/Cargo.toml').split(/^\[/m)[1];
  const edition = cargo?.match(/^edition\s*=\s*"([^"]+)"/m)?.[1];
  const tauri = read('src-tauri/Cargo.lock').split(/(?=^\[\[package\]\])/m)
    .filter(section => /^name = "tauri"$/m.test(section));
  const tauriVersion = tauri.length === 1 && tauri[0].match(/^version = "([^"]+)"$/m)?.[1];
  const swift = read('src-tauri/build.rs').match(/"-swift-version"\s*,\s*"([^"]+)"/)?.[1];
  const minimum = JSON.parse(read('src-tauri/tauri.conf.json')).bundle?.macOS?.minimumSystemVersion;
  if (!edition || !tauriVersion || !swift || typeof minimum !== 'string' || !minimum) throw new Error('Missing Rust, Tauri or native macOS badge metadata.');
  const badge = (name, value, color, href, logo, logoColor = 'white') => {
    const url = new URL('https://img.shields.io/static/v1');
    url.search = new URLSearchParams({ label: name, message: value, color, style: 'flat', ...(logo ? { logo, logoColor } : {}) });
    return `    <a href="${xml(href)}"><img src="${xml(url.href)}" alt="${xml(`${name} ${value}`)}" /></a>`;
  };
  return {
    project: [
      badge('Source', `v${currentVersion(base)}`, 'blue', 'package.json'),
      badge('macOS', `${minimum.replace(/\.0$/, '')}+`, '000000', '#install', 'apple'),
      badge('Linux', 'Debian / Fedora', 'FCC624', 'docs/LINUX-INSTALL.md', 'linux', 'black'),
      badge('License', 'GPL v3', 'blue', 'LICENSE'),
    ].join('\n'),
    technologies: [
      badge('Rust', `edition ${edition}`, '000000', 'src-tauri/Cargo.toml', 'rust'),
      badge('Tauri', tauriVersion, 'FFC131', 'src-tauri/Cargo.lock', 'tauri', 'black'),
      badge('React', npm('react'), '61DAFB', 'package-lock.json', 'react', 'black'),
      badge('TypeScript', npm('typescript'), '3178C6', 'package-lock.json', 'typescript'),
      badge('SwiftUI', `Swift ${swift} mode`, 'F05138', 'src-tauri/build.rs', 'swift'),
    ].join('\n'),
  };
}

export function renderReadme(base = root) {
  const version = currentVersion(base);
  const path = resolve(base, 'docs/images/manifest.json');
  if (!existsSync(path)) throw new Error('README screenshots are missing. Run npm run screenshots.');
  let images = '';
  if (existsSync(path)) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(manifest.images) || !manifest.images.length) throw new Error('README screenshot manifest is empty.');
    if (manifest.version !== version || manifest.source !== 'native-desktop') throw new Error('Capture README screenshots from this app version: npm run screenshots.');
    images = '## Screenshots\n\n' + manifest.images.map(entry => {
      if (!/^[a-z-]+\.png$/.test(entry.file)) throw new Error('Unexpected screenshot filename.');
      const data = readFileSync(resolve(base, 'docs/images', entry.file));
      if (createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Screenshot changed: ${entry.file}`);
      return `### ${entry.title}\n\n![${entry.description}](docs/images/${entry.file})\n\n${entry.description}\n`;
    }).join('\n') + '\n';
  }
  const badges = headerBadges(base);
  return readFileSync(resolve(base, 'docs/README.template.md'), 'utf8')
    .replaceAll('{{version}}', version)
    .replace('{{projectBadges}}', badges.project)
    .replace('{{technologyBadges}}', badges.technologies)
    .replace('{{screenshots}}', images);
}
export function updateReadme(base = root, check = false) {
  const result = renderReadme(base);
  const path = resolve(base, 'README.md');
  if (check) {
    if (readFileSync(path, 'utf8') !== result) throw new Error('README is stale. Run npm run readme.');
  } else {
    writeFileSync(path, result);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { updateReadme(root, process.argv.includes('--check')); console.log('README updated and checked.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
