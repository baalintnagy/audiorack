// Zips dist/ into release/audiorack-<version>.zip for the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
    execFileSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path '${dist}\\*' -DestinationPath '${archive}'`,
        ],
        { stdio: 'inherit' },
    );
} else {
    execFileSync('zip', ['-r', '-X', '-q', archive, '.'], { cwd: dist, stdio: 'inherit' });
}
console.log(archive);
