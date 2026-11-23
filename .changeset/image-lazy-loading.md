---
"docblocks-react-ui": minor
---

The image and file blocks resolve their bytes lazily: the metadata's lookup
(the store's `getMeta`) runs at mount and the bytes (`get` + the object URL)
wait for the block to enter the viewport's preload band (the viewport grown
by the `--docblocks-image-preload-margin` token, 200% by default; the blocks
above the fold on mount and the cover resolve eagerly). The new optional
`EditorProvider.blobLoading` prop (`"lazy"` by default, `"eager"` for the
previous behavior, inherited by nested providers) sets the policy. The new
optional `BlobMeta.width` / `BlobMeta.height` let the placeholder reserve the
image's aspect ratio, so the resolution never shifts the page. The resolved
`<img>` carries `loading="lazy"`, `decoding="async"`, and the metadata's
`width`/`height` (the box reserved before the decode).
