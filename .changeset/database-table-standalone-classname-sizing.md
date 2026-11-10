---
"docblocks-react-ui": patch
---

The standalone `DatabaseTable` gains a `className` prop: the consumer's
sizing / layout classes merge over the component's root (the package's
`--docblocks-*` token scope's anchor, merged with the consumer's own
classes). The grid already stands the root's width (`w-full`); the
`className` closes the height's stand — a height-constrained root (the
consumer's `h-*` class) stands the grid's inner scroll over the toolbar

- header + rows (the card / content / grid-region's flex plumbing:
  `flex-1 min-h-0`), and the unconstrained's stand is the content's height
  (as over the document's database block — the plumbing stands inert over
  the block's context).
