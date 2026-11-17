---
"docblocks-react-ui": patch
---

The cover's upload gate: the image's intrinsic height is checked over
`createImageBitmap` before the upload — a cover shorter than 150 px is
rejected (the upload never reaches the consumer's blob store; the inline
hint stands the threshold, and the next attempt clears it), and an
undecodable payload stands the fail-open (the upload proceeds).
