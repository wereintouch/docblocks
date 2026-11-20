---
"docblocks-react-ui": minor
---

The mention chip's hover stands the link's affordance when the consumer
supplies `mentionInteractions`: the pointer cursor and a light neutral
background over the chip's rounded rect (3px radius, a 2px offset from
the letters) with a 120ms fade. The editor root marks the interactive
stand over `data-mention-interactive`, so a chip without the interactions
stays inert (no cursor, no highlight) and the consumer's own CSS can key
on the same hook. The chip carries the padding over the interactive stand
only, so the hover stands no layout jump; the row keeps its plain-text
height and the read-only modes keep the same hover (the observing
gesture's parity). The hover background reads the new
`--docblocks-mention-hover-background` token (the standard `--muted`'s
mapping, light and dark fallbacks).
