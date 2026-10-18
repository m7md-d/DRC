import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './version.mjs';

export function checkPublicContent(base = root) {
  const files = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0').filter(Boolean));
  const violations = [];
  for (const file of files) {
    const path = resolve(base, file);
    if (!existsSync(path)) continue; // A removed tracked file is pending deletion.
    if (/^\.private\/|(?:^|\/)BRAND-SYSTEM\.md$/i.test(file)) {
      violations.push(`${file}: internal reference included in repository files`);
      continue;
    }
    if (!/\.(md|html|txt)$/i.test(file)) continue;
    const text = readFileSync(path, 'utf8');
    if (/\bBRAND-SYSTEM\.md\b|^#\s+.+[—–-]\s+Brand System\s*$/im.test(text)) {
      violations.push(`${file}: internal identity reference in public content`);
    }
    if (/(?:\]\(|(?:href|src)\s*=\s*["'])[^\n"')]*\.private\//i.test(text)) {
      violations.push(`${file}: link to local private storage`);
    }
  }
  if (violations.length) throw new Error(`Public content check failed:\n${violations.join('\n')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkPublicContent(); console.log('Public content checks passed.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
