// Renders the extension icons as PNG files without image dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const OUT_DIR = new URL('../public/icons/', import.meta.url);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        rows[y * (size * 4 + 1)] = 0;
        rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function roundedRectDistance(x, y, inset, radius) {
    const half = 0.5 - inset;
    const qx = Math.abs(x - 0.5) - (half - radius);
    const qy = Math.abs(y - 0.5) - (half - radius);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

// The logo wave: a damped oscillation across the tile.
const WAVE = Array.from({ length: 200 }, (_, index) => {
    const t = index / 199;
    const x = 0.18 + t * 0.66;
    const y = 0.52 - Math.sin(t * Math.PI * 3.2) * 0.24 * (1 - t * 0.55);
    return [x, y];
});

function waveDistance(x, y) {
    let best = Infinity;
    for (let i = 1; i < WAVE.length; i++) {
        const [ax, ay] = WAVE[i - 1];
        const [bx, by] = WAVE[i];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
}

function gradient(x, y) {
    const t = Math.min(1, Math.max(0, (x + y) / 2));
    return [255, Math.round(179 - t * 85), Math.round(71 + t * 51)];
}

function shade(x, y, size) {
    const tile = roundedRectDistance(x, y, 0.02, 0.22);
    if (tile > 0) {
        return [0, 0, 0, 0];
    }
    const borderWidth = size <= 16 ? 0.09 : 0.055;
    const strokeWidth = size <= 16 ? 0.085 : 0.06;
    if (tile > -borderWidth || waveDistance(x, y) < strokeWidth) {
        return [...gradient(x, y), 255];
    }
    const glow = Math.max(0, 1 - waveDistance(x, y) / 0.16) * 0.25;
    return [26 + glow * 120, 30 + glow * 60, 37 + glow * 40, 255];
}

mkdirSync(OUT_DIR, { recursive: true });
SIZES.forEach((size) => {
    const rgba = Buffer.alloc(size * size * 4);
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const sum = [0, 0, 0, 0];
            for (let sy = 0; sy < SUPERSAMPLE; sy++) {
                for (let sx = 0; sx < SUPERSAMPLE; sx++) {
                    const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
                    const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
                    const [r, g, b, a] = shade(x, y, size);
                    sum[0] += r * a;
                    sum[1] += g * a;
                    sum[2] += b * a;
                    sum[3] += a;
                }
            }
            const offset = (py * size + px) * 4;
            const alpha = sum[3] / (SUPERSAMPLE * SUPERSAMPLE);
            rgba[offset] = sum[3] ? Math.round(sum[0] / sum[3]) : 0;
            rgba[offset + 1] = sum[3] ? Math.round(sum[1] / sum[3]) : 0;
            rgba[offset + 2] = sum[3] ? Math.round(sum[2] / sum[3]) : 0;
            rgba[offset + 3] = Math.round(alpha);
        }
    }
    writeFileSync(new URL(`icon-${size}.png`, OUT_DIR), encodePng(size, rgba));
});
console.log(`Wrote ${SIZES.length} icons to ${OUT_DIR.pathname}`);
