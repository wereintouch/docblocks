---
"docblocks-react-ui": patch
---

Fix the sliding-pill segment selector's stand over an ancestor transform:
the active-button geometry now stands the scale factor (the
`getBoundingClientRect`'s delta and size over the untransformed layout's
factor), so the pill's measurement over a transformed container — the
popover's `zoom-in-95` entry's frames — stands the list's local
(untransformed) geometry. The pill no longer stands off (shifted toward
the group's start, sized under) over the later options' stand when the
selector's container mounts over an entry animation; the end position
stands exact over the animation's frames.
