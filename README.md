# Swiss Army Camera — Website

> **The camera app with every tool in the handle.**
> A precision mobile camera, creator studio, screen recorder, compositor, and visual-intelligence platform.

This repository contains **both** the marketing website **and** the Android app:

- **`/` (root)** — the one-page marketing + product-specification website (below).
- **[`/app`](./app)** — the **Android app** (Expo + React Native), the Phase 2 shell with a
  working camera, timelapse, lab preview, and local-first library. GitHub Actions builds an
  installable APK on every push and publishes it to
  [**Releases → `android-latest`**](https://github.com/mechaloctopus/swissarmycam/releases/tag/android-latest).
  See [`app/README.md`](./app/README.md). An iOS build (AVFoundation) is planned as a near-clone.

---

The website itself doubles as three documents in one:

1. A premium public **landing page**.
2. A **technical product manifesto** (honest about what phone hardware can and cannot do).
3. A **market / investor overview** with an interactive revenue model.
4. A **reference specification** for the future mobile-app build.

> ⚠️ **Naming note:** *Swiss Army Camera* is a **working project name**.
> Name, branding, and trademark strategy are **subject to final review**, and the project is
> **not affiliated with, endorsed by, or connected to Victorinox or any national armed forces.**

---

## 1. What's in here

This is a **zero-dependency static site** — plain HTML, CSS, and vanilla JavaScript.
No build step, no `npm install`, no framework runtime. It opens in any modern browser and
deploys to any static host as-is.

```
swissarmycam/
├── index.html              # All page markup & section structure
├── assets/
│   ├── css/
│   │   └── styles.css      # The full design system (tokens, layout, components, themes)
│   ├── js/
│   │   ├── data.js         # ← ALL product copy & data lives here (edit this to change content)
│   │   └── main.js         # Rendering + interactions (no dependencies)
│   └── img/
│       └── README.md       # Where to drop logo / brand images
└── README.md               # This file
```

**Why static instead of Next.js?** The site is a single page with no server needs, so a
static build is faster, has zero supply-chain surface, and deploys anywhere instantly. The
**concept's recommended stacks** (Next.js/React/Tailwind/Framer Motion for web; Expo + native
modules for the app) are documented **inside the site itself** (§06) and summarized below — the
static build can be ported into a Next.js app component-for-component when that becomes useful.

---

## 2. Run it locally

Because it's static, you only need a static file server (opening `index.html` directly via
`file://` also works, but a server is closer to production).

**Option A — Python (built in on most machines):**
```bash
cd swissarmycam
python3 -m http.server 5173
# open http://localhost:5173
```

**Option B — Node (`npx`, no install):**
```bash
cd swissarmycam
npx serve .
# or: npx http-server -p 5173
```

**Option C — VS Code:** use the *Live Server* extension → "Open with Live Server".

---

## 3. Deploy it

Any static host works. Point it at the repository root (no build command, no output directory).

| Host | How |
| --- | --- |
| **Vercel** | `vercel` (framework preset: *Other*). No build command. |
| **Netlify** | Drag-and-drop the folder, or connect the repo. Publish dir = `/`. |
| **GitHub Pages** | Settings → Pages → deploy from branch → root. |
| **Cloudflare Pages** | Connect repo, build command empty, output dir = `/`. |
| **Any S3 / static bucket** | Upload the files, enable static hosting. |

---

## 4. Editing content

**Almost all copy lives in `assets/js/data.js`** — the feature matrix, capability limits,
technical stack, roadmap, pricing plans, market points, positioning, future features, and
privacy commitments are all data structures rendered by `main.js`. Change the words there and
the page updates. Longer prose sections (hero, thesis, founder story, legal footer) live
directly in `index.html`.

### The logo
A **designed logo ships with the site** — an *aperture-iris + Swiss-cross* mark ringed by a
precision instrument bezel (camera + Swiss cross + Swiss-watch tooling, in one instrument). Files:

- `assets/img/logo-mark.svg` — mark only (ring uses `currentColor`, cross is Swiss red).
- `assets/img/logo.svg` — horizontal lockup with the wordmark.
- `assets/img/logo-appicon.svg` — rounded app-icon tile (the red edge nods to the knife handle).

