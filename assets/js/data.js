/*
 * Swiss Army Camera — content model
 * ----------------------------------
 * All long-form product data lives here so the markup stays lean and the
 * "components" in main.js render from a single source of truth. Editing copy?
 * Do it here — you do not need to touch index.html.
 */

/* ------------------------------------------------------------------ *
 * §04  CAPABILITY MATRIX
 * Seven tool groups. Each renders as an expandable instrument card.
 * ------------------------------------------------------------------ */
const FEATURE_MATRIX = [
  {
    id: "A",
    name: "Pro Camera Controls",
    lede: "Full manual command of the sensor — the controls a working photographer expects, exposed cleanly.",
    tags: ["Manual", "RAW", "Metering"],
    features: [
      "Manual ISO",
      "Shutter speed",
      "Exposure compensation",
      "Focus control (auto / manual)",
      "White balance (presets + Kelvin)",
      "Lens selection (wide, ultra-wide, tele)",
      "RAW capture — where supported",
      "Resolution & frame-rate control — where supported",
      "HDR capture — where supported",
      "Grid, level, histogram, zebra stripes, focus peaking",
    ],
  },
  {
    id: "B",
    name: "Creator Recording",
    lede: "A mobile OBS-class studio: cameras, screen, mic, and platform-ready exports in one pass.",
    tags: ["Multi-cam", "Screen", "Export"],
    features: [
      "Front camera recording",
      "Rear camera recording",
      "Dual-camera recording — where supported",
      "Picture-in-picture facecam",
      "Screen recording — where supported",
      "Game recording mode",
      "Tutorial recording mode",
      "App walkthrough mode",
      "Commentary + mic mixing",
      "Export presets — YouTube, TikTok, Instagram, X, podcasts",
    ],
  },
  {
    id: "C",
    name: "Green Screen / Compositor",
    lede: "Keying, segmentation, and a real layer stack — compositing that used to require a desktop NLE.",
    tags: ["Chroma", "Layers", "Keyframes"],
    features: [
      "Chroma key",
      "AI background removal",
      "Keyframed objects",
      "Animated overlays",
      "Draggable stickers",
      "Text layers",
      "Lower thirds",
      "Motion paths",
      "Object scale, rotation, opacity",
      "Background replacement",
      "Transparent PNG / WebM overlays",
      "Preset scenes",
    ],
  },
  {
    id: "D",
    name: "Timelapse / Long Capture",
    lede: "From a 30-second bloom to a six-month build — interval capture with automated daily cuts.",
    tags: ["Interval", "Jobsite", "Auto-edit"],
    features: [
      "Timelapse",
      "Intervalometer",
      "Star-trail-style experiments — where hardware allows",
      "Construction progress capture",
      "Plant growth mode",
      "Weather / cloud movement mode",
      "Jobsite documentation mode",
      "Before / after capture",
      "Auto-generated daily progress videos",
    ],
  },
  {
    id: "E",
    name: "Visual Intelligence",
    lede: "The camera as a reading, measuring, cataloguing instrument — searchable visual notes.",
    tags: ["On-device ML", "OCR", "Search"],
    features: [
      "Object detection",
      "Scene labeling",
      "Color-palette extraction",
      "Light-meter mode",
      "Measurement assist",
      "OCR / text extraction",
      "Receipt / document capture",
      "Plant / project / material documentation",
      "Construction punch-list capture",
      "Inventory capture",
      "Searchable visual notes",
    ],
  },
  {
    id: "F",
    name: "Experimental Modes",
    lede: "The lab bench — computational imaging you can run today on a standard sensor.",
    tags: ["Computational", "Stacking", "Macro"],
    features: [
      "False-color low-light mode",
      "Edge-detection mode",
      "Motion-difference mode",
      "Long-exposure simulation",
      "Frame stacking",
      "Noise-reduction stacking",
      "Macro inspection mode",
      "Magnifier mode",
      "Spectral / IR / UV attachment-mode placeholders",
    ],
  },
  {
    id: "G",
    name: "Hardware Attachment Ecosystem",
    lede: "Where software ends, glass and sensors begin — an open platform for clip-ons and modules.",
    tags: ["Modules", "Optics", "Developer API"],
    features: [
      "External IR illuminator (concept)",
      "External night-vision camera module (concept)",
      "USB-C thermal-camera support (concept)",
      "UV blacklight attachment (concept)",
      "Macro lens clip-on support",
      "Polarizer / ND filter support",
      "Tripod / rig system",
      "Bluetooth shutter / remote support",
      "Future developer API for attachments",
    ],
  },
];

