# AudioRack

**Website and live demo:** [baalintnagy.github.io/audiorack](https://baalintnagy.github.io/audiorack/)

A Chrome extension that routes the audio of a browser tab through a configurable chain of
effects, with a dark, analyzer-driven interface inspired by modern plug-in suites.

## Effects

| Effect       | What it does                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Equalizer    | Up to 12 bands (bell, shelves, 12–48 dB/oct cuts, notch, band pass) edited directly on the live pre/post spectrum.                     |
| Compressor   | Feed-forward soft-knee compressor with peak/RMS detection, sidechain high-pass, auto makeup and parallel mix.                          |
| Limiter      | Lookahead brickwall limiter; the output never exceeds the ceiling.                                                                     |
| Multiband    | 2–4 band compressor on phase-compensated Linkwitz-Riley crossovers, with solo/mute/bypass per band.                                    |
| Saturator    | 1–4 band saturation (tube, tape, soft, hard, fold, rectify) with drive, dynamics, tone, mix and level per band; 1×/2×/4× oversampling. |
| Gate         | Noise gate with range, attack, hold, release, hysteresis and a sidechain high-pass; a transfer curve shows the hysteresis loop.        |
| Filter       | Resonant LP/HP/BP/notch filter with drive and a sine/triangle LFO on the cutoff.                                                       |
| De-esser     | Band-pass sidechain detector, split-band or wideband reduction, and a listen mode.                                                     |
| Denoiser     | Spectral noise reduction (STFT) on an adaptive noise floor or a learned noise profile, with listen; ~32 ms latency.                    |
| Utility      | Gain, constant-power pan, stereo width, mute, per-channel polarity and a momentary/short-term loudness bar.                            |
| Bass Booster | Low shelf boost plus a harmonic enhancer that suggests bass on small speakers, optional rumble filter and mono bass.                   |

### Analyzers

Analyzers are pass-through modules: insert them anywhere in the chain to see the signal at
that point (for example one before and one after the EQ).

| Analyzer     | What it shows                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Spectrum     | 2k–8k point FFT of mono, left, right, mid or side, with tilt, smoothing, peak hold, freeze and a hover readout. |
| Spectrogram  | Scrolling time-frequency image with adjustable floor/ceiling, tilt and Magma, Ice or Mono palettes.             |
| Stereo Image | Goniometer with persistence and auto zoom next to the image by frequency; correlation, balance and width.       |
| Loudness     | EBU R128 meter: momentary, short-term, gated integrated loudness, loudness range and 4× oversampled true peak.  |

The Loudness analyzer follows ITU-R BS.1770-4 and EBU Tech 3341/3342 (K-weighting, 400 ms gating
blocks with absolute and relative gates, short-term values for the range). Integrated loudness,
range and the maxima cover everything played through the rack since the last **Reset**; the
history shows the last minute against a target (−14, −16, −23 or −24 LUFS, or any value).

The chain can be reordered by dragging slots, each effect can be bypassed (with a short
crossfade), and the whole rack can be bypassed for comparison. Factory presets are included;
your own presets can be saved, exported and imported as JSON, and put in any order by dragging
them in the preset menu (or with Alt+↑/↓). Saving over a preset keeps its place.

The header has two rows. The first holds the **Process tab** button with the tab's title, the
**This tab / All tabs** switch and the window buttons (dock in the side panel, open in a larger
window). The second holds the preset menu with its save, export and import buttons, **Add**, and
the bypass button for the whole rack at the end.

### Parallel groups

Add **Parallel** from the “+ Add” menu to split the signal into two to four branches. Every branch
receives the same input, runs its own serial chain and is summed back; an empty branch carries
the dry signal (a compressor next to it gives parallel compression). Selecting the group shows a
small mixer: per branch a fader with a post-fader meter, pan, mute, solo and polarity invert, plus
a meter of the sum. Drag effects into, out of and between branches, or use a branch's own “+”. Branches are
delay-compensated, so lookahead (the limiter) does not comb-filter against the other branches, and
bypassing an effect keeps its latency. Groups do not nest. The rack holds up to 16 effects in
total and up to four groups.

### Per-tab racks

The **This tab / All tabs** switch in the header decides which rack a tab plays through. By
default each tab has its own rack: the first time a tab is opened or processed, it gets a copy of
the shared rack, which then changes independently. Tab racks live in `chrome.storage.session` and
are removed when the tab closes. **All tabs** makes the tab follow the shared rack (stored in
`chrome.storage.local`, and the starting point for new tabs) and discards its own rack. The switch
is not shown in demo mode.

### Accent colors

Every effect and group has an accent color for its chain slot, panel and graphs. Click the color
dot in front of its name to pick another one from the palette, the color picker or a hex code;
**Default** restores the original. Colors belong to each item in the chain, so two equalizers
can have different colors, and they are saved with the rack and in presets.

### Pop-out windows

The pop-out button in an effect's or group's header opens it in a window of its own, so several
can be watched side by side: the spectrogram next to the compressor, say. Pop-out windows edit
the same rack as the main window and follow its changes, have their own **Bypass** toggle, and
come back to life when processing is started from another window. Pressing the button again
focuses the open window. Pop-out windows exist only in the extension, not in demo mode.

### Side panel

The side panel button in the rack header docks the tab's rack in Chrome's side panel, next to the
page. The panel belongs to that tab: it hides when you switch to another tab and comes back when
you return. In a narrow panel the header keeps its two rows (with only the logo and a **+** for
Add), controls wrap and the master meters move below the rack. The pop-out button in the panel moves the rack to a window and closes the panel.

The pin button in an effect's or group's header keeps it open in the panel. Open panels follow
the chain strip: left to right, and a parallel group before the effects of its branches, top to
bottom. Each keeps its own height, also when it is the only one open, and the panel scrolls.
Picking an item in the strip scrolls to its panel; an item that is not pinned opens in its place
among the pinned ones and closes again when another item is picked. The chain strip
stays at the top while the panel scrolls. Pins belong to the tab and are forgotten when it
closes.

Presets you save and racks you export keep the tab's pins (exported files have an optional `pins`
list of item ids). Loading one restores them, also in an open side panel when the preset is
loaded from the popup; factory presets and presets without pins clear them.

