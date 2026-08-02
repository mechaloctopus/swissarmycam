const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * Registers Lensii as a real camera app.
 *
 * Two reasons this exists as a plugin rather than app.json's `intentFilters`:
 * that field hardcodes an `android.intent.action.` prefix, and every action
 * below lives under `android.media.action.` instead.
 *
 * What this buys:
 *  - IMAGE_CAPTURE / VIDEO_CAPTURE: other apps asking for a photo or video
 *    (messengers, forms, note apps) offer Lensii in the picker.
 *  - STILL_IMAGE_CAMERA / VIDEO_CAMERA: the intents the OS itself fires for
 *    "open the camera" gestures, which is what makes Lensii eligible to be the
 *    system default camera.
 *
 * Eligible is the honest word. On a Pixel the double-press-power gesture is
 * dispatched by the system, and depending on Android build it may resolve to
 * the user's default camera or stay pinned to the preinstalled one. Declaring
 * these filters is the only supported way to be in that running — there is no
 * permission an app can hold to claim a hardware button gesture, and anything
 * that fakes it (an accessibility service watching for key events) would be
 * both fragile and a Play Store policy problem.
 */
const CAMERA_ACTIONS = [
  "android.media.action.STILL_IMAGE_CAMERA",
  "android.media.action.VIDEO_CAMERA",
  "android.media.action.IMAGE_CAPTURE",
  "android.media.action.VIDEO_CAPTURE",
];

const withCameraIntents = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error("withCameraIntents: no <application> in the manifest");

    const main = app.activity?.find((a) => a.$?.["android:name"] === ".MainActivity");
    if (!main) throw new Error("withCameraIntents: no .MainActivity to attach camera intents to");

    main["intent-filter"] = main["intent-filter"] ?? [];

    for (const action of CAMERA_ACTIONS) {
      const already = main["intent-filter"].some((f) =>
        f.action?.some((a) => a.$?.["android:name"] === action)
      );
      if (already) continue;
      main["intent-filter"].push({
        action: [{ $: { "android:name": action } }],
        category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
      });
    }

    return cfg;
  });

module.exports = withCameraIntents;
