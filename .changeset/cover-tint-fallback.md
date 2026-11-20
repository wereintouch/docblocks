---
"docblocks-react-ui": patch
---

The cover tint's border stands the plain border until the cover's average
color resolves: the tint variable lands only once the blob's read and the
image's decode settle, and an undefined variable inside the color mix
invalidated the whole border-color — the dark theme flashed its near-white
text color as the frame's border over that window.
