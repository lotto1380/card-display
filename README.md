# Card Display

Photograph a physical game card, turn it into a 300 × 400 four-color image, and
put it on a Santek EZ Sign e-paper display.

Two apps share one output contract:

| Folder    | What it is                                                           | Runs on                     |
|-----------|----------------------------------------------------------------------|-----------------------------|
| `web/`    | Web app (PWA). No build step. Deploys to GitHub Pages automatically. | Any phone browser, installable |
| `mobile/` | Flutter app, v0.2.0.                                                 | Android, iPhone (Mac needed to build iOS) |

Nothing in either app fetches, bundles, or links to card images or card text from
anywhere. The only images are the ones the user photographs. Text recognition
runs on the device.

## Output contract

- Portrait **300 × 400**, opaque RGB PNG.
- Only four exact colors: black `(0,0,0)`, white `(255,255,255)`, red `(255,0,0)`, yellow `(255,255,0)`.
- Photos: detect the card → straighten → trim black border → cover-fit 3:4 (fallback:
  center-crop) → resize → Floyd–Steinberg dither.
- Copy Card (text only): rendered, then every pixel snapped to the nearest palette color.
- Optional rotated export, 400 × 300, for a landscape display.

Both apps' tests assert this contract on their outputs.

## Web app (`web/`)

Features: game pick (MTG / SWU / Other), live camera with a 3:4 alignment frame
(camera-app and photo-library fallbacks), auto-crop (find the card, straighten it,
trim a black border), glare and blur warnings, on-device OCR
(Tesseract.js, English, vendored so it works offline), editable name / type /
game text / P/T, correction memory keyed by card name, encrypted local library
(IndexedDB + AES-GCM, non-extractable key), search and recents, two-photo text-only
Copy Card, Send-to-app (Web Share) and Download export, rotate for landscape
(on by default, choice remembered), smooth library thumbnails, installable PWA with
offline support.

### Photo pipeline

`preparePhoto` in `pipeline.js` runs **detect → trim → fit → dither**:

1. `detectCard` downscales to ~480 px, takes the median color of the outer 4% as
   the background, masks pixels that differ from it, cleans the mask (3×3 open and
   close), and keeps the largest connected component. Its corners are the extremes
   of x+y and x−y. It is accepted only if it is at least 15% of the frame, does not
   touch the frame edge, is convex, and has a long/short ratio between 1.15 and
   1.65. A landscape match is also rejected when three or more other marks sit
   around it (that is the art box of a card filling the frame, not a card on a
   table). The photo is then perspective-warped to a straight 900 × 1200 card, or
   1200 × 900 for a landscape card (SWU leaders and bases).
2. `trimBorder` removes a solid dark frame (rows/columns ≥ 92% with luminance < 64),
   at most 12% per side, nothing if under 1.5% (borderless cards), and gives back a
   1.5% margin so art that bleeds into the frame is kept. A landscape card is then
   turned 90° counterclockwise, so it is upright on a landscape badge after the
   Rotate 90° export.
3. `fitToCard` crops the long axis to 3:4 by at most 4%; any remaining mismatch is
   letterboxed in white, never stretched.
4. Resize to 300 × 400 and Floyd–Steinberg dither (unchanged).

If no card is found, the photo is center-cropped as before. The review screen has a
**Crop: Auto / Full frame** control; Auto is the default when a card was found.
OCR reads the straightened card when there is one. Detection is written from
scratch (no OpenCV). The Flutter app still center-crops.

### Copy card from two photos

**Copy card** in the library is a three-step flow:

1. Scan the copying card (camera + sleeve sheet, OCR, editable name and game text).
2. Scan the card being copied (editable name, type line, game text, P/T).
3. Review: `mergeCopy(copier, target)` starts from the copied card and applies the
   copier's "copy of … except …" clause: added subtypes or card types, legendary
   added or removed, quoted abilities, keywords, +N/+N or +1/+1 counters (shown as
   "2/2 (+1/+1)"), a new name, a color. Anything it does not recognize is appended
   as "Except: …" so nothing is lost. Every field stays editable, with a live
   text-only preview.

Saved copies have `isCopy: true`, `sourceCardName` (the copier) and
`copiedCardName` (the target). Any card can carry `pt`, shown on the final screen
and in the bottom-right of a text card. OCR finds it from a `2/2` line anywhere, or
from a short last line where the slash was misread (`212` → `2/2`, `10110` →
`10/10`). When a card was detected, a second single-line pass reads the
bottom-right corner (bottom 12%, right 35%, 2×) and its P/T wins.
These are optional record fields, so the IndexedDB version is unchanged.

### Run locally

```sh
cd web
npm install          # Playwright, for the tests and icons only
npm run serve        # http://localhost:8080
npm test             # headless Chromium: output contract, storage, OCR, UI flow
```

To try it on a phone, serve over HTTPS or use a tunnel; the camera and Web Share
APIs need a secure origin. `localhost` counts as secure on the same machine.

### Deploy

Push to `main`. `.github/workflows/pages.yml` publishes `web/` to GitHub Pages.
One-time setup in the repo: **Settings → Pages → Source: GitHub Actions**.

### Vendored files

`web/vendor/tesseract/` holds Tesseract.js 6.0.1 (`tesseract.min.js`,
`worker.min.js`) and the two LSTM cores from tesseract.js-core 6.0.0 (SIMD and
non-SIMD). `web/vendor/tessdata/eng.traineddata.gz` is the `4.0.0_best_int`
English model from `@tesseract.js-data/eng`. Licenses are alongside. The worker
is created with OEM 1 (LSTM only), which is why only the LSTM cores are shipped.

### Putting an image on the display

1. Final screen → **Send to EZ Sign app** (share sheet) or **Download PNG**. On a
   phone you can also press and hold the image and save it to Photos.
2. Open the Santek EZ Sign app and choose the image.
3. Hold the phone on the display until it refreshes.

Direct NFC transfer from the browser is not possible: the display uses ISO-DEP
APDU transfer, Web NFC is NDEF-only, and iOS has no Web NFC. `transfer.nfc` in
`app.js` is the slot for a native adapter (Capacitor plugin around the Santek
SDK) later.

### Not possible on the web

- No equivalent of Android `FLAG_SECURE`; screenshots cannot be blocked.
- No NFC (see above).

## Mobile app (`mobile/`)

See `mobile/README.md`. Changes in this repo on top of the v0.2.0 drop:

- iOS Keychain key is `first_unlock_this_device`, so an iCloud backup of the
  encrypted images cannot be read on another device (`secure_card_store.dart`).
- `NSMicrophoneUsageDescription` added to `Info.plist` (the camera plugin links
  audio APIs; App Review requires the purpose string even with audio disabled).
- `setup_windows.ps1` also regenerates the iOS platform files when `ios/Runner`
  is missing, so a machine that ran v0.1.0 does not fail on the copy step.

These edits were made without a Flutter toolchain available; run the setup script
and `flutter analyze` before relying on them.
