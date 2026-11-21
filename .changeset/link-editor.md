---
"docblocks-react-ui": minor
---

Link editing: the format toolbar's link button and mod+k open an address
popover over the selection (an existing uniform link prefills and can be
edited or removed), a bare address resolves by form — a domain becomes an
https URL, an email a `mailto:`, a number a `tel:` — and an invalid address
stands the error. A link opens on a plain click (web URLs in a new tab with
`noopener,noreferrer`, `mailto:` / `tel:` / relative ones in the same tab)
and takes a context menu (open, copy the address, edit, remove). A
plain-text paste links the bare URLs and the email addresses it carries.
