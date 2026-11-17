---
"docblocks-react-ui": minor
---

**Consumer-owned tags: the `docTags` contract (the document's no-storage's
stand).**

The `tags` row of the document-attributes panel no longer reads or writes
the document's `attributes.tags` record: the tags are never document data
(a consumer that stores its tags in its own database no longer races the
document's copy). The consumer passes the tags over the new `docTags`
provider prop and the panel displays the passed list and reports the
user's tag actions:

- `docTags.tags` — the document's tags (`{ id, label }[]`; the
  consumer's type may extend it — the extra fields stay opaque);
- `docTags.onTagAdd` — the add affordance's click (the consumer opens its
  own creation's UI — the tag's picker over its catalog, the creation's
  flow; the package opens nothing);
- `docTags.onTagRemove(tag)` — the chip's removal (the consumer removes
  over its own store and passes the updated list back over `tags`);
- `docTags.onTagClick(tag, event)` — the chip's click (the native
  `MouseEvent`; the package opens nothing and preventDefaults nothing —
  the navigation's stand is the consumer's); it stands over the read-only
  modes too (the observing gesture's parity).

**Breaking (the 0.x's minor's stand)**: the `tagEditor` provider prop (and
its `TagEditor` / `TagEditorProps` types, exported since 0.9.0) is removed
— its contract committed the list into the document (the
`onTagsChange`'s `setAttribute`), which the consumer-owned stand
supersedes. A consumer on 0.9.x migrates over the `docTags`'s contract
(the chips' display stands unchanged); the legacy's stored
`attributes.tags` data stays readable over `doc.meta.attributes`
(migration's read) and the markdown frontmatter's import keeps writing it
(the data's stand — the panel is decoupled from the record).
