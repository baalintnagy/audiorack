# AudioRack

A Chrome extension that routes the audio of a browser tab through a configurable chain of
effects, with a dark, analyzer-driven interface inspired by modern plug-in suites.

## Effects

| Effect       | What it does                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Equalizer    | Up to 12 bands (bell, shelves, 12–48 dB/oct cuts, notch, band pass) edited directly on the live pre/post spectrum.   |
| Compressor   | Feed-forward soft-knee compressor with peak/RMS detection, sidechain high-pass, auto makeup and parallel mix.        |
| Limiter      | Lookahead brickwall limiter; the output never exceeds the ceiling.                                                   |
| Multiband    | 2–4 band compressor on phase-compensated Linkwitz-Riley crossovers, with solo/mute/bypass per band.                  |
| Filter       | Resonant LP/HP/BP/notch filter with drive and a sine/triangle LFO on the cutoff.                                     |
| De-esser     | Band-pass sidechain detector, split-band or wideband reduction, and a listen mode.                                   |
| Volume       | Gain, constant-power pan, stereo width and per-channel polarity.                                                     |
| Bass Booster | Low shelf boost plus a harmonic enhancer that suggests bass on small speakers, optional rumble filter and mono bass. |

### Analyzers

Analyzers are pass-through modules: insert them anywhere in the chain to see the signal at
that point (for example one before and one after the EQ).

| Analyzer     | What it shows                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Spectrum     | 2k–8k point FFT of mono, left, right, mid or side, with tilt, smoothing, peak hold, freeze and a hover readout. |
| Spectrogram  | Scrolling time-frequency image with adjustable floor/ceiling, tilt and Magma, Ice or Mono palettes.             |
| Stereo Image | Goniometer with persistence and auto zoom, plus phase correlation, balance and side/mid width meters.           |

The chain can be reordered by dragging slots, each effect can be bypassed (with a short
crossfade), and the whole rack can be bypassed for comparison. Factory presets are included;
your own presets can be saved, exported and imported as JSON.

### Controls

- **Knobs:** drag vertically (Shift for fine), mouse wheel, arrow keys; double-click resets;
  click the value to type one (`2.5k`, `-6`, …).
- **EQ display:** double-click to add a band, drag nodes for frequency/gain (Shift locks gain),
  wheel for Q, right-click to delete, Alt-click to toggle.
- **Multiband display:** drag crossover handles; click a band to edit it.

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
  executes the whole chain, so reordering does not rewire the audio graph.
- `src/engine` wires the worklet and analysers; the same graph powers the extension's
  offscreen document and the in-page demo mode.
- `src/shared` holds the rack model, validation of stored/imported state, presets and
  messaging types. `src/ui` is the React interface.

## Development

Requires Node.js 24.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves the UI at `http://127.0.0.1:5173/rack.html` in **demo mode**: outside the
extension the rack runs in the page itself with a generated groove, or with a local audio file
via “Load audio…”.

```bash
npm run build
```

Then load `dist/` in `chrome://extensions` (Developer mode → Load unpacked). Open the toolbar
popup on a tab that plays audio and press **Process tab**. Use the pop-out button for a
larger window.

Other scripts: `npm test` (Vitest DSP and state tests), `npm run check` (TypeScript),
`npm run format` / `format:check` (Prettier), `npm run package` (zip `dist/` into `release/`),
`npm run icons` (regenerate `public/icons`).

## Releasing to the Chrome Web Store

`.github/workflows/ci.yml` checks formatting, types and tests, builds, and uploads the zip as an
artifact on every push and pull request.

`.github/workflows/release.yml` runs on tags matching `v*.*.*` (and manually). It verifies that the
tag matches `package.json`, builds, uploads the package with the Chrome Web Store API v2,
submits it for review and creates a GitHub release with the zip.

One-time setup:

1. Create the store item and publish the first version manually in the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole); the API cannot create
   new items.
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

## License

[MIT](LICENSE)
