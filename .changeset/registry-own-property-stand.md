---
"docblocks-core": patch
---

The block and mark registry lookups stand the own-property stand over the
prototype-key values (`constructor`, `toString`, ...): the unknown block
type named by a prototype key keeps its data over the `fromJSON` /
`toJSON` round-trip (the opaque stand — the reader's lenient contract),
the strict commands refuse the unknown type and mark, and the export's
attr assembly writes own properties only (no prototype swap over a
hostile attr key).
