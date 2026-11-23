---
"docblocks-react-ui": patch
---

The callout icon catalog and the canvas connector port lookup now use own-key
membership instead of the prototype-chain lookup. A prototype-key value kept
by the lenient reader over the wire data (`constructor`, `__proto__`, ...)
used to resolve through `Object.prototype`: the callout block crashed into
its error placeholder, and the connector endpoint resolved to NaN geometry.
