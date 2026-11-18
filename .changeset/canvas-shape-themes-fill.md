---
"docblocks-react-ui": minor
---

The canvas figure's fill stand over the themes (the render-time's transform,
no document data change): the light theme stands the fixed-hex fill verbatim
(import fidelity), the dark theme stands the light fixed fill darkened (the
dark corridor — the hue kept, the lightness over the dark, the saturation
reduced; dark fills pass through; palette-token fills are unchanged in both
themes). The figure text without an explicit `textColor` resolves the
contrast against the effective fill (black or white by the better WCAG
contrast; an explicit `textColor` always wins). The dark-class flip
re-renders the figures with no wire writes and no document-state mutation;
the strokes pass through unchanged.
