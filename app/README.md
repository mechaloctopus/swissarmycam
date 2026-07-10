# Swiss Army Camera — Android app (Phase 2 shell)

The mobile app for [Swiss Army Camera](../). Built with **Expo + React Native**, this is the
**Phase 2 app shell** from the roadmap on the marketing site: a working camera instrument with
Capture, Timelapse, a Lab preview, and a local-first Library — plus honest, staged placeholders
for the modules that need native code (Studio, Screen, Attachments).

Designed for **Android first** (targeting a Pixel 9 Pro), the code is structured so a
near-identical **iOS** build slots in later with iOS-specific camera work (AVFoundation).

## Get the APK (no build required)

Every push to the app publishes an installable APK to the repo's
[**Releases → `android-latest`**](https://github.com/mechaloctopus/swissarmycam/releases/tag/android-latest).
Download `swiss-army-camera.apk` on your phone and open it (allow "install unknown apps" if asked).

## What works today

| Tab | Status | Notes |
| --- | --- | --- |
| **Capture** | ✅ Works | **Photo + video** modes. Front/rear flip, flash (off/auto/on), **torch**, **continuous zoom slider**, rule-of-thirds / golden / square grid, electronic level (accelerometer), reticle, self-timer. Video honors the mic + resolution settings. Saves in-app + optional auto-save to Photos. |
| **Timelapse** | ✅ Works | Intervalometer (1–60 s), live frame counter, frames saved as a set and **played back** in Library. Frame→MP4 stitching is Phase 3 (native). |
| **Lab** | ✅ Works | Live viewfinder with real overlay guides + look tints. On-sensor GPU pixel analysis is Phase 6 (clearly marked). |
| **Library** | ✅ Works | Local-first grid of **photos + videos**, fullscreen photo viewer, **video player**, **timelapse playback** (8/12/24 fps), **share**, save-to-Photos, delete. |
| **Settings** | ✅ Works | Full **customization hub** — see below — plus honest capability map, privacy, storage usage, reset. |
| **Studio / Screen / Attachments** | 🔧 Staged | Honest "requires native module" screens matching the site's roadmap. |

### Everything is customizable (Settings — persisted across launches)
- **Photo:** aspect ratio (4:3 / 16:9 / 1:1), **picture size** (real device-detected resolutions), JPEG quality.
- **Video:** resolution (2160p / 1080p / 720p / 480p), bitrate, max duration.
- **Audio:** microphone on/off, **mic gain**, feedback volume. *(Input mic-gain is stored now and applies with the native audio pipeline — Phase 5; mic on/off is live today.)*
- **Capture defaults:** flash, grid + grid type, level, reticle, self-timer, auto-save to Photos, haptics.
- **Timelapse:** default interval, output frame rate.
- **Storage:** usage readout + clear all in-app media. Plus reset-to-defaults.

Everything is **local-first / private by default**. "Save to Photos" is an explicit action.

## Run it in development

```bash
cd app
npm install
npx expo start        # then press 'a' for Android, or scan the QR in Expo Go / a dev client
```

Camera features need a real device or emulator with a camera (the web target has no sensor).

## Build the APK locally (optional)

```bash
cd app
npm install
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk  (debug-signed, sideloadable)
```

Requires JDK 17 and the Android SDK. CI does exactly this — see
[`.github/workflows/android.yml`](../.github/workflows/android.yml).

## Tech

- **Expo SDK 57 · React Native 0.86 · TypeScript**
- `expo-camera` (viewfinder + capture), `expo-sensors` (level), `expo-media-library`
  (save to Photos), `expo-file-system` (local-first storage), `react-native-svg` (brand mark),
  `expo-haptics`, `expo-image`, `react-native-safe-area-context`.
- Custom design system in `src/theme.ts` mirroring the website tokens (Swiss black / steel / red).

## Structure

```
app/
├── App.tsx                 # Root: permission gate + tool-drawer tab bar
├── app.json                # Expo config (Android package, permissions, icons)
├── assets/                 # App icon + adaptive icon + splash (generated from the brand mark)
└── src/
    ├── theme.ts            # Design tokens
    ├── store.ts            # Local-first capture/timelapse storage
    ├── media.ts            # Explicit "save to Photos"
    ├── components/         # Mark (logo), ui primitives, viewfinder Overlays
    └── screens/            # Capture, Timelapse, Lab, Library, Settings, ComingSoon
```

## Notes on honesty (same as the site)

Software cannot make a phone sensor see IR/UV/thermal wavelengths it physically rejects — those
need attachments. Manual ISO/shutter/RAW, green-screen compositing, and screen recording need
native modules and are staged, not faked. Screen recording (Phase 5) will be user-consented with
a visible indicator. See the in-app **Settings → Capability map**.
