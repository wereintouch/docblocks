---
"docblocks-react-ui": patch
---

The canvas frame stands a pure region boundary — it renders no content
copy. The frame renders the boundary (the transparent box, the border, the
optional title chip); the interior is transparent, so the canvas content
that falls under the box stands once over the surface (no mirror, no
inert copies, no nested frame windows). The page-frame block's window is
the only mirror of the canvas content — the clipped, inert cut over the
page.

This changes the frame's visual contract: a frame no longer re-renders the
surface's children inside its box (the former viewport-window behavior),
and the page-frame block's window no longer carries the nested frame
window's copies (a frame inside the referenced frame now stands its
boundary over the window, not a second cut of the content).
