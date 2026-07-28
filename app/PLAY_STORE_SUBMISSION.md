# Play Store submission — reference for filling out Play Console's forms

This isn't submitted anywhere automatically — Play Console's Data Safety and Content Rating
questionnaires are forms only the account owner can fill out and submit. This document is a
from-the-actual-code reference to answer them accurately, written alongside the compliance pass
that also confirmed the app's target SDK (API 36) already meets Play's current minimum and
removed one unused sensitive permission (`SYSTEM_ALERT_WINDOW`, a leftover Expo/RN template
default nothing in this app actually uses).

## Data Safety section

Play's definition of "data collection" is specifically about data **leaving the device** to the
developer or a third party. Lensii is local-first with no backend of its own, so almost
everything here is genuinely "No data collected":

| Category | Answer | Why |
| --- | --- | --- |
| Location | No data collected | Never requested, never read. |
| Personal info (name, email, etc.) | No data collected | No accounts, no sign-in, anywhere. |
| Financial info | No data collected | Subscription purchases are handled entirely by Google Play Billing — Lensii never receives payment details, only a purchase/subscription-state confirmation. Check Play Console's current help text for whether Play Billing subscriptions need a separate declaration; guidance has changed over time and this doc can't be more current than that page. |
| Photos and videos | No data collected | Captured/stored locally in the app's private storage. Nothing is transmitted unless the user explicitly taps "Save to Photos" (a local OS action, not a transmission to Lensii or anyone else) or uses the OS share sheet to send a file to an app of their own choosing. |
| Audio files | No data collected | Same as above — mic input is written to local video files only. |
| App activity, App info & performance, Device/other IDs | No data collected | No analytics SDK, no crash reporting SDK, no ad SDK. |
| Messages, Health & fitness, Contacts, Calendar, Web browsing, Files & docs | Not applicable | App has no features touching any of these. |

**Security practices section:** data is not encrypted in transit (nothing is transmitted); there's
no way for a user to request data deletion from a developer because the developer never has it —
uninstalling the app or using Settings → "Clear all in-app media" removes everything locally.

## Content rating (IARC) questionnaire

- **Category:** Photography / Video (creative tool), not a game.
- **Violence, sexual content, gambling, controlled substances:** None — Lensii doesn't generate
  or moderate content in any of these categories; it's a capture/editing tool.
- **User-generated content shared with other users:** No — there's no social feature, no public
  feed, no way for one Lensii user to see another's content. The OS share sheet lets a user send
  a file to another app of their choice, which isn't Lensii hosting or distributing anything.
- **In-app purchases / subscriptions:** Yes — a single auto-renewing monthly subscription
  (`lensii_pro_monthly`) with a 7-day free trial, no loot-box-style randomized purchases. Capture
  and Library are free without any purchase; every other tab needs an active trial, subscription,
  or a developer-issued access code (see `src/promoCodes.ts`) — Play Console's subscription
  questionnaire will ask for the free-trial length and cancellation/renewal terms, which the app's
  Settings screen also states plainly before purchase.
- **Ads:** No.
- **User-to-user communication:** No.

## Permissions and why each one exists

Every permission below is declared because a specific, real feature needs it — worth having ready
if a reviewer asks, and matches what Settings → Capability map already tells users in-app:

| Permission | Feature |
| --- | --- |
| `CAMERA` | Capture, Clay, Scan, Trace, Lab, Studio's live preview |
| `RECORD_AUDIO` | Video recording mic, screen recording audio |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_MEDIA_AUDIO` / `READ_MEDIA_VISUAL_USER_SELECTED` | Importing images/videos (Editor overlays, Trace reference images, Scan video import), "Save to Photos" |
| `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` (legacy, `maxSdkVersion=32`) | Same, on pre-Android-13 devices only |
| `INTERNET` | Google Play Billing and ARCore/Google Play Services for AR — the app itself has no server and sends nothing of its own over this |
| `VIBRATE` | Haptic feedback (Settings toggle) |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PROJECTION` / `POST_NOTIFICATIONS` | Screen recording's required persistent notification (Android's own transparency requirement for MediaProjection — Lensii cannot record the screen without this being visible) |

No `SYSTEM_ALERT_WINDOW`, no `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`, no contacts/calendar
permissions — nothing beyond what's listed above.
