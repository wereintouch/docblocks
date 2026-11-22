---
"docblocks-react-ui": patch
---

The ref-table data provider (`useRefTables`) now coalesces its live
refreshes per entry: a bridge envelope that arrives over a running full
page-set load marks the entry pending instead of firing a parallel load,
and the pending re-run stands over the running load's write — a burst of
envelopes runs the running load plus one trailing load, and overlapping
loads never interleave their states.
