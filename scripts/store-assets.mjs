// Captures the Chrome Web Store screenshots, the website pictures of every module and the promo
// tiles with a headless Chromium browser. The rack runs in demo mode on a Vite dev server, playing
// the rendered demo track.
//
//   npm run store:assets            (set CHROME_PATH if no Chrome, Brave or Edge is found)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STORE_DIR = join(ROOT, 'store');
const SCREENSHOT_DIR = join(STORE_DIR, 'screenshots');
const PROMO_DIR = join(STORE_DIR, 'promo');
const SITE_IMAGE_DIR = join(ROOT, 'site', 'images');
const RACK = readFileSync(join(STORE_DIR, 'screenshot-rack.json'), 'utf8');
const TAB_TITLE = 'Late-night drum & bass mix';
const JPEG_QUALITY = 95;

// Store screenshots of the rack window, dressed as the extension at 1280×800, in the order they
// are taken; the fifth is the side panel scene below. Shots of both racks may also set `enable`,
// to switch on an effect that is bypassed in the screenshot rack for its own shot, and `noisy`,
// to play the demo track with added hiss and hum from then on, for the denoiser.
const STORE = { width: 1280, height: 800, dressed: true };
const STORE_SHOTS = [
    { path: join(SCREENSHOT_DIR, '1-equalizer.jpg'), slot: 'EQ', settle: 4000 },
    { path: join(SCREENSHOT_DIR, '2-compressor.jpg'), slot: 'COMP', settle: 11000 },
    // Long enough to fill the spectrogram.
    { path: join(SCREENSHOT_DIR, '3-spectrogram.jpg'), slot: 'SGRAM', settle: 20000 },
    { path: join(SCREENSHOT_DIR, '4-stereo-image.jpg'), slot: 'IMAGE', settle: 5000 },
].map((shot) => ({ ...shot, ...STORE }));

// The website shows every module, from a rack that holds all of them, as the demo looks on the
// site at 800×600.
const SITE_RACK = readFileSync(join(ROOT, 'site', 'screenshot-rack.json'), 'utf8');
const SITE = { width: 800, height: 600, dressed: false };
const SITE_SHOTS = [
    { file: 'equalizer.jpg', slot: 'EQ', settle: 4000 },
    { file: 'compressor.jpg', slot: 'COMP', settle: 11000 },
    { file: 'limiter.jpg', slot: 'LIM', settle: 6000 },
    { file: 'multiband.jpg', slot: 'MB', settle: 5000 },
    { file: 'gate.jpg', slot: 'GATE', enable: true, settle: 8000 },
    { file: 'filter.jpg', slot: 'FLT', enable: true, settle: 6000 },
    { file: 'deesser.jpg', slot: 'DS', enable: true, settle: 6000 },
    { file: 'volume.jpg', slot: 'VOL', settle: 5000 },
    { file: 'bass-booster.jpg', slot: 'BASS', settle: 4000 },
    { file: 'parallel.jpg', slot: 'PAR', settle: 6000 },
    { file: 'spectrum.jpg', slot: 'SPEC', settle: 4000 },
    { file: 'spectrogram.jpg', slot: 'SGRAM', settle: 20000 },
    { file: 'stereo.jpg', slot: 'IMAGE', settle: 5000 },
    { file: 'loudness.jpg', slot: 'LUFS', settle: 35000 },
    { file: 'denoiser.jpg', slot: 'DN', enable: true, noisy: true, settle: 8000 },
].map(({ file, ...shot }) => ({ path: join(SITE_IMAGE_DIR, file), ...shot, ...SITE }));

