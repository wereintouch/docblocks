---
"docblocks-react-ui": patch
---

A standalone markdown image line (`![alt](src)`) is dropped by the markdown
import and paste, the same stand the `text/html` paste already takes with
`<img>`: the document's image source is an opaque blob-store key, and a
markdown payload carries no bytes to store under one — the materialized
block took the source string verbatim (`img.png`, an external URL) and stood
a permanently broken `image` block whose store lookup never resolves. The
inline image in the middle of a line keeps its literal text. An imported
image becomes a real `image` block only through the consumer's upload.
