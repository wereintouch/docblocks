---
"docblocks-core": patch
---

The link href's gate mirrors the WHATWG URL parser's full input
normalization: ASCII tab / LF / CR (U+0009–U+000D) are removed from ANY
position (plus the edge C0 / space trim) before the scheme detection. A
mid-string control could not hide the scheme before — `java\tscript:…`
carried no scheme per the `^[a-z][a-z0-9+.-]*:` test, while the browser's
URL parser strips the control and resolves the `javascript:` scheme, so a
documented link executed as script. The gate is the single stand of the
validator's link check, the renderer's href gate, and the paste's
markdown link re-gate.
