---
"docblocks-react-ui": patch
---

The paste surface's hardening: the markdown paste's link stand re-checks
the href over the core's public `isSafeLinkHref` itself at both the raw
parse and the entity-decode pass (the trimmed form — the browser trims
the leading C0 controls before the scheme detection, so the parser's
mirror stands the writer's contract: the `<a href>` tag, the exposed
entity's scheme, and the entity-hidden leading C0 degrade the run to
plain text instead of aborting the multi-block paste over the core's
strict mark rejection); and the clipboard's HTML serializes the mark
values escaped (the hostile remote data's stand — the attribute break
over the third-party paste target is closed).
