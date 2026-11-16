---
"docblocks-core": minor
---

Document-level attributes: the additive `DocMeta.attributes` field
(a `string | number | boolean | string[] | MentionRef` record) with
the `setAttribute` / `removeAttribute` commands and the
`InvalidAttributeError` over reserved keys and unsupported values.
The record is CRDT-represented (the `meta.attributes` nested map),
converges over the wire (the whole-record LWW over the concurrent
init), and the change flows into the `metaChanged` signal with the
meta's revision bump. The new `MentionRef` value form
(`{ id, label }`) joins the attribute value union for the preset
mention fields.
