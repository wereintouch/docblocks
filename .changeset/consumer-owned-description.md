---
"docblocks-react-ui": minor
---

The consumer-owned description contract (the `docDescription` provider
prop): the description stands out of the document's data — the
consumer's store is the source (the document never stores or syncs it),
and the panel's `description` row displays the passed value and reports
the user's edit over the `onEdit` callback (the panel's inline editor's
commit — the entered string verbatim; the empty string stands the
removal's stand — the consumer clears its store over the callback; the
row's removal's affordance stands over the non-empty's value and commits
the empty string's stand). Without
`onEdit` the row stands display-only (over the edit mode too). Over the
prop's presence the row stands out of the `renderAttribute`'s reach
(the consumer's value is the source). Without the prop the row keeps the
built-in stand (the value over the doc's `attributes.description`
record); the legacy's stored `attributes.description` stands inert over
the prop's presence (the migration's read over `doc.meta.attributes`),
and the frontmatter's import keeps writing it (the data's stand — the
panel is decoupled).
