# Card Display — guidance for Claude Code

Photograph a physical game card, turn it into a 300 × 400 four-color image, and
put it on a Santek EZ Sign e-paper display. Two apps, one output contract.

## Hard rules (legal posture — never deviate)

- The apps never fetch, bundle, embed, search for, or link to card images or
  card text from any source. No Scryfall, no SWUDB, no web search, no sample
  cards, no card-name presets, no example images in the repo. The only images
  are the ones the user photographs or uploads in the moment.
- No network calls except the app's own static assets and Google Fonts. Nothing
  the user captures leaves the device. OCR runs on the device.
- Marketing/compat wording: the apps may say they work with MTG and SWU cards
  (nominative use) but never use publisher logos, art, or card-specific features.
- Keep the copy "Your cards stay on this device unless you export one."

## Output contract (both apps' tests assert this)

- Portrait 300 × 400, opaque RGB PNG.
- Only four exact colors: (0,0,0), (255,255,255), (255,0,0), (255,255,0).
- Photos: detect the card → straighten → trim black border → cover-fit 3:4
  (fallback: center-crop) → resize → Floyd–Steinberg dither to the palette (weights 7/16, 3/16, 5/16, 1/16; nearest color by 0.30/0.59/0.11
  weighted squared distance; clamp 0–255 before quantizing; row-major scan).
- Copy Card (text only): rendered, then every pixel snapped to nearest palette color.
- Optional rotated export 400 × 300 for a landscape display.
- `web/pipeline.js` `ditherFourColors` and `mobile/lib/src/services/image_processor.dart`
  `_ditherToFourColors` must stay equivalent. Change one, change both.

## Layout

- `web/` — the web app. Vanilla HTML/CSS/JS, no build step, no framework.
  `index.html`, `styles.css`, four plain scripts loaded in this order (no
  bundler, no modules, each an IIFE that sets one namespace on `window`):
  `pipeline.js` (`CDPipeline`: dither, detect, trim, fit, OCR image prep, text
  card), `ocr.js` (`CDOcr`: Tesseract wrapper, `parseOcrText`, `mergeCopy`),
  `storage.js` (`CDStorage`: IndexedDB, crypto, `repo`), `app.js` (UI only),
  then `sw.js`, `manifest.webmanifest`,
  `vendor/` (Tesseract.js 6.0.1 + LSTM cores + English model, vendored so OCR
  works offline), `test/verify.mjs` (Playwright, headless Chromium).
- `mobile/` — Flutter app v0.2.0 (Android + iOS). See `mobile/README.md`.
- `.github/workflows/pages.yml` — deploys `web/` to GitHub Pages on push to `main`.

## Commands

```sh
cd web && npm install && npm test      # 68 checks: contract, auto-crop, storage, OCR parse + P/T, copy merge, live OCR, UI flows
cd web && npm run serve                 # http://localhost:8080
cd web && npm run icons                 # regenerate icons/ with headless Chromium
```

`npm test` must pass before any push. If Playwright's Chromium is missing:
`npx playwright install chromium`.

## Web app conventions

- Photo pipeline: `detectCard` → `trimBorder` → `fitToCard` → resize + dither, with
  the center crop as fallback and as the review screen's "Full frame" option. The
  detector is from scratch (no OpenCV); its thresholds are in `DETECT` / `TRIM`.
  Landscape cards warp to 1200×900, trim, then turn counterclockwise to portrait.
  Only the web app does this; mobile still center-crops.
- Copy Card is two scans plus a review (`copystep` screen for steps 1–2, `copy` for
  step 3). `mergeCopy` applies the except clause through `copyPatterns`, one small
  function per pattern, each unit-tested; unrecognized text goes to `notes`.
- Card records carry optional `pt` and `copiedCardName` (0.4.0). Optional fields
  need no IDB version bump; changing the shape of existing fields does.
- Library thumbnails are 96×128, smoothly downscaled and cached per record id for
  the session (not pixelated); the final preview stays pixelated, as on the badge.
  Rotate 90° defaults to on (landscape badge); the user's choice is remembered in
  localStorage (`card_display.rotate`) and overrides that.
- Sections inside each script are marked with banner comments. A new script must
  be added to `index.html` (in dependency order) and to `SHELL` in `sw.js`.
  `app.js` reads other scripts only through their namespaces, destructured at
  its top.
- Screens are `<section id="screen-*">` toggled with the `hidden` attribute via
  `show()`. New screens: add the id to the `screens` array.
- Export goes through the `transfer` adapters (`share`, `download`). `transfer.nfc`
  is the slot for a native Santek SDK adapter (Capacitor plugin) later; do not
  attempt Web NFC — the display needs ISO-DEP APDU and iOS has no Web NFC.
- Storage: IndexedDB `card_display` v1 (stores `cards`, `corrections`, `keys`).
  Images are AES-GCM encrypted with a non-extractable CryptoKey kept in IDB.
  Payload: version byte (1 = encrypted, 0 = plain) + 12-byte nonce + ciphertext.
  Bump the IDB version and write a migration if the record shape changes.
- `window.__cardDisplay` exposes internals for `test/verify.mjs` only.
- Every color is a CSS token on `:root`; dark theme is a token override. No
  literal colors in component rules except the four palette swatches.
- Confirmations are in-page (two-tap buttons), never `alert`/`confirm`.

## Mobile notes

- No Flutter toolchain was available when the three post-v0.2.0 fixes were made
  (Keychain `first_unlock_this_device`, `NSMicrophoneUsageDescription`, Windows
  script iOS guard). Run `setup_windows.ps1` / `setup_macos.sh` and
  `flutter analyze` before trusting them.
- Android: `FLAG_SECURE` on every screen. iOS: privacy cover only (no screenshot block).

## Known gaps

- Web: no screenshot blocking; no NFC (hand the PNG to the Santek app via share/download).
- Both: direct NFC transfer waits on the Santek SDK (iOS/Android, BMP input at
  the panel's pixel size; the app does resize + dither).

## Git

- Commit small, with a one-line summary and a short body. Do not rewrite history on `main`.
- History was squashed once on 2026-10-19 to remove test fixture text; do not rewrite history again.
