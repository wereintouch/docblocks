---
"docblocks-core": minor
---

Document-level attributes: the additive `DocMeta.attributes` field
with the `setAttribute` / `removeAttribute` commands and the
`InvalidAttributeError` over reserved keys and unsupported values.
The value union: `string | number | boolean | string[] | MentionRef |
TypedAttributeValue` — the typed form (`{ type, value }` over the
`ATTRIBUTE_TYPES` enum: string / number / boolean / list / mention)
stores the declared value type as data (the consumer's type-picker's
parse contract). The `MentionRef` is the id-only reference
(`{ id }`, the legacy `{ id, label }` snapshot still readable and
validated) — the display label is the consumer's resolution, never a
document field. The record is CRDT-represented (the `meta.attributes`
nested map), converges over the wire (the whole-record LWW over the
concurrent init), and the change flows into the `metaChanged` signal
with the meta's revision bump.

The `DocMeta.attributesOrder` field (the attributes' display order) with
the `reorderAttributes(order)` command: an optional permutation of the
`attributes` keys, CRDT-represented as a `meta` array, normalized in
`fromJSON` / the validator (unknown keys dropped, missing keys appended,
absent over the empty record). `setAttribute` / `removeAttribute` maintain
the field (a new key appends, a removed key drops, the empty order is not
emitted). `reorderAttributes` takes a full permutation in one transaction
(`InvalidAttributeError` over a non-permutation, a no-op stand over the
same order). Absence is the legacy stand (the sorted record order) —
older data reads unchanged.
