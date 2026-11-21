---
"docblocks-core": minor
---

A protocol-relative href (`//example.com/page` — the slash / backslash
pair's equivalence) stands the `web` class: the browser resolves it against
the document's scheme, so it is an absolute URL, never a relative path. The
validator's gate is unchanged — the form was accepted before and stays
accepted.
