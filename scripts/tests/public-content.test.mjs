import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPublicContent } from '../public-content.mjs';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'drc-public-content-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: base });
  mkdirSync(join(base, '.private'));
  writeFileSync(join(base, '.gitignore'), '/.private/\n/BRAND-SYSTEM.md\n');
  return base;
}

test('local ignored references stay outside the public file set', t => {
  const base = fixture(t);
  writeFileSync(join(base, '.private/BRAND-SYSTEM.md'), 'Internal fixture');
  writeFileSync(join(base, 'BRAND-SYSTEM.md'), 'Internal fixture');
  writeFileSync(join(base, 'README.md'), '# DRC\nDisk inspection and imaging.\n');
  assert.doesNotThrow(() => checkPublicContent(base));
});

test('force-adding an internal reference fails even when its path is ignored', t => {
  for (const file of ['BRAND-SYSTEM.md', '.private/reference.md']) {
    const base = fixture(t);
    writeFileSync(join(base, file), 'Internal fixture');
    execFileSync('git', ['add', '-f', '--', file], { cwd: base });
    assert.throws(() => checkPublicContent(base), /internal reference included/);
  }
});

test('public documents cannot link to or reproduce the internal reference', t => {
  const base = fixture(t);
  for (const text of [
    '[Identity](BRAND-SYSTEM.md)',
    '[Reference](.private/reference.md)',
    '<a href="../.private/reference.md">Reference</a>',
    '# Internal fixture — Brand System\n',
  ]) {
    writeFileSync(join(base, 'README.md'), text);
    assert.throws(() => checkPublicContent(base), /Public content check failed/);
  }
});
