---
"docblocks-react-ui": patch
---

The divider block now renders its line over a Tailwind v4 consumer. The hr
carried `border-0` (the `border-width: 0` shorthand) next to the
`border-top-width` utility on the same element: over a consumer whose own
Tailwind build re-emits `.border-0` into the merged `@layer utilities`
(after the package's stylesheet), the shorthand won the cascade and zeroed
the top border width. The class no longer carries `border-0` — the other
sides stay zero over the preflight, and the top width has a single
declarer, so the line stands regardless of the consumer's `.border-0`
order.
