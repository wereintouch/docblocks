---
"docblocks-react-ui": patch
---

The color pickers stand one shared mechanism (the canvas's palette's
parity): the circular swatches over the shared `ColorSwatches` with the
custom rainbow's swatch + the hex's input, and the trigger's preview over
the shared `ColorChip` (the current's color, the hollow's stroke over the
stroke's attrs, the `X` over the absent).

- The callout's menu: the native `input type="color"`'s picker stands
  removed. The custom color's commit stands over the hex's field (the
  Enter / the blur over the valid value); the close over the uncommitted
  draft discards it (the canvas's Esc's parity — the former's
  commit-on-close's scrub stands no stand). The
  `docblocks/callout-color-picker` slot now marks the hex's input.
- The table's row / column background: the own square swatch's grid stands
  removed over the shared's palette (the subcontent's slot
  `docblocks/table-color-palette`); the conditional `Remove background`'s
  item stands removed — the shared's none's swatch
  (`docblocks/palette-none`) is the clear's mechanism. The handle's menu
  closes over a swatch's pick (the palette's buttons stand no Radix
  item's close of their own).
- The page format toolbar's color trigger stands the current's color's
  chip (the mark's hex; the `X` over the absent / the mixed's range).
- The `ColorChip`'s primitive (the `docblocks/color-chip`'s slot) is the
  shared's trigger's preview.
