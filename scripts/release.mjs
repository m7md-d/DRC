import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, checkVersion, nextVersion, syncVersion, versionFiles } from './version.mjs';
import { updateReadme } from './readme.mjs';
import { checkPublicContent } from './public-content.mjs';

export function command(program, args, cwd = root, capture = false) {
  return execFileSync(program, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
}
export function publishPrepared(base, version, files, run = command) {
  const git = (args, capture = false) => run('git', args, base, capture);
  const branch = git(['symbolic-ref', '--short', 'HEAD'], true).trim();
  if (!branch) throw new Error('A release must be on a branch.');
  // Stage only generated release files, never unrelated source changes.
  git(['add', '--', ...files]);
  const staged = git(['diff', '--cached', '--name-only', '-z'], true).split('\0').filter(Boolean);
  if (staged.some(path => !files.some(file => path === file || path.startsWith(`${file}/`)))) {
    throw new Error('Unrelated staged changes appeared during release preparation. Commit them separately.');
  }
  git(['commit', '-m', `Release v${version}`]);
  try { git(['push', 'origin', `HEAD:refs/heads/${branch}`]); }
  catch { throw new Error(`Push failed; the local release commit is retained. Retry: git push origin HEAD:refs/heads/${branch}`); }
}
export function release(args, base = root) {
  const flags = args.filter(a => a.startsWith('--'));
  if (flags.some(a => !['--dry-run', '--publish'].includes(a)) || args.filter(a => !a.startsWith('--')).length !== 1 || (flags.includes('--publish') && flags.includes('--dry-run'))) {
    throw new Error('Usage: npm run release -- patch|minor|major|X.Y.Z [--dry-run|--publish]');
  }
  const current = checkVersion(base);
  const target = nextVersion(current, args.find(a => !a.startsWith('--')));
  const files = [...versionFiles, 'README.md', 'docs/images'];
  console.log(`${current} → ${target}\nUpdate manifests and lockfiles; test; build macOS; capture native screenshots; regenerate README.`);
  console.log(flags.includes('--publish') ? `Commit and push v${target}. GitHub checks the commit, builds packages, then creates the tag and release.` : 'Local preparation only. --publish also commits and pushes the prepared version.');
  if (flags.includes('--dry-run')) return;
  if (process.platform !== 'darwin') throw new Error('Prepare releases on macOS so the native screenshots can be captured. Linux packages are built by GitHub Actions.');
  const git = (a) => command('git', a, base, true).trim();
  if (git(['status', '--porcelain'])) throw new Error('Commit the current work before preparing a release. The script never commits unrelated edits.');
  checkPublicContent(base);
  const branch = git(['symbolic-ref', '--short', 'HEAD']);
  if (!branch) throw new Error('Switch to a branch before preparing a release.');
  if (git(['tag', '--list', `v${target}`])) throw new Error(`Tag v${target} already exists.`);
  const notes = readFileSync(resolve(base, 'docs/RELEASE-NOTES.md'), 'utf8').trim();
  if (!notes.startsWith('- ') || notes.length > 1800) throw new Error('Write a short bullet list in docs/RELEASE-NOTES.md before releasing (maximum 1800 characters).');
  if (flags.includes('--publish')) {
    const refs = git(['ls-remote', 'origin', `refs/tags/v${target}`]);
    if (refs) throw new Error(`Remote tag v${target} already exists.`);
  }
  syncVersion(target, base);
  for (const task of ['release:test', 'test', 'native:test', 'rust:test', 'rust:check', 'copy:check', 'desktop:build']) command('npm', ['run', task], base);
  command(process.execPath, ['scripts/screenshots.mjs', '--built'], base);
  updateReadme(base);
  checkVersion(base);
  updateReadme(base, true);
  if (flags.includes('--publish')) publishPrepared(base, target, files);
  else console.log(`Prepared ${target}. Review, commit and push these files. GitHub checks the commit and publishes the new version after package checks pass.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { release(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
