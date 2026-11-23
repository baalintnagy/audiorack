// Captures the Chrome Web Store screenshots, the side panel picture of the website and the promo
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

const SCREENSHOTS = [
    { file: '1-equalizer.jpg', slot: 'EQ', settle: 4000 },
    { file: '3-compressor.jpg', slot: 'COMP', settle: 11000 },
    { file: '4-multiband.jpg', slot: 'MB', settle: 4000 },
    { file: '5-spectrogram.jpg', slot: 'SGRAM', settle: 20000 },
];

// The side panel scene: a sample video page with the rack docked next to it, the equalizer picked
// among pinned effects and the panel scrolled to where the equalizer meets the compressor below.
const SIDE_PANEL = { pins: ['EQ', 'COMP', 'IMAGE'], slot: 'EQ', scrollTop: 330, settle: 8000 };
const SIDE_PANEL_SHOTS = [
    { path: join(SCREENSHOT_DIR, '2-side-panel.jpg'), width: 1280, height: 800, scale: 1 },
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

    async goto(url, width, height, scale = 1) {
        await this.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: scale,
            mobile: false,
        });
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

// The rack document of the side panel scene.
const PANEL_DOCUMENT = 'document.querySelector("iframe").contentDocument';

function dressAsExtension(doc) {
    return `((document) => {
    const style = document.createElement('style');
    style.textContent = '.header > .ghost { display: none !important; }';
    document.head.append(style);
    const label = document.querySelector('.capture-label');
    if (label) {
        label.textContent = ${JSON.stringify(TAB_TITLE)};
    }
    return true;
})(${doc})`;
}

function selectSlot(name, doc = 'document') {
    return `((document) => {
        const slot = [...document.querySelectorAll('.chain .slot')].find(
            (element) => element.querySelector('.slot-name')?.textContent === ${JSON.stringify(name)},
        );
        slot?.click();
        return slot !== undefined;
    })(${doc})`;
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

async function captureScreenshots(page, origin) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.goto(`${origin}/rack.html`, 1280, 800);
    await page.evaluate(`localStorage.setItem('audiorack:rack', ${JSON.stringify(RACK)}); true`);
    await page.goto(`${origin}/rack.html`, 1280, 800);
    await page.waitFor('document.querySelector(".capture") !== null');
    await page.evaluate('document.querySelector(".capture").click()');
    await page.waitFor('document.querySelector(".capture.on") !== null', 30000);
    for (const { file, slot, settle } of SCREENSHOTS) {
        if (!(await page.evaluate(selectSlot(slot)))) {
            throw new Error(`No ${slot} slot in the default rack.`);
        }
        await sleep(settle);
        await page.evaluate(DRESS_AS_EXTENSION);
        await sleep(100);
        await page.capture(join(SCREENSHOT_DIR, file));
    }
    for (const shot of SIDE_PANEL_SHOTS) {
        await captureSidePanel(page, origin, shot);
    }
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
