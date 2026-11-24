# Chrome Web Store listing

Everything the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) asks for when
creating the AudioRack item, in the order of its tabs. Only the first version is submitted by hand;
later versions go through `.github/workflows/release.yml`, which uploads and submits the package
but never changes the listing. Edit the text and images below in the dashboard.

## Package

Build and zip the extension, then upload `release/audiorack-<version>.zip`:

```bash
npm run build
```

```bash
npm run package
```

## Store listing

| Field              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Title              | `AudioRack` (from the manifest)                                          |
| Summary            | From the manifest `description` (set in `vite.config.ts`, max 132 chars) |
| Description        | Paste [`description.txt`](description.txt)                               |
| Category           | Productivity › Tools (Lifestyle › Entertainment also fits)               |
| Language           | English                                                                  |
| Store icon         | [`icon-128.png`](icon-128.png) (128×128, 96 px artwork, transparent)     |
| Screenshots        | [`screenshots/`](screenshots) (five, 1280×800), in numbered order        |
| Small promo tile   | [`promo/small-tile.jpg`](promo/small-tile.jpg) (440×280)                 |
| Marquee promo tile | [`promo/marquee.jpg`](promo/marquee.jpg) (1400×560, optional)            |
| Global promo video | None                                                                     |
| Official URL       | None (needs a Search Console–verified domain)                            |
| Homepage URL       | `https://baalintnagy.github.io/audiorack/`                               |
| Support URL        | `https://github.com/baalintnagy/audiorack/issues`                        |
| Mature content     | No                                                                       |

Screenshots, in order:

1. `1-equalizer.jpg`: the equalizer curve on a live spectrum
2. `2-compressor.jpg`: compressor transfer curve and gain-reduction history
3. `3-spectrogram.jpg`: spectrogram of the demo track
4. `4-stereo-image.jpg`: stereo scope next to the image by frequency, with correlation, balance
   and width
5. `5-side-panel.jpg`: the rack docked in the side panel next to a video page, with pinned
   effects stacked in chain order

The store accepts at most five screenshots; replace the uploaded set in the dashboard when they
change.

## Privacy

**Single purpose description**

> AudioRack processes the audio of a browser tab that the user chooses through a configurable
> chain of audio effects (equalizer, compressors, limiter, gate, filter, de-esser, denoiser,
> volume and bass booster) and shows audio analyzers for that sound.

**Permission justifications**

| Permission   | Justification                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabCapture` | Captures the audio of the tab the user chooses when they press “Process tab”, so it can be run through the effect chain and played back. This is the extension's core function. Capturing stops when the user presses the button again or closes the tab. |
| `offscreen`  | Runs the audio engine (Web Audio and an AudioWorklet) in an offscreen document, so processing continues after the popup closes. A service worker cannot use Web Audio.                                                                                    |
| `storage`    | Saves the user's effect chain, its settings and their presets on the device, and remembers which tabs are being processed and which effects are pinned in the side panel during the browser session.                                                      |
| `activeTab`  | Identifies the tab the user opened the extension on, so that tab can be captured, and shows its title in the popup. The title is only displayed and never stored.                                                                                         |
| `sidePanel`  | Shows the effect rack in Chrome's side panel when the user presses the side panel button, so they can adjust the effects next to the page they are listening to. The panel is opened only for that tab and shows the same rack as the popup.              |

Host permissions: none requested.

**Remote code**: No, I am not using remote code. All JavaScript is included in the package.

**Data usage**: tick none of the data types. AudioRack collects no personally identifiable
information, health, financial, authentication, personal communication, location, web history,
user activity or website content data. Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: `https://baalintnagy.github.io/audiorack/privacy.html` (generated from
[`PRIVACY.md`](../PRIVACY.md)).

## Distribution

| Field      | Value          |
| ---------- | -------------- |
| Payments   | Free of charge |
| Visibility | Public         |
| Regions    | All regions    |

## Test instructions (optional, for reviewers)

> No account or setup is needed. Open any tab that plays audio (for example a video), click the
> AudioRack toolbar icon and press “Process tab”. The audio now runs through the rack: drag the EQ
> points, change the compressor threshold or press “Bypass” to hear the difference. Press the
> button again to stop. The same interface also runs as a web demo at
> https://baalintnagy.github.io/audiorack/demo/rack.html.

## Regenerating the images

The store icon is rendered with the other icons by `npm run icons`. The screenshots and promo
tiles are captured by:

```bash
npm run store:assets
```

It starts a Vite dev server, opens the rack in a headless Chrome, Brave or Edge (set `CHROME_PATH`
to choose one), loads [`screenshot-rack.json`](screenshot-rack.json), plays the demo track and
captures each editor at 1280×800. The page is dressed as the extension: the demo-only “Load audio”
button is hidden and the status shows a sample tab title. The same run then plays the demo
through [`site/screenshot-rack.json`](../site/screenshot-rack.json), which holds every effect,
analyzer and a parallel group, and saves one 800×600 picture of each module to `site/images/`,
undressed, as the demo looks on the site. The gate, filter, de-esser and denoiser are bypassed in
that rack and switched on for their own pictures; for the denoiser the page plays the demo track
with added hiss and hum. The side panel screenshot is staged by
[`promo/side-panel.html`](promo/side-panel.html): a sample video page with the rack docked in a
600 px panel next to it, three effects pinned and the equalizer picked. The same scene is also
saved at 800×600 as the website's `site/images/side-panel.jpg`. The promo tiles are rendered from
the HTML pages in [`promo/`](promo), and the marquee embeds the first screenshot.
