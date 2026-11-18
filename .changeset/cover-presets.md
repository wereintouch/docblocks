---
"docblocks-react-ui": minor
---

The cover's upload modal's preset gallery (the `coverPresets` provider
prop): the consumer's ready-made cover's file ids (the consumer's blob
store's ids — the same ids the store's `get` resolves) per placement
mode (the `tile` / the `center`'s set, each optional). The modal
renders the current mode's set over the 4-column's scrollable grid (the
visible's 3 rows' cap — the overflow scrolls, the 4-column's width
stands; a set over 12 ids scrolls, a shorter one stands the fewer
rows). The mode's switch stands the set's switch over the same grid,
and a pick commits the id over the mode WITHOUT an upload (the upload's
gate never runs over a preset — the consumer's catalog's curation's
stand; the thumbnails resolve over the store's `get`, the placeholder
over the loading / the missing's stands). Without the prop the grid
stands absent and the modal stands the enlarged's base's stand (the
former's 400 px's width stands the 440 px's, the drop zone's height the
112 px's over the 144 px's).
