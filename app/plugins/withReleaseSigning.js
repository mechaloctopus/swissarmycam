const { withAppBuildGradle } = require("@expo/config-plugins");

// Exact text of the generated signingConfigs block, from the RN/Expo prebuild
// template as of Expo SDK 57 / RN 0.86. If a future template changes this,
// the plugin throws loudly at prebuild time instead of silently no-op'ing.
const SIGNING_CONFIGS_OLD = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const SIGNING_CONFIGS_NEW = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            // Opt-in: only configured when a real keystore is present via env
            // vars (CI secrets or a developer's local shell) -- never from a
            // file this plugin ships, so nothing signing-related is ever
            // committed. Sideload/debug-signed builds keep working untouched
            // until these are actually set.
            if (System.getenv("LENSII_RELEASE_KEYSTORE")) {
                storeFile file(System.getenv("LENSII_RELEASE_KEYSTORE"))
                storePassword System.getenv("LENSII_RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("LENSII_RELEASE_KEY_ALIAS")
                keyPassword System.getenv("LENSII_RELEASE_KEY_PASSWORD")
            }
        }
    }`;

const RELEASE_BUILD_TYPE_OLD = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const RELEASE_BUILD_TYPE_NEW = `        release {
            // Real release signing when LENSII_RELEASE_KEYSTORE is set (see
            // signingConfigs.release above and app/README.md); falls back to
            // the debug keystore otherwise, same as it always has.
            signingConfig System.getenv("LENSII_RELEASE_KEYSTORE") ? signingConfigs.release : signingConfigs.debug`;

/** Wires up real Android release signing, opt-in via environment variables. */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes(SIGNING_CONFIGS_OLD)) {
      throw new Error(
        "withReleaseSigning: expected signingConfigs.debug block not found in android/app/build.gradle " +
          "(the Expo/RN prebuild template may have changed) -- update plugins/withReleaseSigning.js to match."
      );
    }
    contents = contents.replace(SIGNING_CONFIGS_OLD, SIGNING_CONFIGS_NEW);

    if (!contents.includes(RELEASE_BUILD_TYPE_OLD)) {
      throw new Error(
        "withReleaseSigning: expected release buildType block not found in android/app/build.gradle " +
          "(the Expo/RN prebuild template may have changed) -- update plugins/withReleaseSigning.js to match."
      );
    }
    contents = contents.replace(RELEASE_BUILD_TYPE_OLD, RELEASE_BUILD_TYPE_NEW);

    config.modResults.contents = contents;
    return config;
  });
};
