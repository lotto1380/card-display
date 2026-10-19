$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
    throw "Flutter is not available in this PowerShell window. Open the Flutter terminal and run this script again."
}

if (-not (Test-Path "android\gradlew.bat") -or -not (Test-Path "android\gradle\wrapper\gradle-wrapper.jar") -or -not (Test-Path "ios\Runner")) {
    Write-Host "Completing the generated Android and iOS platform files..."
    flutter create --platforms=android,ios --org com.carddisplay --project-name card_display .
}

$activityFolder = "android\app\src\main\kotlin\com\carddisplay\app"
New-Item -ItemType Directory -Force -Path $activityFolder | Out-Null
Copy-Item "tooling\MainActivity.secure.kt" "$activityFolder\MainActivity.kt" -Force
Copy-Item "tooling\AndroidManifest.card_display.xml" "android\app\src\main\AndroidManifest.xml" -Force
Copy-Item "tooling\app_build.card_display.gradle.kts" "android\app\build.gradle.kts" -Force
Copy-Item "tooling\AppDelegate.card_display.swift" "ios\Runner\AppDelegate.swift" -Force
Copy-Item "tooling\Info.card_display.plist" "ios\Runner\Info.plist" -Force
Copy-Item "tooling\Podfile.card_display" "ios\Podfile" -Force

flutter pub get
flutter analyze
flutter test

Write-Host ""
Write-Host "Card Display is ready. Connect an Android phone with USB debugging and run:"
Write-Host "flutter run"
Write-Host "The iPhone project is included, but iOS compilation and signing require a Mac with Xcode."
