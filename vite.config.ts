import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
};

// The Chrome Web Store shows this as the listing summary; it must stay within 132 characters.
const DESCRIPTION =
    'An effect rack for your browser tabs: EQ, compressors, gate, denoiser, de-esser, ' +
    'bass booster, a loudness meter and audio analyzers.';

const ICON_SIZES = [16, 32, 48, 128];

function icons(prefix: string): Record<string, string> {
    return Object.fromEntries(ICON_SIZES.map((size) => [size, `${prefix}/icon-${size}.png`]));
}

export function manifest(version: string) {
    return {
        manifest_version: 3,
        name: 'AudioRack',
        short_name: 'AudioRack',
        version,
        description: DESCRIPTION,
        minimum_chrome_version: '116',
        action: {
            default_title: 'AudioRack',
            default_popup: 'rack.html',
            default_icon: icons('icons'),
        },
        icons: icons('icons'),
        background: { service_worker: 'background.js', type: 'module' },
        permissions: ['tabCapture', 'offscreen', 'storage', 'activeTab', 'sidePanel'],
    };
}

function extensionManifest(): Plugin {
    return {
        name: 'audiorack-manifest',
        apply: 'build',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'manifest.json',
                source: `${JSON.stringify(manifest(pkg.version), null, 4)}\n`,
            });
        },
    };
}

const extensionBuild = {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    rollupOptions: {
        input: {
            rack: 'rack.html',
            offscreen: 'offscreen.html',
            background: 'src/background/index.ts',
        },
        output: {
            entryFileNames: (chunk: { name: string }) =>
                chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        },
    },
};

// `vite build --mode demo` builds only the rack page, with relative URLs, for the website's
// in-browser demo. Outside the extension the UI runs the engine in the page itself.
const demoBuild = {
    outDir: 'site-dist/demo',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { rack: 'rack.html' } },
};

export default defineConfig(({ mode }) => ({
    base: mode === 'demo' ? './' : '/',
    plugins: mode === 'demo' ? [react()] : [react(), extensionManifest()],
    worker: { format: 'iife' as const },
    build: mode === 'demo' ? demoBuild : extensionBuild,
}));
