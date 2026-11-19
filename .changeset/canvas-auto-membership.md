---
"docblocks-react-ui": minor
---

The canvas's created and pasted figures join their container: a shape or a
canvas-text whose centre stands inside a container's box becomes a member of
the top-most such container in the same transaction as the insert — one undo
step — and leaves every earlier owner, so a figure never stands in two
containers. The dock's placement tools, the ghost text block's entry, the pen
stroke, and the paste path stand it; the container, the frame and the
connector never join automatically, and a pasted fragment's own members keep
the fragment's membership (only the fragment's top-level figures join the
target container).
