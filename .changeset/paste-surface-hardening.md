---
"docblocks-react-ui": patch
---

The paste surface's hardening: the markdown paste's link stand re-checks
the href over the core's `https?` contract at both the raw parse and the
entity-decode pass (the `<a href>` tag and the exposed entity's scheme
degrade the run to plain text instead of aborting the multi-block paste
over the core's strict mark rejection), and the clipboard's HTML
serializes the mark values escaped (the hostile remote data's stand —
the attribute break over the third-party paste target is closed).