### Controls

- **Knobs:** drag vertically (Shift for fine), mouse wheel, arrow keys; double-click resets;
  click the value to type one (`2.5k`, `-6`, …).
- **EQ display:** double-click to add a band, drag a point's center for frequency/gain (Shift
  locks gain) and its ring for Q, right-click to delete, Alt-click to toggle.
- **Nodes:** many displays have nodes that set three things at once. Drag the center of a node
  to move it for two of them; drag its ring up or down, like a knob, for the third. The ring
  lights up under the pointer, fills a full circle at the maximum, and for settings that can go
  negative turns half a circle each way from the top: clockwise for positive, counterclockwise
  for negative values. Dotted guides run from the node to where its settings read off the
  display, and each can be dragged for its own setting: the one across up and down, the one
  down sideways; they light up under the pointer like the dashed lines. Shift drags in fine
  steps; double-click the center to reset all three, the ring or a guide to reset its own
  setting. The mouse wheel turns the ring too, except in the side panel, where
  it only scrolls the panel.
    - Compressor (on the threshold line): up or down for the threshold, sideways for the
      ratio (1:1 at the left, ∞ at the right), ring for the knee. Its guide across drags the
      threshold, the one through it from top to bottom the ratio.
    - Gate (on its transfer curve, where it opens): sideways for the threshold, down for more
      range, ring for the hysteresis. Its guide through the node from top to bottom drags the
      threshold, the one across the range, and the one where the gate closes the hysteresis.
    - Multiband (one per band): up for the threshold, sideways for the ratio, ring for the
      makeup gain.
    - Saturator (one per band): up for drive, sideways for tone (left darker, right brighter),
      ring for dynamics.
    - Bass Booster: frequency and boost, ring for the harmonics.
    - De-esser: sideways for the frequency, down for more range, ring for the threshold.
    - Filter: cutoff and resonance, ring for drive.
    - Utility (on the sound stage): sideways for the pan, up for a wider image (mono at the
      floor, 200% at the top), ring for the gain (half circles, boost clockwise and cut
      counterclockwise).
- **Lines:** the dashed threshold, ceiling, target and limit lines can be dragged too. They
  light up when the pointer is over them, and drag the same way:
    - Compressor, Gate and Limiter: the threshold or ceiling line of the level history; the
      compressor's curve above the threshold for the ratio.
    - Multiband and Saturator: the crossover handles; click a band to edit it. The saturator's
      curve plot drags the drive.
    - Denoiser: the dashed line for the largest reduction and the pass curve above the noise
      floor for the threshold.
    - Loudness: the target line.

## How it works