/* ------------------------------------------------------------------ *
 * §05  HARD TECHNICAL TRUTHS
 * Honest capability grading. `level` keys map to a colour + label.
 * ------------------------------------------------------------------ */
const CAPABILITY_LEVELS = {
  now: { label: "Possible Now", tone: "go" },
  device: { label: "Device-Dependent", tone: "device" },
  native: { label: "Requires Native Code", tone: "native" },
  attach: { label: "Requires Attachment", tone: "attach" },
  never: { label: "Not Possible by Software Alone", tone: "stop" },
};

const LIMITATIONS = [
  {
    title: "Infrared & night vision",
    level: "attach",
    body:
      "A standard phone sensor has an IR-cut filter and cannot see infrared. Software cannot add wavelengths the silicon physically rejects. True IR / night vision needs an IR-sensitive sensor or an external module.",
  },
  {
    title: "Ultraviolet output",
    level: "attach",
    body:
      "A normal camera flash emits visible white light, not UV. Fluorescence and UV inspection require actual UV LEDs — delivered as a hardware attachment, never simulated by the screen.",
  },
  {
    title: "Thermal imaging",
    level: "attach",
    body:
      "Heat is long-wave infrared. It requires a microbolometer thermal sensor. We support USB-C thermal modules; we will never fake a thermal overlay from a visible-light frame.",
  },
  {
    title: "Low-light enhancement",
    level: "now",
    body:
      "Frame stacking, noise reduction, false-colour mapping and long-exposure simulation are genuine computational wins on the existing sensor — real, and available today.",
  },
  {
    title: "Deep camera control",
    level: "native",
    body:
      "Manual ISO, shutter, RAW, focus peaking and multi-cam need native camera APIs. This is a native module, not a web wrapper — Camera2 / CameraX on Android, AVFoundation on iOS.",
  },
  {
    title: "Android capability variance",
    level: "device",
    body:
      "Camera2 / CameraX expose deep control, but per-device support varies widely — RAW, manual shutter and concurrent streams differ by chipset and vendor firmware. We detect and degrade gracefully.",
  },
  {
    title: "iOS capability model",
    level: "device",
    body:
      "AVFoundation is powerful but more tightly governed. Multi-cam is limited to capable devices; certain controls are gated by Apple. We ship what the platform genuinely allows.",
  },
  {
    title: "Expo boundary",
    level: "native",
    body:
      "Expo is ideal for the app shell, navigation and early screens. Serious camera, screen-capture and GPU compositing features require native modules via a custom dev client — that is the plan from day one.",
  },
  {
    title: "Screen & call recording",
    level: "device",
    body:
      "Screen capture is permission-gated: ReplayKit on iOS, MediaProjection on Android, both with visible indicators. Recording of calls or meetings is framed strictly as user-consented screen recording.",
  },
  {
    title: "Consent & covert capture",
    level: "never",
    body:
      "We do not build covert recording. Two-party-consent laws, app-store rules and platform privacy limits are hard constraints — an instrument you can trust, not a surveillance tool.",
  },
];

/* ------------------------------------------------------------------ *
 * §07  APP UX — main tabs of the instrument
 * ------------------------------------------------------------------ */
