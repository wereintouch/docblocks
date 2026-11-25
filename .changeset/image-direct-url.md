---
"docblocks-react-ui": minor
---

An image renders straight from the store's `downloadUrl` when the store
supplies both optional members: the `image` block's `<img>` src is
`downloadUrl(fileId)` — the browser's own cacheable subrequest — instead of
the bytes fetched over `get` into an object URL. A response fetched into a
blob URL never reuses the native response cache on WebKit, so a page reload
in Safari re-downloaded every image regardless of the backend's
`Cache-Control: immutable`. `getMeta` still decides the MIME and reserves
the placeholder's aspect ratio; the consumer's URL must serve the payload
inline (a `Content-Disposition: attachment` response suits the download card
only). PDF payloads (the preview and the native iframe), the covers'
dimension probes, a store without `getMeta` (the MIME is unknown before the
bytes) and an executable-scheme URL keep the bytes' path; without
`downloadUrl` nothing changes.
