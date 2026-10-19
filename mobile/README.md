# Card Display — Flutter Mobile MVP

Card Display is a shared Flutter app for Android and iPhone. It photographs a
physical MTG or SWU card, reads its text locally,
lets the user correct the result, converts the image to the Santek four-color
palette, stores the processed output privately, and exports a test PNG for the
Santek EZ Sign app.

## Current MVP features

- MTG and SWU home buttons
- Search and the 10 most recently used cards
- Long-press a saved card to choose among saved versions
- Camera alignment frame and explicit remove-the-sleeve warning
- Basic glare and blur warnings
- On-device Latin OCR with fully editable name, type, and game-text fields
- 300 × 400 portrait four-color PNG output using only exact black, white, red,
  and yellow values
- Text-only Copy Card workflow with no artwork and an extended rules area;
  the copying card can be photographed or found by searching saved cards
- User corrections stored locally and associated with the OCR card name
- Processed card PNGs encrypted in app-private storage
- Android `FLAG_SECURE` protection on every app screen
- iOS privacy cover when the app is backgrounded or screen recording/mirroring
  is detected (iOS does not provide an Android-equivalent screenshot block)
- Confirmed cards exported to the `Card Display` photo album for EZ Sign testing
- Original camera files deleted after a successful confirmation, or when the
  user abandons a scan before confirmation

No Scryfall or SWUDB images or text are bundled with this project.

## Install on the Windows Flutter PC

1. Extract this folder to a short path such as:
   `E:\flutter\dev\card_display`
2. Open PowerShell in that folder.
3. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup_windows.ps1
   ```

   The script fills in standard Android and iOS Flutter platform files if they
   are absent, restores the platform security code, downloads dependencies,
   runs analysis, and runs the included tests.
4. Connect an Android phone with developer mode and USB debugging enabled.
5. Run `flutter run`.

Windows can run and build the Android app. The iPhone source is included, but
Apple requires macOS with Xcode for iOS compilation, device signing, and App
Store submission.

## Install on a Mac for iPhone development

1. Install Flutter, Xcode, and CocoaPods.
2. Extract the project and open Terminal in the project folder.
3. Run `chmod +x setup_macos.sh` and then `./setup_macos.sh`.
4. Open `ios/Runner.xcworkspace` in Xcode to choose the Apple development team
   and run it on an iPhone.

## Deliberate placeholders

- Direct Santek NFC transfer replaces the gallery export after the SDK arrives.
- Sold-device validation requires the SDK's hardware identifier plus a small
  registration service.
- A cloud vision second read can be added behind the OCR service once a provider,
  privacy policy, and API credentials are chosen.
- The current normal-card output uses the photographed card image; edited OCR
  fields are saved for search and correction memory. The Copy Card output is
  rebuilt from the edited fields, so those edits appear directly on its image.
- Android and Apple release signing, store listings, privacy policy, and the
  production package identity must be completed before publishing.

## Output contract

The visible preview is portrait 300 × 400. The future Santek transfer adapter
will rotate that raster to 400 × 300 when required by the device API. PNG output
is opaque RGB and contains only:

- Black: `(0, 0, 0)`
- White: `(255, 255, 255)`
- Red: `(255, 0, 0)`
- Yellow: `(255, 255, 0)`
