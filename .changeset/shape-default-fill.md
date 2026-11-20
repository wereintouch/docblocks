---
"docblocks-react-ui": minor
---

The canvas shape tools' dock placement creates shapes with the neutral
default fill (`#e9ecef`): a new figure has a modest body (the
Miro/Figma look) instead of a stroke-only figure, and the fill palette
is the override (the explicit "none" entry keeps the stroke-only
annotation frame). The pen's stroke (the `points` path) is created
without a fill (its path renders the stroke only); the hit model is
unchanged (an absent fill is a normal figure, the explicit "none"
keeps the outline zone). Existing documents are untouched (no
migration — the default applies to the placement only), and the dark
theme applies the hex's dark neutral value at render (the data keeps
the source hex).
