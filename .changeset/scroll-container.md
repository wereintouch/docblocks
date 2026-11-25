---
"docblocks-react-ui": minor
---

`EditorProvider` takes a `scrollContainer` prop: the element that scrolls
the document when the consumer renders the editor inside its own `overflow`
box instead of the page scroll. The lazy blob resolution's preload band is
an `IntersectionObserver` — an element clipped by an inner scroller never
intersects a window-rooted observer, so the band degenerated to the visible
area and the bytes resolved only once an image entered the view. The band
and the first screen's eager measure now frame on the passed container; a
nested provider inherits it, and `null` (the default) keeps the window
frame — the page-scroll consumers are unchanged.
