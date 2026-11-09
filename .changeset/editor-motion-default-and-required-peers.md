---
"docblocks-react-ui": minor
---

The `Editor`'s page view is now the motion row layer (the former
`MotionEditor`'s merge): every page block is its own `Reorder.Item` row —
the drag-reorder (one drag = one range move of the dragged block's
derived subtree), the insert/remove's layout animation, the rendered
list marker per row. Consumers rendering `<Editor>` get the animated,
draggable page without a code change; the `view` / `formatPalette` props
stand. The `MotionEditor` export and the `./motion` subpath are removed
(the base `Editor` is the motion editor — the previous split stood the
base entry without any reorder path, so a consumer taking it got a
non-reorderable editor).

The three peers are now REQUIRED (pre-1.0 breaking): `framer-motion`
(the page view's row layer), `mermaid` (the `./mermaid` subpath), and
`pdfjs-dist` (the `./pdf` subpath) lose their `optional: true` — the
install must carry all of them. The `./mermaid` and `./pdf` subpaths'
wiring stays opt-in (the `pdfPreview` prop / the `code` block renderer);
the required peers guarantee availability only. The static row rendering
stands for the table cells and the canvas's page miniature (the
`BlockGroups`'s stand); the `BlockView`/`BlockNodeView` renderers are
unchanged.
