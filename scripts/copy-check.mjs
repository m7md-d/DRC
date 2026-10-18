import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './version.mjs';
const files = ['README.md', 'docs/RELEASE-NOTES.md', 'docs/README.template.md'];
for (const directory of ['src', 'src-tauri/native']) {
  for (const file of readdirSync(resolve(root, directory))) {
    if (/\.(tsx|ts|swift)$/.test(file) && !file.includes('.test.')) files.push(`${directory}/${file}`);
  }
}
// A small regression guard, not a substitute for reviewing meaning and context.
const banned = /your disk\.\s*your next step|we['’]re excited|unlock (?:the|your)|seamless(?:ly)?|ultimate (?:tool|solution)|empower(?:ing)? users|take control of|recover (?:anything|everything)|peace of mind|game[- ]chang(?:er|ing)/ig;
let failed = false;
for (const file of files) {
  const text = readFileSync(resolve(root, file), 'utf8');
  for (const match of text.matchAll(banned)) {
    console.error(`${file}:${text.slice(0, match.index).split('\n').length}: remove filler: ${match[0]}`);
    failed = true;
  }
}
if (readFileSync(resolve(root, 'docs/RELEASE-NOTES.md'), 'utf8').length > 1800) { console.error('Release notes exceed 1800 characters. Move test details to BUILD_CHECKS.md.'); failed = true; }
if (failed) process.exitCode = 1;
else console.log(`Copy checks passed (${files.length} files).`);
