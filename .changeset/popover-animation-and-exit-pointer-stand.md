---
"docblocks-react-ui": patch
---

The shared popover's enter and exit animations now run: the classes were
keyed on `data-open` / `data-closed` attributes that Radix does not set
(it sets `data-state="open" | "closed"`), so the animations never applied
and the content teleported in. The closed content now gets
`pointer-events-none` for the exit animation, so a fading popover does
not swallow the press landing over its area.
