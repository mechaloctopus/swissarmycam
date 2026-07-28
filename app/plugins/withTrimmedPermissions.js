const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

// Expo's own base Android manifest template includes
// android.permission.SYSTEM_ALERT_WINDOW (a legacy default, left over from
// old dev-mode overlay tooling) even though nothing in this app draws over
// other apps. It's a genuinely sensitive permission Play reviewers scrutinize
// specifically, so an unused declaration is worth stripping rather than
// explaining away.
const UNUSED_PERMISSIONS = ["android.permission.SYSTEM_ALERT_WINDOW"];

module.exports = function withTrimmedPermissions(config) {
  return withAndroidManifest(config, (config) => {
    AndroidConfig.Permissions.removePermissions(config.modResults, UNUSED_PERMISSIONS);
    return config;
  });
};
