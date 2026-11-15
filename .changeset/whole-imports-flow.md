---
"docblocks-react-ui": minor
---

The headless whole-document import: `importDocument(doc, source, kind)`
(`kind: "markdown" | "html"`) fills a FRESH document (the empty root) from
a markdown or HTML payload — the consumer-side pre-attach write (the
content stands in the first full-state bootstrap the attach sends, so the
first wire sync persists it). The parsed blocks materialize over the paste
parsers' shared insertion in ONE `doc.transact` (one undo step, one wire
update). The indents stand the parser's absolute nesting (there is no caret
to re-base to) over the sequence's jump-rule clamp (the first block anchors
at indent 0; the rest are capped at the predecessor's +1 — the parser's
dropped-parent gap cannot roll back the import). An empty (or
whitespace-only) payload is a no-op (nothing is written, no transaction);
a non-fresh document (the root already has children) throws the typed
`ImportDocumentError`. The paste path is unchanged.
