---
"docblocks-react-ui": patch
---

The markdown frontmatter drops a `__proto__` key: the entries live in plain
objects, where the assignment wrote the prototype chain instead of a value,
so a pasted or imported header could poison the parse's record. The key never
reaches the document's meta, and the rest of the header parses as usual.