```
popup / window (React UI) ──messages──▶ service worker ──▶ offscreen document
        ▲                                (tabCapture)        getUserMedia(tab)
        └────────── telemetry port (meters + spectrum, 30 fps) ──┘   │
                                                                     ▼
                                       MediaStreamSource ─▶ AudioWorklet (effect chain) ─▶ speakers
                                                    └─▶ AnalyserNode (pre)     └─▶ AnalyserNode (post)
```

- `src/dsp` contains host-independent DSP kernels (RBJ biquads, Butterworth/Linkwitz-Riley
  filters, log-domain dynamics, lookahead limiter). They run inside one AudioWorklet that
  executes the whole chain, so reordering does not rewire the audio graph. The chain is a tree
  of stages (`stage.ts`: effect, bypass crossfade, serial chain; `parallel.ts`: parallel group)
  that `pool.ts` rebuilds on every rack change, keeping each effect's state by id.
- The offscreen document keeps the shared rack and each tab's own rack (`src/offscreen/routing.ts`);
  the UI sends rack updates tagged with its tab and scope.
- `src/engine` wires the worklet and analysers; the same graph powers the extension's
  offscreen document and the in-page demo mode.
- `src/shared` holds the rack model, validation of stored/imported state, presets and
  messaging types. `src/ui` is the React interface; `src/ui/display` holds what the editable
  displays share: pointer handling (`pointer.ts`), hit tests and handles (`handles.ts`), the
  drawing of nodes, guides and lines (`draw.ts`), the transfer-curve scale (`transfer.ts`) and
  the control node (`node.ts`). Every three-setting node is a `ControlNode`: a display gives its
  position, how a new position maps to its settings, its ring and how far its guides reach, and
  `nodeHandle` and `drawControlNode` do the rest, the same way everywhere.

## Development

Requires Node.js 24.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves the UI at `http://127.0.0.1:5173/rack.html` in **demo mode**: outside the
extension the rack runs in the page itself with a generated drum & bass demo track, or with a local audio file
via “Load audio…”. Add `?panel=side` (`rack.html?panel=side`) to preview the side panel layout,
pins included, in a narrow window.

```bash
npm run build
```

Then load `dist/` in `chrome://extensions` (Developer mode → Load unpacked). Open the toolbar
popup on a tab that plays audio and press **Process tab**. Use the pop-out button for a
larger window.

Other scripts: `npm test` (Vitest DSP and state tests), `npm run check` (TypeScript),
`npm run format` / `format:check` (Prettier), `npm run package` (zip `dist/` into `release/`),
`npm run icons` (regenerate `public/icons`).

## Website

`site/` holds the GitHub Pages site: a landing page, the privacy policy (rendered from
`PRIVACY.md` at build time) and screenshots. Every picture, one per module plus the side panel,
is captured with the store screenshots by `npm run store:assets` from
[`site/screenshot-rack.json`](site/screenshot-rack.json) (see [`store/`](store/README.md)). `npm run site` builds it into `site-dist/`,
including the in-browser demo (`vite build --mode demo`, the rack UI with relative URLs).
`npm run site:preview` serves the result locally.

`.github/workflows/pages.yml` deploys it on pushes to `main` that touch the site, the app
sources or `PRIVACY.md`. One-time setup: in the repository's **Settings → Pages**, set
**Source** to **GitHub Actions**.

## Releasing to the Chrome Web Store

`.github/workflows/ci.yml` checks formatting, types and tests, builds, and uploads the zip as an
artifact on every push and pull request.

`.github/workflows/release.yml` runs on tags matching `v*.*.*` (and manually). It verifies that the
tag matches `package.json`, builds, uploads the package with the Chrome Web Store API v2,
submits it for review and creates a GitHub release with the zip.

One-time setup:

1. Create the store item and publish the first version manually in the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole); the API cannot create
   new items. Everything the listing asks for is in [`store/`](store/README.md): the
   description, privacy answers, icon, screenshots and promo tiles.
2. In Google Cloud, enable the Chrome Web Store API and create an OAuth client, then obtain a
   refresh token for the `https://www.googleapis.com/auth/chromewebstore` scope (see
   [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)).
3. In the GitHub repository create an environment named `chrome-web-store` (add required
   reviewers if you want a manual gate) with:
    - secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`
    - variables `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`

To release, bump the version and push the tag:

```bash
npm version patch
```

```bash
git push --follow-tags
```

Running the workflow manually with “Submit for review” unchecked uploads a draft only.

## Privacy

AudioRack processes audio locally, makes no network requests and stores only your rack and
presets. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
