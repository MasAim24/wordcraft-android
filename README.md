# 📝 WordCraft for Android

[![Build WordCraft Android APK](https://github.com/MasAim24/wordcraft-android/actions/workflows/build-apk.yml/badge.svg)](https://github.com/MasAim24/wordcraft-android/actions/workflows/build-apk.yml)
[![Latest Release](https://img.shields.io/github/v/release/MasAim24/wordcraft-android?label=Release&color=blue)](https://github.com/MasAim24/wordcraft-android/releases/latest)
[![WordCraft Version](https://img.shields.io/badge/WordCraft-v0.11.0-emerald)](https://github.com/storytold/wordcraft)
[![Platform](https://img.shields.io/badge/Platform-Android%20(Capacitor%207)-3DDC84?logo=android&logoColor=white)](https://capacitorjs.com/)

**WordCraft for Android** packages [**WordCraft**](https://github.com/storytold/wordcraft) — a fast, offline-first word processor built in pure **Rust (`egui` + WebAssembly)** — into a native Android APK powered by **Capacitor 7** and a custom **Native Android Java Bridge**.

---

## 📥 Download APK

| Release | Version | Size | Direct Download |
| :--- | :--- | :--- | :--- |
| **WordCraft Android APK** | `v0.11.0-android` | ~23.5 MB | [**⬇️ Download WordCraft-v0.11.0.apk**](https://github.com/MasAim24/wordcraft-android/releases/download/v0.11.0-android/WordCraft-v0.11.0.apk) |

> **Installation Note:** Download the `.apk` file on your Android phone or tablet and allow installation from your browser or file manager when prompted. Works 100% offline once installed.

---

## ✨ Key Android Features & Enhancements

Standard WebAssembly apps running inside an Android WebView often struggle with file saving, file pickers, printing, clipboard access, and high-DPI screen scaling. This repository bridges the gap between WordCraft's Rust/WASM engine and Native Android APIs:

### 1. 💾 Native File Saving, "Save As", & Sharing (`WordCraftNativeBridge`)
- **Auto-Save to Downloads:** Saving or exporting any document (`.docx`, `.pdf`, `.odt`, `.rtf`, `.md`, `.txt`, `.html`, `.png`) automatically writes the file directly to `/sdcard/Download/WordCraft/` via Android's `MediaStore` / `Environment` API.
- **Interactive Action Toast:** Whenever a file is saved or exported, an on-screen floating action bar lets you:
  - **📁 Pilih Folder (Save As):** Opens the native Android system folder/file picker (`Intent.ACTION_CREATE_DOCUMENT`) to save anywhere on internal storage, SD card, or Google Drive.
  - **📤 Bagikan / Buka:** Opens the native Android Share sheet (`FileProvider` + `Intent.ACTION_SEND`) to send via WhatsApp, Telegram, Email, or open directly in another office/PDF viewer app.

### 2. 📂 Fixed Android File Open & Image Picker
- Android's `ACTION_GET_CONTENT` file picker grays out `.docx` files when an HTML `<input type="file" accept=".docx,...">` uses file extensions instead of MIME types.
- The injected mobile bridge automatically normalizes file input attributes so **File → Open**, **Insert → Picture**, and **Add Font** work seamlessly across all Android file managers.

### 3. 🖨️ Native PDF Print Interception
- Intercepts **File → Print** (`#wordcraft-print-frame` PDF blob generation) and routes the generated PDF directly to the native Android save/share handler as `Document-Print.pdf`.

### 4. 📋 Native Android Clipboard Bridge
- Bridges `navigator.clipboard.writeText` and `navigator.clipboard.readText` directly to Android's native `ClipboardManager` so copying and pasting text between WordCraft and other Android apps works reliably.

### 5. 🕌 Pre-Bundled Arabic & RTL Fonts
- Pre-packages and automatically seeds **`NotoSansArabic-Regular.ttf`**, **`Amiri-Regular.ttf`**, and **`Amiri-Bold.ttf`** into WordCraft's IndexedDB font store (`wordcraft` → `fonts`) before the WebAssembly module initializes.
- Enables out-of-the-box Arabic script rendering and right-to-left (RTL) typography without requiring manual font downloads.

### 6. 📱 Mobile Floating Quick-Control Pill & Immersive Mode
- **Immersive Fullscreen Mode:** Automatically hides Android status and navigation bars (`WindowInsetsController` / `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`) to maximize editing workspace.
- **Floating Control Pill** (bottom-right corner, collapsible):
  - **⌨️ Ketik:** Forces soft-keyboard focus onto the `egui` text input agent (`#egui_text_agent`).
  - **🔍 UI Scale (`65%` / `80%` / `90%` / `100%`):** Calibrates `egui` DPI scaling (`wordcraft.ui`) so menus, ribbons, and dialogs fit comfortably on high-DPI mobile screens.
  - **⬇️ Top Safe Bar (`0px` / `28px` / `42px`):** Adds an adjustable top safe margin so top menu items (**File**, **Edit**, **View**, **Insert**, **Format**, **Tools**) are never blocked by camera cutouts or system swipe zones.

---

## 🏗️ Architecture & Project Structure

```text
wordcraft-android/
├── .github/workflows/
│   └── build-apk.yml          # GitHub Actions CI/CD (Node 22 + Java 21 + Android SDK)
├── scripts/
│   ├── prepare-dist.mjs       # Downloads WordCraft WASM release, bundles Arabic fonts, injects Mobile Bridge v4
│   └── setup-android.mjs      # Patches AndroidManifest.xml & generates MainActivity.java with @JavascriptInterface
├── capacitor.config.json      # Capacitor 7 Android configuration (com.storytold.wordcraft)
└── package.json               # Build scripts and Capacitor dependencies
```

### How the Build Pipeline Works
1. **`pnpm build` (`scripts/prepare-dist.mjs`)**:
   - Downloads the official `wordcraft-web-0.11.0.zip` release from [`storytold/wordcraft`](https://github.com/storytold/wordcraft/releases).
   - Downloads and caches `NotoSansArabic-Regular.ttf`, `Amiri-Regular.ttf`, and `Amiri-Bold.ttf` into `dist/fonts/`.
   - Generates `dist/mobile-bridge.js` (Android Mobile Bridge v4) and injects it into `dist/index.html` alongside font preloading before `wasm` initialization.
2. **Capacitor Sync & Native Patch (`scripts/setup-android.mjs`)**:
   - Runs `npx @capacitor/cli add android` and `npx @capacitor/cli sync android`.
   - Patches `AndroidManifest.xml` with storage permissions, `android:largeHeap="true"`, `android:hardwareAccelerated="true"`, and `android:windowSoftInputMode="adjustResize"`.
   - Writes `MainActivity.java` containing immersive system-bar handling and the `WordCraftNativeBridge` (`window.WordCraftAndroid`) `@JavascriptInterface`.
3. **Gradle Assemble**:
   - Compiles the native Android package via `./gradlew assembleDebug`.

---

## 🛠️ Building Locally or via GitHub Actions

### Option A: GitHub Actions (Recommended)
1. Go to the [**Actions**](https://github.com/MasAim24/wordcraft-android/actions/workflows/build-apk.yml) tab.
2. Select **Build WordCraft Android APK** and click **Run workflow**.
3. Optionally specify a `wordcraft_version` (default: `0.11.0`).
4. Download the compiled `WordCraft-Android-APK` artifact once the workflow completes.

### Option B: Local Build
**Prerequisites:** Node.js 22+, `pnpm`, Java 21 JDK, and Android SDK (`ANDROID_HOME`).

```bash
# 1. Install dependencies
pnpm install

# 2. Download WordCraft WASM bundle, Arabic fonts, and inject mobile bridge
pnpm build

# 3. Initialize Capacitor Android project and apply native Java/Manifest patches
npx @capacitor/cli add android
npx @capacitor/cli sync android
pnpm run setup:android

# 4. Build the APK with Gradle
cd android
./gradlew assembleDebug
```

The resulting APK will be generated at:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🙏 Credits & Upstream

- **WordCraft Core Engine:** Created by [**Storytold (`storytold/wordcraft`)**](https://github.com/storytold/wordcraft) — built in Rust with `egui` and compiled to WebAssembly.
- **Fonts Bundled:** [Noto Sans Arabic](https://fonts.google.com/noto/specimen/Noto+Sans+Arabic) and [Amiri](https://ebrahim.org/amiri/) (SIL Open Font License).
- **Android Packaging & Native Bridge:** Maintained by [@MasAim24](https://github.com/MasAim24).