// Renders the demo track with white hiss and a 50 Hz hum into a WAV file and loads it with
// "Load audio…". Runs in the page, where Vite serves the module that renders the track.
const LOAD_NOISY_DEMO = `(async () => {
    const { demoTrack } = await import('/src/ui/demo-signal.ts');
    const buffer = await demoTrack();
    const channels = [0, 1].map((channel) =>
        buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)),
    );
    const { length, sampleRate } = buffer;
    const data = new DataView(new ArrayBuffer(44 + length * 4));
    const text = (offset, value) =>
        [...value].forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    data.setUint32(4, 36 + length * 4, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, 2, true);
    data.setUint32(24, sampleRate, true);
    data.setUint32(28, sampleRate * 4, true);
    data.setUint16(32, 4, true);
    data.setUint16(34, 16, true);
    text(36, 'data');
    data.setUint32(40, length * 4, true);
    let seed = 1;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed / 0xffffffff) * 2 - 1;
    };
    for (let i = 0; i < length; i++) {
        const hum = 0.004 * Math.sin((2 * Math.PI * 50 * i) / sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const value = channels[channel][i] + random() * 0.012 + hum;
            data.setInt16(44 + (i * 2 + channel) * 2, Math.max(-1, Math.min(1, value)) * 32767, true);
        }
    }
    const file = new File([data.buffer], 'Demo track with hiss.wav', { type: 'audio/wav' });
    const input = document.querySelector('input[type=file][accept^="audio"]');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
})()`;

// The side panel scene: a sample video page with the rack docked next to it, the equalizer picked
// among pinned effects and the panel scrolled to where the equalizer meets the compressor below.
const SIDE_PANEL = { pins: ['EQ', 'COMP', 'IMAGE'], slot: 'EQ', scrollTop: 330, settle: 8000 };
const SIDE_PANEL_SHOTS = [
    { path: join(SCREENSHOT_DIR, '5-side-panel.jpg'), width: 1280, height: 800, scale: 1 },
    // 800×600 like the other pictures of the website, laid out at 1067×800.
    { path: join(SITE_IMAGE_DIR, 'side-panel.jpg'), width: 1067, height: 800, scale: 0.75 },
];

const TILES = [
    { page: 'small-tile.html', file: 'small-tile.jpg', width: 440, height: 280 },
    { page: 'marquee.html', file: 'marquee.jpg', width: 1400, height: 560 },
];

const BROWSER_CANDIDATES = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];

function findBrowser() {
    const found = BROWSER_CANDIDATES.find((path) => path && existsSync(path));
    if (!found) {
        throw new Error('No Chromium browser found. Set CHROME_PATH.');
    }
    return found;
}

async function launchBrowser() {
    const profile = mkdtempSync(join(tmpdir(), 'audiorack-store-'));
    const child = spawn(
        findBrowser(),
        [
            '--headless=new',
            '--remote-debugging-port=0',
            `--user-data-dir=${profile}`,
            '--autoplay-policy=no-user-gesture-required',
            '--hide-scrollbars',
            '--no-first-run',
            '--no-default-browser-check',
            '--mute-audio',
            'about:blank',
        ],
        { stdio: 'ignore' },
    );
    const portFile = join(profile, 'DevToolsActivePort');
    for (let attempt = 0; !existsSync(portFile); attempt++) {
        if (attempt > 100) {
            throw new Error('The browser did not open a DevTools port.');
        }
        await sleep(100);
    }
    await sleep(200);
    const [port] = readFileSync(portFile, 'utf8').split('\n');
    const close = () => {
        child.kill();
        try {
            rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
            // The profile lives in the temp folder; leaving it behind is harmless.
        }
    };
    return { port: Number(port), close };
}

/** A minimal Chrome DevTools Protocol client for one page. */
class Page {
    #socket;
    #nextId = 1;
    #pending = new Map();