const APP_TABS = [
  {
    name: "Capture",
    glyph: "◎",
    detail:
      "A big clean viewfinder with a Swiss-Army tool drawer. Manual / pro controls, presets, lens selector, histogram, grid, level and focus tools — never in the way of the frame.",
  },
  {
    name: "Studio",
    glyph: "▤",
    detail:
      "Timeline, layers, green screen, keyframes and overlays. A real compositor with a mobile-native export pipeline.",
  },
  {
    name: "Screen",
    glyph: "▣",
    detail:
      "Facecam bubble, mic control, game mode and tutorial mode with recording presets. OBS discipline, phone-sized.",
  },
  {
    name: "Timelapse",
    glyph: "⧗",
    detail:
      "Intervalometer, jobsite and growth modes, before/after capture and auto-generated daily cuts.",
  },
  {
    name: "Lab",
    glyph: "⌬",
    detail:
      "Experimental filters, AI analysis, visual measurement, false colour, motion detection and frame stacking.",
  },
  {
    name: "Attachments",
    glyph: "⊕",
    detail:
      "Detect, calibrate and manage external optics and modules. The bridge to the hardware ecosystem.",
  },
  {
    name: "Library",
    glyph: "▦",
    detail:
      "Local-first media, searchable visual notes and export history — private by default.",
  },
  {
    name: "Settings",
    glyph: "⚙",
    detail:
      "Permissions transparency, cloud-processing controls, storage and subscription management.",
  },
];

/* ------------------------------------------------------------------ *
 * §06  TECHNICAL STACK
 * ------------------------------------------------------------------ */
const STACK = {
  website: [
    ["Framework", "Next.js / React"],
    ["Language", "TypeScript"],
    ["Styling", "Tailwind CSS"],
    ["Motion", "Framer Motion"],
    ["3D (optional)", "Three.js / React Three Fiber — lens & knife visual"],
    ["Components", "shadcn/ui or custom"],
    ["Design", "Responsive, mobile-first"],
  ],
  app: [
    ["Shell", "Expo + React Native"],
    ["Runtime", "Expo Dev Client"],
    ["Android camera", "Native module — CameraX / Camera2"],
    ["iOS camera", "Native module — AVFoundation"],
    ["iOS screen capture", "ReplayKit / broadcast — where allowed"],
    ["Android screen capture", "MediaProjection — where allowed"],
    ["Overlays / compositing", "Skia / React Native Skia"],
    ["Chroma key", "GPU shader pipeline"],
    ["Video processing", "FFmpeg-mobile — where legally & technically appropriate"],
    ["On-device ML", "Segmentation, detection, OCR, enhancement"],
    ["Cloud AI (optional)", "Heavier processing, user-controlled"],
    ["Subscriptions", "RevenueCat"],
    ["Auth / data", "Supabase or Firebase"],
    ["Media storage", "Local-first, private by default"],
    ["Web payments", "Stripe — if needed"],
    ["Mobile billing", "App Store / Play Store subscriptions"],
  ],
};

/* ------------------------------------------------------------------ *
 * §10  ROADMAP — staged build
 * ------------------------------------------------------------------ */
const ROADMAP = [
  ["01", "Foundation", "Website, brand, waitlist and prototype UI."],
  ["02", "App Shell", "Expo shell with basic camera, timelapse and library."],
  ["03", "Native Camera", "Native camera modules — CameraX / Camera2 & AVFoundation."],
  ["04", "Compositor", "Green screen and the layer-based compositor."],
  ["05", "Studio", "Screen + facecam recording tools."],
  ["06", "Intelligence", "AI visual tools — detection, OCR, measurement, enhancement."],
  ["07", "Attachments", "The hardware-attachment ecosystem and developer API."],
  ["08", "Community", "Creator community and a marketplace for overlays, presets and tools."],
];

const USE_OF_FUNDS = [
  "Engineering",
  "Native camera development",
  "UI / UX",
  "App Store / Play Store launch",
  "Legal / trademark review",
  "Hardware prototype testing",
  "Marketing / content",
  "Cloud / video infrastructure",
];

