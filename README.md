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
- Photos: center-crop to 3:4, resize, Floyd–Steinberg error diffusion to the palette.
- Copy Card (text only): rendered, then every pixel snapped to the nearest palette color.
- Optional rotated export, 400 × 300, for a landscape display.

Both apps' tests assert this contract on their outputs.

## Web app (`web/`)

Features: game pick (MTG / SWU / Other), live camera with a 3:4 alignment frame
(camera-app and photo-library fallbacks), glare and blur warnings, on-device OCR
(Tesseract.js, English, vendored so it works offline), editable name / type /
game text, correction memory keyed by card name, encrypted local library
(IndexedDB + AES-GCM, non-extractable key), search and recents, text-only Copy
Card builder, Send-to-app (Web Share) and Download export, rotate for landscape,
installable PWA with offline support.

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
