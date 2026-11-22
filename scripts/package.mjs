// Zips dist/ into release/audiorack-<version>.zip for the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
    console.error('dist/manifest.json is missing; run `npm run build` first.');
    process.exit(1);
}
const { version } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const releaseDir = resolve(root, 'release');
const archive = resolve(releaseDir, `audiorack-${version}.zip`);
mkdirSync(releaseDir, { recursive: true });
rmSync(archive, { force: true });

if (process.platform === 'win32') {
    // Windows' bsdtar writes zip entries with forward slashes. Compress-Archive in Windows
    // PowerShell 5.1 writes backslashes, which the zip format does not define as separators.
    const tar = resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-a', '-c', '-f', archive, ...readdirSync(dist)], {
        cwd: dist,
        stdio: 'inherit',
    });
} else {
    execFileSync('zip', ['-r', '-X', '-q', archive, '.'], { cwd: dist, stdio: 'inherit' });
}
console.log(archive);