    static async open(port) {
        const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
            method: 'PUT',
        });
        const { webSocketDebuggerUrl } = await response.json();
        const page = new Page();
        page.#socket = new WebSocket(webSocketDebuggerUrl);
        page.#socket.addEventListener('message', (event) => page.#receive(event));
        await new Promise((resolve, reject) => {
            page.#socket.addEventListener('open', resolve, { once: true });
            page.#socket.addEventListener('error', reject, { once: true });
        });
        return page;
    }

    #receive(event) {
        const message = JSON.parse(event.data);
        const pending = this.#pending.get(message.id);
        if (!pending) {
            return;
        }
        this.#pending.delete(message.id);
        if (message.error) {
            pending.reject(new Error(message.error.message));
        } else {
            pending.resolve(message.result);
        }
    }

    send(method, params = {}) {
        const id = this.#nextId++;
        this.#socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    }

    async evaluate(expression) {
        const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (exceptionDetails) {
            throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        }
        return result.value;
    }

    async waitFor(expression, timeout = 15000) {
        const deadline = Date.now() + timeout;
        while (!(await this.evaluate(expression))) {
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${expression}`);
            }
            await sleep(100);
        }
    }

    async viewport(width, height, scale = 1) {
        await this.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: scale,
            mobile: false,
        });
    }

    async goto(url, width, height, scale = 1) {
        await this.viewport(width, height, scale);
        await this.send('Page.navigate', { url });
        await this.waitFor('document.readyState === "complete"');
    }

    async capture(path) {
        const { data } = await this.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: JPEG_QUALITY,
        });
        writeFileSync(path, Buffer.from(data, 'base64'));
        console.log(`Wrote ${path}`);
    }

    close() {
        this.#socket.close();
    }
}

// Makes the demo page look like the extension's pop-out window processing a tab.
const DRESS_AS_EXTENSION = dressAsExtension('document');

// Shows the demo page as it is again, apart from the status label, which updates by itself.
const UNDRESS = `(() => {
    document.getElementById('store-dress')?.remove();
    return true;
})()`;

// The rack document of the side panel scene.
const PANEL_DOCUMENT = 'document.querySelector("iframe").contentDocument';

/**
 * Hides the demo-only buttons and shows the sample tab title in place of the status label, with
 * a style sheet only: React keeps owning the label, so its text can still change underneath.
 */
function dressAsExtension(doc) {
    const title = JSON.stringify(JSON.stringify(TAB_TITLE));
    return `((document) => {
    if (!document.getElementById('store-dress')) {
        const label = document.querySelector('.capture-label');
        const size = label ? getComputedStyle(label).fontSize : '11px';
        const style = document.createElement('style');
        style.id = 'store-dress';
        style.textContent =
            '.header > .ghost { display: none !important; }' +
            '.capture-label { font-size: 0 !important; }' +
            '.capture-label::after { content: ' + ${title} + '; font-size: ' + size + '; }';
        document.head.append(style);
    }
    return true;
})(${doc})`;
}

/** Selects an effect, or with `PAR` the parallel group, in the chain strip by its short name. */
function selectSlot(name, doc = 'document') {
    return `((document) => {
        const slot = [...document.querySelectorAll('.chain .slot, .chain .group')].find(
            (element) =>
                element.querySelector(
                    element.classList.contains('group') ? '.group-name' : '.slot-name',
                )?.textContent === ${JSON.stringify(name)},
        );
        slot?.click();
        return slot !== undefined;
    })(${doc})`;
}

/** Switches an effect in the chain strip on or off with its power button. */
function setEnabled(name, enabled) {
    return `(() => {
        const slot = [...document.querySelectorAll('.chain .slot')].find(
            (element) => element.querySelector('.slot-name')?.textContent === ${JSON.stringify(name)},
        );
        const power = slot?.querySelector('.slot-power');
        if (power && power.classList.contains('on') !== ${enabled}) {
            power.click();
        }
        return power !== undefined;
    })()`;
}

async function captureSidePanel(page, origin, { path, width, height, scale }) {
    // Start without pins; the scene's frame shares this tab's session storage.
    await page.evaluate('sessionStorage.clear(); true');
    await page.goto(`${origin}/store/promo/side-panel.html`, width, height, scale);
    await page.waitFor(`${PANEL_DOCUMENT}?.querySelector(".capture") !== null`);
    await page.evaluate(`${PANEL_DOCUMENT}.querySelector(".capture").click(); true`);
    await page.waitFor(`${PANEL_DOCUMENT}.querySelector(".capture.on") !== null`, 30000);
    for (const slot of SIDE_PANEL.pins) {
        if (!(await page.evaluate(selectSlot(slot, PANEL_DOCUMENT)))) {
            throw new Error(`No ${slot} slot in the default rack.`);
        }
        await sleep(300);
        // The picked panel is the only one until the first pin, then the highlighted one.
        await page.evaluate(`(${PANEL_DOCUMENT}.querySelector('.panel.selected .pin-button') ??
            ${PANEL_DOCUMENT}.querySelector('.panel .pin-button')).click(); true`);
        await sleep(300);
    }
    await page.evaluate(selectSlot(SIDE_PANEL.slot, PANEL_DOCUMENT));
    await sleep(SIDE_PANEL.settle);
    await page.evaluate(`((document) => {
        document.querySelectorAll('.chain-frame *').forEach((element) => {
            element.scrollLeft = 0;
        });
        document.querySelector('.main').scrollTop = ${SIDE_PANEL.scrollTop};
        return true;
    })(${PANEL_DOCUMENT})`);
    await page.evaluate(dressAsExtension(PANEL_DOCUMENT));
    await sleep(500);
    await page.capture(path);
}

/** Plays the demo through `rack` and takes `shots` of the rack window, one module each. */
async function captureRack(page, origin, rack, shots) {
    await page.goto(`${origin}/rack.html`, shots[0].width, shots[0].height);
    await page.evaluate(
        `localStorage.setItem('audiorack:rack', ${JSON.stringify(rack)}); sessionStorage.clear(); true`,
    );
    await page.goto(`${origin}/rack.html`, shots[0].width, shots[0].height);
    await page.waitFor('document.querySelector(".capture") !== null');
    await page.evaluate('document.querySelector(".capture").click()');
    await page.waitFor('document.querySelector(".capture.on") !== null', 30000);
    for (const shot of shots) {
        if (shot.noisy) {
            await page.evaluate(LOAD_NOISY_DEMO);
            await page.waitFor(
                'document.querySelector(".capture-label")?.textContent.includes("hiss")',
            );
            await page.waitFor('document.querySelector(".capture.on") !== null', 30000);
        }
        await page.viewport(shot.width, shot.height);
        await page.evaluate(UNDRESS);
        if (shot.enable) {
            await page.evaluate(setEnabled(shot.slot, true));
        }
        if (!(await page.evaluate(selectSlot(shot.slot)))) {
            throw new Error(`No ${shot.slot} slot in the screenshot rack.`);
        }
        await sleep(shot.settle);
        if (shot.dressed) {
            await page.evaluate(DRESS_AS_EXTENSION);
        }
        await sleep(100);
        await page.capture(shot.path);
        if (shot.enable) {
            await page.evaluate(setEnabled(shot.slot, false));
        }
    }
}

async function captureScreenshots(page, origin) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    mkdirSync(SITE_IMAGE_DIR, { recursive: true });
    await captureRack(page, origin, RACK, STORE_SHOTS);
    // The side panel scene loads whichever rack the page stored last: the store rack here.
    for (const shot of SIDE_PANEL_SHOTS) {
        await captureSidePanel(page, origin, shot);
    }
    await captureRack(page, origin, SITE_RACK, SITE_SHOTS);
}

async function captureTiles(page, origin) {
    for (const { page: source, file, width, height } of TILES) {
        await page.goto(`${origin}/store/promo/${source}`, width, height);
        await page.evaluate('document.fonts.ready.then(() => true)');
        await sleep(300);
        await page.capture(join(PROMO_DIR, file));
    }
}

const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5190, strictPort: false },
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await launchBrowser();
try {
    const page = await Page.open(browser.port);
    await captureScreenshots(page, origin);
    await captureTiles(page, origin);
    page.close();
} finally {
    browser.close();
    await server.close();
}
