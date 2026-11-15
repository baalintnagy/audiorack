# Privacy Policy: AudioRack

_Last updated: 15 November 2026_

AudioRack ("the extension") does **not** collect, transmit, sell or share any personal data.

## Audio processing

When you press **Process tab**, the extension captures the audio of that one tab and runs it through
your effect chain. All processing happens locally on your device, inside the browser. The audio is
played back to you and is never recorded, saved or sent anywhere. The analyzers (spectrum,
spectrogram and stereo image) only draw what is currently playing; their history disappears when
you close the window.

Capturing stops when you press the button again or close the tab. Chrome shows its own indicator
on the tab while it is being captured.

## What the extension stores

The extension uses Chrome's built-in `chrome.storage` API:

- **Your rack**: the effect chain and all of its settings, stored in `chrome.storage.local` on your
  device.
- **Racks of individual tabs**: each tab's own effect chain and settings, or a note that the tab
  follows the shared rack, keyed by the browser's internal numeric tab ID and stored in
  `chrome.storage.session`. It is deleted when the tab closes, and Chrome clears it when the
  browser closes.
- **Your presets**: the names and settings of presets you save, stored in `chrome.storage.local`.
- **Which tabs are being processed**: the browser's internal numeric tab IDs, stored in
  `chrome.storage.session`. Chrome clears this when the browser closes.

Nothing else is stored. In particular, the extension does not store:

- the audio it processes
- the addresses or titles of the pages you visit
- your browsing history
- your account information

## Permissions

- **`tabCapture`**: to capture the audio of the tab you choose to process.
- **`offscreen`**: to run the audio engine in a hidden extension page while the popup is closed.
- **`activeTab`**: to identify the tab you opened the extension on, and to show its title in the
  popup. The title is displayed only and is not stored.
- **`storage`**: to save your rack and presets as described above.

The extension does not read or change the content of any web page.

## Network access

The extension makes **no network requests**. It contains no analytics, tracking or advertising
code, and it does not load remote code.

## Files

**Export** saves a preset as a JSON file through your browser's normal download. **Import** reads
only the file you pick. Neither sends data anywhere.

## Removing your data

Uninstalling the extension deletes all stored data. You can also delete saved presets from the
preset menu at any time.

## Contact

Questions? Open an issue at
[github.com/baalintnagy/audiorack](https://github.com/baalintnagy/audiorack/issues).
