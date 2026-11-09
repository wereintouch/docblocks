---
"docblocks-react-ui": patch
---

The paste's markdown link re-gate stands the mid-string control's
degrade: an href with a tab / LF / CR between the scheme's letters
(`java<tab>script:…`) no longer passes the gate — the check runs over
the WHATWG URL parser's full input normalization (the control is
removed from any position before the scheme detection, the browser's
parity). The run degrades to plain text over the unsafe href (the core's
gate is the single stand; this package's mirror passes it through).
