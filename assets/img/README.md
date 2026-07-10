# Brand images

**A designed logo already ships** — the *aperture-iris + Swiss-cross + precision-bezel* mark.
Swap these for your own art only if you want a different identity.

## Shipped logo files
- **`logo-mark.svg`** — the mark (aperture iris + instrument bezel + Swiss cross). Ring uses `currentColor` (adapts to any background); cross is Swiss red `#E0231C`.
- **`logo.svg`** — horizontal lockup (mark + `SWISS ARMY CAMERA.` wordmark).
- **`logo-appicon.svg`** — rounded app-icon tile (dark handle + red edge + mark), 512×512.

The mark is also **inlined** into `index.html` (nav, footer, CTA) as SVG so the ring follows
the light/dark theme via `currentColor` and the cross uses the `--red` token. The favicon is a
simplified inline data-URI version of the same mark; `apple-touch-icon` points at `logo-appicon.svg`.

## Optional additions
- `og-image.png` — 1200×630 social/share preview (add a matching `<meta property="og:image">` in `index.html`).
- `app-badge.png` — product image for the hero device `.device__badge` slot.

## Where they plug in (all marked `LOGO PLACEHOLDER` in the code)
| Location | Selector in `index.html` | Currently |
| --- | --- | --- |
| Nav | `.brand__mark` | inline SVG (lens + cross) |
| Hero device | `.device__badge` | text badge `SAC · 01` |
| Footer | `.footer__logo` | inline SVG |
| CTA band | `.cta__mark` | inline SVG |

Example swap for the nav mark:

```html
<!-- was: <span class="brand__mark"> …inline svg… </span> -->
<img class="brand__mark" src="assets/img/logo-mark.svg" alt="Swiss Army Camera" width="26" height="26" />
```

## Logo concept
Swiss-Army-knife handle + camera lens + Swiss cross. The inline SVG placeholders approximate
the **lens ring + red Swiss cross** so the layout reads correctly before final art exists.

> Keep trademark strategy in mind: the cross and “Swiss Army” wording are placeholders pending
> final legal/branding review.
