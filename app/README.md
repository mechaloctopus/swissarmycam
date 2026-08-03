# Lensii — Android app

The mobile app for [Lensii](../). Built with **Expo + React Native**: a working camera
instrument with Capture, a keyframe video Studio, stop-motion, AR tracing, Timelapse and a
local-first Library — plus honest, staged placeholders for the parts that genuinely need
hardware or cloud compute.

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

**Capture and Library are free forever.** Every other tab needs an active 7-day free trial,
$14/month subscription, or a redeemed access code (Settings always stays free too, since that's
where you'd start the trial or enter a code) — see "Selling on Google Play" below.

| Tab | Status | Notes |
| --- | --- | --- |
| **Capture** | ✅ Works | **Photo + video** modes. Front/rear flip, flash (off/auto/on), **torch**, **continuous zoom slider**, rule-of-thirds / golden / square grid, electronic level (accelerometer), reticle, self-timer. Video honors the mic + resolution settings. Saves in-app + optional auto-save to Photos. **Analyze** runs on-device visual intelligence over your last photo — colour palette, **OCR text extraction** and **scene/object labeling** (MLKit, fully offline), folded in from what used to be a separate Lab tab. **Underwater / record lock**: engage manually or auto-engage the moment recording starts — every control except a deliberate 1.2s hold-to-unlock goes dead to touch, so water pressure/droplets on the screen can't stop or change a recording. Screen stays awake for the whole take. |
| **Timelapse** | ✅ Works | Intervalometer (1–60 s), live frame counter, frames saved as a set, **played back** in Library at 8/12/24fps — and **baked into a real MP4** at that rate with the same native image-sequence encoder Clay uses. |
| **Clay** | ✅ Works | **Claymation / stop-motion studio**: shoot one frame at a time with an **onion-skin guide** — up to **three previous frames** render semi-transparent over the live viewfinder, opacity falling off with age, so you can judge spacing rather than just position. **Review mode** (tap any thumbnail) sits you between frames: the frame before *and* the frame after are ghosted around the current one, you can scrub, **play the shot back at your export frame rate** to check the motion, and delete any frame that didn't work. Undo last frame, adjust onion opacity, then **bake the set into a real MP4** at 8/12/24fps via a native image-sequence encoder (reuses the video-exporter module's EGL/encoder pipeline — no decoder needed for this one). |
| **Scan** | ✅ Works | Two halves. **Guided capture**: multi-angle overlapping photo capture of a room or object, saved as a set. **Cloud reconstruction**: pick any video (≤1080p, ≤3 min) and Lensii uploads it to the **KIRI Engine** API, which computes a **3D Gaussian Splat** — the 2026 successor to NeRF that rasterizes with plain WebGL — in ~7–20 minutes. Check status, download the model, then **open it in the built-in traversable viewer**: drag to orbit, two fingers to pan, pinch to zoom. Needs a free KIRI API key pasted into Settings → NeRF cloud; this is the one feature that sends anything off-device, and only when you tap it. |
| **Trace** | ✅ Works | **AR surface-locked trace / mural projection**, with two ways to lock. **Marker lock (the accurate one)**: the app generates a printable high-entropy tracking marker — print it, tape it to your paper or wall, and ARCore re-detects it as an **Augmented Image** every frame it's in view. Because it re-localizes against a physical object instead of dead-reckoning, the image stays planted rather than slowly sliding, and the marker's *measured printed width* pins world scale, so **"210 mm wide" means 210 real millimetres on the paper**. Walk away and the HUD honestly reports `MARKER · COASTING` (riding ARCore's world map) until the marker is back in shot. **Surface lock**: the original tap-a-surface SLAM anchor, for when there's nothing to tape a marker to. **Lines mode** extracts the reference image's edges live (Sobel, in the fragment shader) and projects just those — a full-tone photo hides your own pencil line underneath it, line art doesn't; the sample step is normalized against image resolution so an imported 4000px phone photo produces the same line weight a 400px one does, with a detail slider to taste. Adjust opacity / real-world width / rotation and nudge position within the lock; a separate **digital camera zoom** magnifies the view for detail work without ever touching the anchor. A "lock adjust" toggle freezes the controls once you're happy. Needs a Google-certified ARCore device; the app checks and offers to install Google Play Services for AR if it's missing. |
| **Library** | ✅ Works | Local-first grid of **photos + videos**, fullscreen photo viewer, **photo editor** (rotate / flip / crop 1:1 → saves a non-destructive copy, via expo-image-manipulator), **video player**, **timelapse playback** (8/12/24 fps), **share**, save-to-Photos, delete. |
| **Studio** | ✅ Works | **The keyframe video editor** — one screen, replacing the old split Editor/Studio. **Pro-grade editing feel**: full **undo/redo** history (one entry per gesture, not per pixel), **snapping** everywhere — timeline trims/moves/keyframes snap to the playhead, clip cuts and whole seconds; canvas drags snap to center with alignment guides — **frame-step transport** (±1 frame at 30fps) and jump-to-next-cut/keyframe, haptic ticks on snap engage, and **automatic project autosave** with one-tap "Resume last project". Build a **sequence of clips** (add, reorder, trim, per-clip speed) with **dip-to-black transitions** between them, then layer **images, GIFs, videos and text** over the whole timeline. Every layer has its own **in/out point** (pop in, pop out), **fade in/out**, optional **green-screen key**, and **keyframed** position / scale / rotation / opacity with **easing** (linear, ease-in, ease-out, ease-in-out). Drag or pinch a layer straight on the canvas and it writes a keyframe at the playhead; a **CapCut-style timeline** gives every layer a lane with draggable in/out handles, keyframe diamonds you can tap-to-seek or drag-to-retime, a scrubbable playhead and zoom. Per-clip **trim, speed (0.25×–4×), pitch-preserve toggle and mute**. Mixed-resolution clips are letterboxed into the output rather than stretched. **Speed-changed audio bakes for real**: resampled (pitch follows speed) or **WSOLA time-stretched** (pitch preserved), pre-rendered as one continuous AAC track so cuts can never drift — with a silent-fallback if the DSP fails on a device, never a desynced export. **Audio tracks**: import music or a voiceover (any number of them), position each on the timeline, and set volume, trims and fade in/out. They're summed into the export alongside your clips' own audio — mix by muting clips or pulling their volume down. A silent video with only a music bed renders correctly too. Video overlay layers play **live** in the preview. **Export bakes a real MP4** — native MediaCodec decode → GLES composite → MediaCodec encode, drawing every layer at its interpolated pose for that frame's exact timestamp, honouring in/out windows and fades, chroma-keying overlay clips per frame with their own decoders. |
| **Attachments** | ✅ Works | **Device & module inspector**: model / OS / memory (expo-device), detected camera resolutions, **real Camera2 sensor characteristics** per lens (focal lengths, apertures, ISO range, exposure range, sensor size), **real microphone hardware inventory** (type, location, directionality, position — via `AudioManager.getMicrophones()`, honestly reflecting what each device actually reports rather than assuming a mic array exists), live **sensor scan** (accelerometer / gyro / magnetometer / barometer), and an honest "no external modules detected". USB-C thermal/IR/UV & BLE shutters would plug in via a native attachment module, which isn't built yet. |
| **Tools** | ✅ Works | **Unit converter** (length, volume, weight, temperature — cm↔in↔ft↔mi, gal↔L↔cups, etc.), and the **NeRF Measure** card — capture and cloud reconstruction are real now (see Scan tab); the AR measurement overlay on a finished scan is the remaining staged piece. |
| **Settings** | ✅ Works | Full **customization hub** — see below — plus honest capability map, privacy, storage usage, reset. |
| **Screen** | ✅ Works | **Real system-wide screen recording** via Android's MediaProjection: standard OS consent flow, foreground-service-backed capture (with the required Android 14+ persistent notification), optional mic audio, saves straight to Library. Facecam bubble, game mode, and export presets are next. |

### Everything is customizable (Settings — persisted across launches)
- **Photo:** aspect ratio (4:3 / 16:9 / 1:1), **picture size** (real device-detected resolutions), JPEG quality.
- **Video:** resolution (2160p / 1080p / 720p / 480p), bitrate, max duration.
- **Audio:** microphone on/off, **mic gain**, feedback volume, and (Screen recording only) an
  **audio source** choice — Standard, Camera-tuned, or Raw/no-AI-processing (`AudioSource.UNPROCESSED`,
  Android's own source-level way to skip AGC/noise suppression, with a real on-device fallback
  cascade to `VOICE_RECOGNITION` then `MIC` if a device doesn't support it). This only applies to
  Screen recording — Capture's video pipeline (`expo-camera`/CameraX) has no audio-source
  configuration surface at all to apply it to; see Settings → Capability map for the honest split.
  *(Mic on/off is live today. Input mic-gain is stored but not yet applied — Android's capture
  pipeline exposes no input-gain control, so it waits on a native audio path.)*
- **Capture defaults:** flash, grid + grid type, level, reticle, self-timer, auto-save to Photos, haptics.
- **Timelapse:** default interval, output frame rate.
- **Storage:** usage readout + clear all in-app media. Plus reset-to-defaults.

Everything is **local-first / private by default**. "Save to Photos" is an explicit action.

### First run
A **title sequence** opens the app: the mark's own aperture linkage unwinds from
closed and the blades open, halos chase outward, the Swiss cross lands, and the
wordmark rises. Tap to skip it.

Then a **guided tour** starts once, walking the whole app. It spotlights each tab
in the live UI — four dim panels framing the real element, not a mask or a
screenshot — while actually navigating there, so you see each screen behind the
bubble as it's explained. Skippable at any point and restartable from
**Settings → Take the tour**.

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

## Release signing (required before Play Store submission)

Every build today is **debug-signed** — fine for sideloading, but Google Play requires a real
release keystore, and losing that keystore means you can never update the app under the same
listing again. [`plugins/withReleaseSigning.js`](./plugins/withReleaseSigning.js) wires up real
signing, opt-in via environment variables — sideload builds keep working untouched until you set
these up.

One-time setup (do this yourself; the keystore and its passwords must never be committed):

1. Generate a keystore (needs a JDK installed — `keytool` ships with it):
   ```bash
   keytool -genkeypair -v -keystore lensii-release.keystore -alias lensii \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   It'll ask for a store password, a key password (can be the same), and some identity fields —
   answer honestly, they end up in the certificate. **Back up `lensii-release.keystore` and both
   passwords somewhere safe outside this repo** (a password manager, not a text file in the
   project). If you lose it, there is no recovery — you'd have to publish as a new, separate app.
2. Base64-encode it: `base64 -i lensii-release.keystore | pbcopy` (macOS) or
   `base64 -w0 lensii-release.keystore` (Linux) and copy the output.
3. In the GitHub repo, **Settings → Secrets and variables → Actions**, add four repo **secrets**:
   - `LENSII_RELEASE_KEYSTORE_BASE64` — the base64 output from step 2
   - `LENSII_RELEASE_STORE_PASSWORD`
   - `LENSII_RELEASE_KEY_ALIAS` — `lensii` if you used the command above as-is
   - `LENSII_RELEASE_KEY_PASSWORD`
4. Push anything — `.github/workflows/android.yml` now decodes the keystore and signs
   `assembleRelease`/`bundleRelease` for real. The **AAB** (`lensii-aab` workflow artifact, not the
   public GitHub Release — Play Console needs an `.aab`, not an `.apk`) is what you upload to Play
   Console; the `.apk` on the Release page stays for direct sideloading either way.

## Firebase Test Lab setup (automated device smoke test)

[`.github/workflows/firebase-test-lab.yml`](../.github/workflows/firebase-test-lab.yml) runs Google's
automated "Robo" crawler against the latest published APK on a real physical Android phone, looking
for crashes/ANRs across every screen it can reach. It's a crash-detection safety net, not a
replacement for hands-on testing — it can't tell you whether AR Trace's tracking lock drifts or
whether underwater mode actually survives a wet screen; only a person with the phone can check those.

One-time setup (nobody but a project owner with GCP access can do this part):

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) (the free
   Spark plan's daily quota is enough for occasional smoke runs; switch to pay-as-you-go Blaze if you
   want more).
2. In that project, open **Build → Test Lab** once to enable it.
3. In the matching [console.cloud.google.com](https://console.cloud.google.com) project, enable the
   **Cloud Testing API** and **Cloud Tool Results API** (APIs & Services → Library).
4. Create a service account (IAM & Admin → Service Accounts) with the **Firebase Test Lab Admin**
   role, then create a JSON key for it (Keys → Add key → JSON) — this downloads a `.json` file.
5. In the GitHub repo (Settings → Secrets and variables → Actions):
   - Add repo **secret** `GCP_SA_KEY` — paste the entire contents of that JSON file.
   - Add repo **variable** `FIREBASE_PROJECT_ID` — the GCP project id (shown in Firebase project
     settings, looks like `lensii-testing-a1b2c`).
6. Run the workflow from the Actions tab (`Firebase Test Lab (Robo smoke test)` → Run workflow), or
   ask Claude to trigger it.

## Cloud 3D reconstruction (KIRI Engine) setup

Scan's "Reconstruct from video → 3D scan" uses the [KIRI Engine](https://www.kiriengine.app)
open API for the heavy compute (photogrammetry → 3D Gaussian Splatting). Everything else in
Lensii is on-device; this feature uploads the chosen video to KIRI's servers, and only when
you explicitly tap it.

One-time setup (each user supplies their own key — nothing is committed or shared):

1. Create a free account at [kiriengine.app](https://www.kiriengine.app) and open the
   **developer / open API dashboard** to get an API key (free tier includes trial credits;
   paid plans price per successful scan).
2. In the app: **Settings → NeRF cloud → paste the key → Save.** It's stored only in the
   app's local storage on that device.
3. In **Scan**, tap **"☁ Reconstruct from video → 3D scan"**, pick a video (≤1080p, ≤3 min —
   orbit the subject slowly with lots of overlap), wait ~7–20 minutes, then **Check → Download
   → View 3D**. The viewer is a WebView running the standard Three.js Gaussian-splat renderer;
   it needs internet the first time to fetch the renderer library from CDN, while the scan
   itself is read from local storage.

## Selling on Google Play

**Monetization:** Capture and Library are free forever, no account or purchase needed. Every
other tab (Studio, Screen, Timelapse, Clay, Scan, Trace, Attachments, Tools) needs an
active free trial, subscription, or a redeemed access code — Settings always stays free too, since
that's where a trial starts or a code gets redeemed.

1. In Play Console, create a **subscription** product with id **`lensii_pro_monthly`** (must match
   `SUBSCRIPTION_PRODUCT_ID` in `src/entitlements.tsx` exactly), one base plan, monthly billing,
   your price (e.g. $14.00), and a **7-day free trial offer** on that base plan — the free trial is
   entirely a Play Console configuration, nothing in the app tracks trial state itself.
2. **Access codes** (for reviewers, press, or your own testing — bypass Play Billing entirely):
   ```bash
   node scripts/generate-promo-code.js SOMEPAYLOAD
   ```
   First change `PROMO_SECRET` in `src/promoCodes.ts` to something real (the placeholder refuses
   to generate codes) — see that file's comments for what security property this scheme does and
   doesn't provide. A generated code goes in Settings → "Have an access code?".

See [`PLAY_STORE_SUBMISSION.md`](./PLAY_STORE_SUBMISSION.md) for accurate, from-the-code answers
to Play Console's Data Safety and Content Rating questionnaires, plus a full permission-by-
permission justification list. Release signing is documented above; the Privacy Policy/Terms
pages are at the repo root ([`../privacy.html`](../privacy.html), [`../terms.html`](../terms.html)).

## Tech

- **Expo SDK 57 · React Native 0.86 · TypeScript**
- `expo-camera` (viewfinder + capture), `expo-sensors` (level), `expo-media-library`
  (save to Photos), `expo-file-system` (local-first storage), `react-native-svg` (brand mark),
  `expo-haptics`, `expo-image`, `react-native-safe-area-context`, `react-native-webview`
  (the traversable 3D Gaussian Splat viewer).
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
    ├── timeline.ts         # Studio's keyframe/layer model (mirrored by the native exporter)
    └── screens/            # Capture, Studio, Timelapse, Library, Settings, …
```

## Notes on honesty (same as the site)

Software cannot make a phone sensor see IR/UV/thermal wavelengths it physically rejects — those
need attachments. Manual ISO/shutter/RAW capture still needs native code and is staged, not faked.
Green-screen keying baked per-frame into a video export (Studio), screen recording (Screen), and
frame-accurate keyframed video export are all real,
shipped native modules — not placeholders. Screen recording uses Android's
own system consent dialog and a persistent notification/indicator the whole time it runs; it can't
be started or hidden without that user-visible OS-level consent. The video export pipeline is
freshly built hand-written MediaCodec/GLES code with no automated on-device test coverage yet
(this environment has no Android SDK/emulator to run it against — only to compile it) — treat an
early export as worth a visual check, the same way you'd sanity-check any brand-new capture path.
The **AR Trace** module carries the same caveat, more so: it's real ARCore integration (hand-written
camera-background + pose-relative overlay rendering + a real AugmentedImageDatabase, not a mock), but
nothing in this environment can validate that a lock actually holds without drifting — that's
tracking quality, which only shows up on a real device in a real room. CI proves it compiles; only
trying it on your phone proves it tracks. Two specifics worth knowing: marker tracking is a genuine
improvement over a bare SLAM anchor precisely *because* it re-localizes against a physical object,
but it can only correct while the marker is actually in frame — out of frame it degrades to the same
world-map estimate a surface lock uses, which is why the HUD distinguishes the two rather than
claiming one quality of lock throughout. And ARCore scores every registered marker for trackability;
if it ever rejects this one the app says so and falls back to surface locks instead of silently
failing to track. The **Scan cloud reconstruction** path is honest about its dependencies: the compute
happens on KIRI Engine's servers (a true NeRF/3DGS reconstruction cannot run on a phone), the
splat viewer fetches its renderer library from CDN, and the whole upload→poll→download→view loop
is brand-new code that CI can only compile, not exercise against the live API.
See the in-app **Settings → Capability map**.
