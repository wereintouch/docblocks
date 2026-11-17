---
"docblocks-react-ui": patch
---

The attributes panel's polish: the label column stands the longest
locale key (the Russian's published-date key — the `w-32`), the rows
stand a 4 px gap over the former padding, the row's minimum height
stands dropped (the rows hug the values' band), the "Not set"
placeholder stands the values' font and the column's left edge over
every row, and the `publishedAt` row is display-only (the value is
consumer-owned — the panel's edit entry and the row's removal stand
removed, like the `status` row; the
`docblocks/attributes-published-at` slot now marks the display span).
