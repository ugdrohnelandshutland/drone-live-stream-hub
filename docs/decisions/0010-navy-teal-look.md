# ADR 0010: Navy and teal look

- Status: accepted
- Date: 2026-10-12
- Decided by: product owner (the UI should look related to the applications the drone unit
  already uses)
- Amends: "Design" in ADR 0006 (corners, shadows, accents)

## Decision

The web UI uses a dark navy and teal look, a common style for operations-centre software.
Only design values are defined here; CSS, markup and names are our own:

- **Nacht** = the navy palette: ground `#09111c`, surfaces `#102031`, lines
  `#294057`/`#476079`, text `#e3edf7`/`#a4bacb`, accent teal `#58d5cc`, filled controls
  `#258078` (hover `#2d948b`).
- **Tag**: a light counterpart with the same hues and a darker teal (`#0f6f68`, `#1d6f68`)
  keeps the contrast for sunlight.
- **Shapes**: radii 7 px (buttons), 12 px (tiles, cards), 16 px (dialogs); 1 px lines; the soft
  shadow on dialogs and toasts. The single view stays edge to edge.
- **Type**: the title as a wordmark ("Drohnen-" + "Livestream" in teal), the live count as a
  spaced capital label, a thin line under the header. System fonts as before.
- **Teal means "operable"**: switched-on switches and focus. Signal colours stay reserved for
  status and keep their shapes; the slot number stays the one loud element.
- **Touch**: targets stay ≥ 48 px. Hover styles only under `(hover: hover) and (pointer: fine)`,
  so nothing stays highlighted after a tap on a tablet; `:active` gives feedback on touch.
- **Icon**: navy square, teal shield, with a quadcopter seen from above and a teal lens.
  `src/web/assets/icons/favicon.svg` is the source; the PNGs (32 px favicon, 180 px apple-touch-icon) are rendered from it with
  ffmpeg (librsvg), e.g.
  `ffmpeg -width 180 -height 180 -i favicon.svg apple-touch-icon.png`.

## Consequences

- Only CSS, tokens, the header wordmark and the icons change; behaviour, URLs and tests are
  unchanged.
- Checked by screenshots in Chrome: laptop 1080p, tablet portrait and landscape, phone, Tag and
  Nacht, "Über" dialog.
