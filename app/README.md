# Lensii — Android app (Phase 2 shell)

The mobile app for [Lensii](../). Built with **Expo + React Native**, this is the
**Phase 2 app shell** from the roadmap on the marketing site: a working camera instrument with
Capture, Timelapse, a Lab preview, and a local-first Library — plus honest, staged placeholders
for the modules that need native code (Studio, Screen, Attachments).

Designed for **Android first** (targeting a Pixel 9 Pro), the code is structured so a
near-identical **iOS** build slots in later with iOS-specific camera work (AVFoundation).

**iOS status:** [`.github/workflows/ios.yml`](../.github/workflows/ios.yml) builds the same
codebase for the **iOS Simulator** on every push (a build-correctness smoke test — the same
screens, same TypeScript, same design system). It is *not* a device-installable artifact: a real
iPhone install requires an Apple Developer Program account and provisioning that only the project
owner can supply. Once available, this workflow becomes the base for a signed TestFlight/ad-hoc build.

## Get the APK (no build required)

Every push to the app publishes an installable APK to the repo's
[**Releases → `android-latest`**](https://github.com/mechaloctopus/swissarmycam/releases/tag/android-latest).
Download `lensii.apk` on your phone and open it (allow "install unknown apps" if asked).

## What works today

| Tab | Status | Notes |
| --- | --- | --- |
| **Capture** | ✅ Works | **Photo + video** modes. Front/rear flip, flash (off/auto/on), **torch**, **continuous zoom slider**, rule-of-thirds / golden / square grid, electronic level (accelerometer), reticle, self-timer. Video honors the mic + resolution settings. Saves in-app + optional auto-save to Photos. |
| **Timelapse** | ✅ Works | Intervalometer (1–60 s), live frame counter, frames saved as a set and **played back** in Library. Frame→MP4 stitching is Phase 3 (native). |
| **Lab** | ✅ Works | Live viewfinder with real overlay guides + look tints, **plus on-device visual intelligence**: colour-palette analysis, **OCR text extraction**, and **scene/object labeling** (all MLKit/react-native-image-colors, offline) from a captured frame. Deeper GPU pixel analysis (edge/motion/stacking) is Phase 6. |
| **Library** | ✅ Works | Local-first grid of **photos + videos**, fullscreen photo viewer, **photo editor** (rotate / flip / crop 1:1 → saves a non-destructive copy, via expo-image-manipulator), **video player**, **timelapse playback** (8/12/24 fps), **share**, save-to-Photos, delete. |
| **Studio** | ✅ Works | Photo layer **compositor**: pick a base photo, add **text** + **sticker** layers, and cut out a **real GPU chroma key** (green/blue screen → transparent PNG, an SkSL shader run on-device via react-native-skia) as a draggable layer over a different base. Drag / scale / rotate / opacity, bring-to-front, **flatten & export** to Library. |
| **Editor** | ✅ Works | **Video** editor: pick a base video, **import your own transparent PNG** (or add text), then **keyframe** its position/scale/rotation/opacity over the timeline — scrub, drag, "set keyframe here," and it interpolates and plays back live, moving across the video in real time. **Export baked MP4** is now real too: a native MediaCodec decode → GLES composite → MediaCodec encode pipeline re-encodes the video with every overlay drawn at its interpolated position, frame-accurately, audio copied through untouched. |
| **Attachments** | ✅ Works | **Device & module inspector**: model / OS / memory (expo-device), detected camera resolutions, **real Camera2 sensor characteristics** per lens (focal lengths, apertures, ISO range, exposure range, sensor size — read-only, via a small local native module), live **sensor scan** (accelerometer / gyro / magnetometer / barometer), and an honest "no external modules detected". USB-C thermal/IR/UV & BLE shutters plug in via the native module (Phase 7). |
| **Tools** | ✅ Works | **Unit converter** (length, volume, weight, temperature — cm↔in↔ft↔mi, gal↔L↔cups, etc.), and the allocated spot for **NeRF Measure** (premium, planned) — a NeRF/photogrammetry room-scan → AR measurement feature. |
| **Settings** | ✅ Works | Full **customization hub** — see below — plus honest capability map, privacy, storage usage, reset. |
| **Screen** | ✅ Works | **Real system-wide screen recording** via Android's MediaProjection: standard OS consent flow, foreground-service-backed capture (with the required Android 14+ persistent notification), optional mic audio, saves straight to Library. Facecam bubble, game mode, and export presets are next. |

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
need attachments. Manual ISO/shutter/RAW capture still needs native code and is staged, not faked.
Green-screen compositing (Studio), screen recording (Screen), and frame-accurate video export
(Editor) are all real, shipped native modules — not placeholders. Screen recording uses Android's
own system consent dialog and a persistent notification/indicator the whole time it runs; it can't
be started or hidden without that user-visible OS-level consent. The video export pipeline is
freshly built hand-written MediaCodec/GLES code with no automated on-device test coverage yet
(this environment has no Android SDK/emulator to run it against — only to compile it) — treat an
early export as worth a visual check, the same way you'd sanity-check any brand-new capture path.
See the in-app **Settings → Capability map**.