/* ------------------------------------------------------------------ *
 * §09  MARKET — revenue tiers @ $4.99 / mo (gross, pre-fees)
 * ------------------------------------------------------------------ */
const PRICE = 4.99;
const REVENUE_TIERS = [1000, 10000, 100000, 1000000];

/* ------------------------------------------------------------------ *
 * §08  SUBSCRIPTION
 * ------------------------------------------------------------------ */
const PLANS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    accent: false,
    features: [
      "Basic camera",
      "Basic timelapse",
      "Limited exports",
      "Local-first library",
    ],
  },
  {
    name: "Pro",
    price: "$4.99",
    cadence: "per month · 3-day free trial",
    accent: true,
    features: [
      "Advanced manual controls",
      "Pro recording modes",
      "AI background removal",
      "Green-screen compositor",
      "Keyframes",
      "Unlimited exports",
      "Timelapse presets",
      "Visual-intelligence tools",
      "Screen + facecam studio — where supported",
      "Experimental lab modes",
    ],
  },
  {
    name: "Annual",
    price: "$—",
    cadence: "placeholder · best value",
    accent: false,
    features: [
      "Everything in Pro",
      "Two months effectively free (placeholder)",
      "Priority feature access",
    ],
  },
  {
    name: "Founder Lifetime",
    price: "$—",
    cadence: "placeholder · limited",
    accent: false,
    features: [
      "Everything in Pro, forever",
      "Founder credit",
      "Early attachment access",
    ],
  },
];

/* ------------------------------------------------------------------ *
 * §11  COMPETITIVE POSITIONING
 * ------------------------------------------------------------------ */
const POSITIONING = [
  ["More technical", "than simple point-and-shoot camera apps."],
  ["More creator-focused", "than the stock camera that ships with the phone."],
  ["More integrated", "than juggling separate editing and screen-recording apps."],
  ["More mobile-native", "than porting desktop OBS to a small screen."],
  ["More honest", "than fake “night-vision” apps that promise physics they can’t deliver."],
  ["More expandable", "than a closed camera app, via the attachment platform & API."],
];

/* ------------------------------------------------------------------ *
 * §12  FUTURE
 * ------------------------------------------------------------------ */
const FUTURE = [
  "External IR camera integration",
  "Thermal camera support",
  "UV inspection attachment",
  "AI director mode",
  "Automatic highlight extraction",
  "Live streaming",
  "Multi-device camera sync",
  "Remote phone-camera network",
  "Drone / action-camera integration",
  "Contractor / jobsite documentation",
  "Fishing / spearfishing / ocean-visibility mode",
  "Fitness / form-analysis mode",
  "Astronomy / sky mode",
  "Education / demo mode",
  "AR measurement",
  "Visual search",
  "AI “what am I looking at?” mode",
  "Creator templates",
  "Marketplace for overlays, presets & tools",
];

/* ------------------------------------------------------------------ *
 * §13  LEGAL / ETHICS / PRIVACY
 * ------------------------------------------------------------------ */
const PRIVACY = [
  ["No covert recording", "The instrument never hides that it is capturing."],
  ["Two-party consent", "We respect consent laws where they apply."],
  ["Clear indicators", "Screen recording always shows a visible indicator."],
  ["Local-first storage", "Your media lives on your device by default."],
  ["Permission transparency", "Every permission is explained, in plain language."],
  ["No data sale", "We never sell user camera data. Full stop."],
  ["You control the cloud", "Heavier AI runs in the cloud only when you allow it."],
  ["Private by default", "Nothing leaves the device unless you send it."],
  ["Trademark review", "Brand & name undergo legal review before final launch."],
];

/* Expose to renderer */
window.SAC = {
  FEATURE_MATRIX,
  CAPABILITY_LEVELS,
  LIMITATIONS,
  APP_TABS,
  STACK,
  ROADMAP,
  USE_OF_FUNDS,
  PRICE,
  REVENUE_TIERS,
  PLANS,
  POSITIONING,
  FUTURE,
  PRIVACY,
};
