// Assembles the GitHub Pages site in site-dist/: the static pages from site/, the privacy
// policy rendered from PRIVACY.md, and the in-browser demo built by `vite build --mode demo`.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'site-dist');
/** Where GitHub Pages serves the site. */
const SITE_URL = 'https://baalintnagy.github.io/audiorack/';

if (!existsSync(resolve(out, 'demo', 'rack.html'))) {
    console.error('site-dist/demo is missing; run `vite build --mode demo` first.');
    process.exit(1);
}

function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/** Inline Markdown subset used by the project documents: code, bold, italics and links. */
function inline(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|[\w./#-]+)\)/g, '<a href="$2">$1</a>');
}

/** Converts headings, paragraphs and bullet lists; enough for PRIVACY.md. */
export function markdownToHtml(markdown) {
    const html = [];
    let paragraph = [];
    let list = [];
    const flush = () => {
        if (paragraph.length > 0) {
            html.push(`<p>${inline(paragraph.join(' '))}</p>`);
            paragraph = [];
        }
        if (list.length > 0) {
            html.push(`<ul>\n${list.map((item) => `<li>${inline(item)}</li>`).join('\n')}\n</ul>`);
            list = [];
        }
    };
    markdown.split(/\r?\n/).forEach((line) => {
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        const bullet = /^-\s+(.*)$/.exec(line);
        if (heading) {
            flush();
            const level = heading[1].length;
            html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        } else if (bullet) {
            if (paragraph.length > 0) {
                flush();
            }
            list.push(bullet[1]);
        } else if (line.trim() === '') {
            flush();
        } else if (list.length > 0 && /^\s+/.test(line)) {
            list[list.length - 1] += ` ${line.trim()}`;
        } else {
            if (list.length > 0) {
                flush();
            }
            paragraph.push(line.trim());
        }
    });
    flush();
    return html.join('\n');
}

mkdirSync(out, { recursive: true });
cpSync(resolve(root, 'site'), out, { recursive: true });

const template = readFileSync(resolve(root, 'site', 'privacy.html'), 'utf8');
const placeholder = /<!-- PRIVACY_POLICY:[^>]*-->/;
if (!placeholder.test(template)) {
    console.error('site/privacy.html is missing the PRIVACY_POLICY placeholder.');
    process.exit(1);
}
const policy = markdownToHtml(readFileSync(resolve(root, 'PRIVACY.md'), 'utf8'));
writeFileSync(resolve(out, 'privacy.html'), template.replace(placeholder, policy));

// The demo is the extension's rack page, which has a bare title: give it its own title,
// description and canonical address for search engines.
const demoPath = resolve(out, 'demo', 'rack.html');
const demo = readFileSync(demoPath, 'utf8');
if (!demo.includes('<title>AudioRack</title>')) {
    console.error('site-dist/demo/rack.html has no <title>AudioRack</title> to replace.');
    process.exit(1);
}
writeFileSync(
    demoPath,
    demo.replace(
        '<title>AudioRack</title>',
        [
            '<title>AudioRack live demo — try the effect rack in your browser</title>',
            '<meta name="description" content="Try AudioRack without installing it: EQ, compressors, saturator, limiter and analyzers running on a demo track, right in your browser." />',
            `<link rel="canonical" href="${SITE_URL}demo/rack.html" />`,
        ].join('\n        '),
    ),
);

// Pages for search engines. A project site cannot point to it from robots.txt, which crawlers
// read only at the root of the host, so it is submitted in Google Search Console instead.
const lastModified = new Date().toISOString().slice(0, 10);
const pages = ['', 'demo/rack.html', 'privacy.html'];
writeFileSync(
    resolve(out, 'sitemap.xml'),
    [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...pages.map(
            (page) =>
                `  <url><loc>${SITE_URL}${page}</loc><lastmod>${lastModified}</lastmod></url>`,
        ),
        '</urlset>',
        '',
    ].join('\n'),
);

// Keep GitHub Pages from running Jekyll over the output.
writeFileSync(resolve(out, '.nojekyll'), '');
console.log(`Site written to ${out}`);
