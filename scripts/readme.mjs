import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { root, currentVersion } from './version.mjs';

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
  return readFileSync(resolve(base, 'docs/README.template.md'), 'utf8').replaceAll('{{version}}', version).replace('{{screenshots}}', images);
}
export function updateReadme(base = root, check = false) {
  const result = renderReadme(base);
  const path = resolve(base, 'README.md');
  if (check) { if (readFileSync(path, 'utf8') !== result) throw new Error('README is stale. Run npm run readme.'); }
  else writeFileSync(path, result);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { updateReadme(root, process.argv.includes('--check')); console.log('README updated and checked.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
