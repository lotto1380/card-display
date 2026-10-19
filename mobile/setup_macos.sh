#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter is not available in this terminal." >&2
  exit 1
fi

if [[ ! -f android/gradlew || ! -d ios/Runner.xcodeproj ]]; then
  flutter create --platforms=android,ios --org com.carddisplay --project-name card_display .
fi

mkdir -p android/app/src/main/kotlin/com/carddisplay/app
cp tooling/MainActivity.secure.kt android/app/src/main/kotlin/com/carddisplay/app/MainActivity.kt
cp tooling/AndroidManifest.card_display.xml android/app/src/main/AndroidManifest.xml
cp tooling/app_build.card_display.gradle.kts android/app/build.gradle.kts
cp tooling/AppDelegate.card_display.swift ios/Runner/AppDelegate.swift
cp tooling/Info.card_display.plist ios/Runner/Info.plist
cp tooling/Podfile.card_display ios/Podfile

flutter pub get
flutter analyze
flutter test
flutter build ios --no-codesign

echo "Card Display passed analysis, tests, and an unsigned iOS build."
