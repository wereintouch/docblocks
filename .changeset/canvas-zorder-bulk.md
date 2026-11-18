---
"docblocks-core": patch
---

Fixed the canvas surface's bulk stand (the large canvas's quadratic
guards): the per-command z-order mirror's refresh now skips the
unchanged siblings (the yjs's equal-value `set` allocates a new item —
the bulk insert of a 5000-figure surface stood the 4 GB allocation and
the crash), and the dense z-order's read derives the surface's positions
once per transaction (the per-block walk over the surface's whole
children stood the bulk read's quadratic stand — the 5000-figure
`toJSON` dropped from ~14 s to tens of ms). The derived read's
convergence's stand stands (the walk over the current's order, the
stale's mirror's tolerance, the mid-transaction's parity).
