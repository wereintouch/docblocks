---
"docblocks-react-ui": patch
---

The PDF preview (the `./pdf` subpath's `PdfFirstPage`) gains page
navigation + a fullscreen mode. The inline view stands a control bar under
the canvas: the previous/next page buttons (disabled at the first/last
page), the page indicator, and the fullscreen toggle. The fullscreen mode
opens a portal overlay over the viewport (the page scaled to the viewport,
the same page navigation, the Escape key / the close button exit). The
inline + the fullscreen views share the page state, so a page switch in
either re-renders both.
