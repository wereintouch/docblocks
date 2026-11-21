---
"docblocks-react-ui": minor
---

A protocol-relative link opens in a new tab with `noopener,noreferrer` (the
`web` class — it was treated as a relative path before), and the address
popover stores the typed protocol-relative form as an explicit `https://`
URL. The link popover parks the editor root's focus on the commit's effect,
so a fast gesture right after the close is not lost.
