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

The same stand over the remaining lookup points: the `changeBlockType`'s
attrs merge (the target spec's whitelist membership over the own
properties — the hostile key stands reset like the type-specific attrs,
the patch's hostile key stands the strict rejection, the own writes keep
the prototype's setters out), the strict mark-field validation (an
unknown field named like an `Object.prototype` member stands the
rejection — the strict posture rejects rather than preserves it), and the
export's
id-keyed assemblies (the own writes over the `blocks` / `rows`
dictionaries — the wire's defense in depth).
