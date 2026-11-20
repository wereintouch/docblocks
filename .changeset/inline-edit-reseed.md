---
"docblocks-react-ui": minor
---

The inline meta editors (the header's title, the attributes panel's rows,
the key's rename) follow the incoming value while the field stands: a
pristine field reseeds over a value change from the reader (the document's
write, a peer's edit, the consumer's own state) with the caret kept in
place, and a typed draft stands over it — the user's text is never
clobbered mid-edit. The commit and the Escape's cancel are unchanged.
