---
"docblocks-core": minor
---

The `mention` mark stands the target's identity only: the `setMark`
input no longer accepts a `label` (the writer stands the id-only
`{ kind, id }` mark), and the mark's `label` field is now the legacy
snapshot — tolerated over the lenient read and accepted by the strict
validator when present (non-empty), ignored otherwise. The display
label is the consumer's resolution (the run's text stands the
insertion-time label). Pre-id-only documents (the `label` snapshot in
the data) stay readable and validatable.
