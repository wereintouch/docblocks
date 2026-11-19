---
"docblocks-react-ui": patch
---

The canvas culling's margin stands the screen px over every zoom (the
1/zoom's world's conversion in the visible world rect's math): the
band's on-screen width stands constant (300 px), so the off-viewport
items pop in over the pan's edge at a constant on-screen distance
instead of shrinking over the zoom (the 75px stand over the 25% fit).
The tradeoff: the band stands wider over the world at the low zooms —
the heavy canvas's mounted DOM grows over the zoom-out (the culling's
performance stand's documented cost).
