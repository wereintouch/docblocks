---
"docblocks-react-ui": patch
---

The editor root's focus-ring stand: the root is a focus park (the
drag's release and the gutter's delete park the focus there so the
keyboard's input stays scoped over the editor) and is reached
programmatically only (tabIndex -1) — the browser's default focus ring
stood the visible ring over the whole document after a drag's release.
The ring is suppressed (`outline: none` on the focused root); the focus
itself stays, and the individual controls keep their own focus styles.
