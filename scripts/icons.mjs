import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { root } from './version.mjs';

// One editable vector supplies desktop, web and README assets.
execFileSync(process.execPath, [resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', 'public/drc-icon.svg', '--output', 'src-tauri/icons'], { cwd: root, stdio: 'inherit' });
mkdirSync(resolve(root, 'docs/assets'), { recursive: true });
copyFileSync(resolve(root, 'src-tauri/icons/128x128@2x.png'), resolve(root, 'docs/assets/app-icon.png'));
console.log('App icons and README icon generated from public/drc-icon.svg.');
