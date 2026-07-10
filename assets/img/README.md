# Brand images

Drop supplied logo / brand art here, then wire it into the markup.

## Suggested files
- `logo.svg` — primary lockup (mark + wordmark) for the nav.
- `logo-mark.svg` — mark only (lens + Swiss cross), for compact spots.
- `logo-footer.svg` — optional footer variant.
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