The mark is **inlined** into `index.html` at the nav, footer, and CTA so the ring follows the
light/dark theme automatically. The favicon is a simplified version of the same mark.

To use **your own** logo instead, the swap points are marked in the code. Find them with:

```bash
grep -rn "brand__mark\|footer__logo\|cta__mark\|logo-" index.html
```

- **Nav mark** — `.brand__mark` inline SVG → swap for `<img src="assets/img/logo.svg" …>`.
- **Footer mark** — `.footer__logo` inline SVG.
- **CTA mark** — `.cta__mark` inline SVG (detailed bezel variant).
- **Hero device badge** — `.device__badge`, a slot for a product/logo image.
- Drop new files into `assets/img/` (see `assets/img/README.md`).

### Wiring the waitlist form
`index.html` `#waitform` currently validates the email client-side and shows a success message.
The `PLACEHOLDER` comment in `assets/js/main.js` (`wait()` function) marks where to `POST` to
your provider — **Supabase**, Mailchimp, ConvertKit, etc.

### Investor / contact emails
Placeholder `mailto:` links (`investors@example.com`, `hello@example.com`) are in the footer
and investor modal — replace with real addresses.

---

## 5. Features of the site itself

- **Dark premium theme by default**, with a real token-driven **light mode** toggle (persisted to `localStorage`, respects OS preference).
- **Live hero animation** — a canvas lens/aperture reticle with a Swiss-cross crosshair, plus an animated in-device viewfinder. Pauses when off-screen; fully honors `prefers-reduced-motion`.
- **Interactive capability matrix** — expandable instrument cards (§04), *expand/collapse all*.
- **Honest limitations grid** (§05) — colour-coded *Possible Now → Not Possible by Software Alone*.
- **Interactive revenue calculator** (§09) — slider computing gross monthly/annual at $4.99/mo, plus a fixed-tier table (1k / 10k / 100k / 1M).
- **Investor overview modal** — focus-trapped, `Esc`-closable, staged roadmap + revenue + use-of-funds.
- **App-UX explorer** (§07) — tabbed instrument panels (Capture · Studio · Screen · Timelapse · Lab · Attachments · Library · Settings).
- **Roadmap timeline**, competitive positioning, future-features cloud, founder/lineage story, and a serious legal/ethics/privacy section.
- Sticky nav with scroll progress, smooth scroll, scroll-reveal, mobile menu.
- **Accessible:** skip link, keyboard focus states, ARIA on nav/tabs/modal, reduced-motion support.
- **Performance:** no external requests (system font stack, inline SVG favicon), no libraries, animation throttled off-screen.

---

## 6. The concept's recommended build stack

These are documented on the page (§06) and restated here for engineers picking up the app build.

**Website (if/when ported from this static build):** Next.js / React · TypeScript · Tailwind CSS ·
Framer Motion · optional Three.js / React Three Fiber (3D lens/knife) · shadcn/ui or custom · responsive, mobile-first.

**Mobile app:** Expo + React Native shell · Expo Dev Client · **native Android module (CameraX/Camera2)** ·
**native iOS module (AVFoundation)** · ReplayKit (iOS) & MediaProjection (Android) for screen capture *where allowed* ·
Skia / React Native Skia for overlays & compositing · GPU shader pipeline for chroma key ·
FFmpeg-mobile for video processing *where legally & technically appropriate* · on-device ML
(segmentation, detection, OCR, enhancement) with optional user-controlled cloud AI ·
RevenueCat (subscriptions) · Supabase or Firebase (auth/data) · local-first media storage ·
Stripe (web payments if needed) · App Store / Play Store billing (mobile).

> The site is deliberately **honest** about hardware limits (§05): software cannot make a sensor
> see IR/UV/thermal wavelengths it physically cannot detect — those require attachments. Screen
> and call recording are treated strictly as **user-consented**, with visible indicators and no
> covert capture.

---

## 7. Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Uses `IntersectionObserver`,
CSS custom properties, `color-mix()`, and Canvas 2D — all broadly supported. Graceful
fallbacks: reveal animations show immediately without `IntersectionObserver`, and the hero
canvas renders a static frame under reduced-motion.

---

## 8. License / status

Concept / pre-launch. All copy is sample product specification. Brand and trademark strategy
pending final legal review.
