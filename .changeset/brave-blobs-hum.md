---
"docblocks-react-ui": minor
---

The blob store's meta-only stand: the two optional `BlobStore` members
`getMeta(fileId)` (the metadata WITHOUT the bytes — the cheap head stand)
and `downloadUrl(fileId)` (the direct download URL). With them, the
built-in `file` / `image` blocks resolve the metadata first and fetch the
bytes only for a MIME they render (the PDF preview / the `<img>`); any
other MIME stands the download card without fetching the bytes (no `get`
call, no object URL — the download's href stands the consumer's
`downloadUrl`). Without `getMeta` (or without `downloadUrl`) the blocks
keep the legacy stand exactly (the bytes over `get`, the object URL's
href) — existing consumers and `createMemoryBlobStore` are unchanged.
