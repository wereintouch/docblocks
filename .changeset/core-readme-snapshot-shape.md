---
"docblocks-core": patch
---

The README's snapshot shape stands the actual JSON form: the document
fields (`id`, `title`, the optional `avatar`, `createdAt`) stand at the
top level of the snapshot next to the `blocks` map — the former `meta` /
`children` top-level description was wrong (the `children` order lives
inside the blocks, the `meta` object does not exist in the JSON).
