---
"docblocks-react-ui": minor
---

The `@` mention's contract updates:

- The mention mark is id-only (the pick writes the `{ kind, id }`
  mark; the `mentionInteractions` target stands the identity — the
  label is the consumer's resolution).
- `MentionProvider` gains the optional `resolveLabel(kind, id)`: the
  chip's live label over the target's id (the rename's stand); the
  insertion-time label (the run's text) / the legacy snapshot stand
  otherwise.
- The mention query is the whole `@`-to-caret phrase: the space is
  part of the query (`@my doc` searches `my doc`), and only Escape
  breaks the phrase (the former word-boundary close is removed).
- The pick seats the caret after the chip: the chip is a
  `contenteditable=false` island, and a flat offset over it snaps to
  the adjacent slot (never the chip's text) — the type's
  continuation keeps the focus without a re-click.
- `mentionInteractions` gains the optional `renderEmptyState(query)`
  (the picker's empty state; `null` stands the built-in "No
  matches").
