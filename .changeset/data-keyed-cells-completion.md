---
"docblocks-react-ui": patch
---

The database grid's data-keyed cell writes now build their cell maps over
the null-prototype's map everywhere the keys stand the bridge's column ids
(the enum column form's option cells, the multi-cell paste, the keyboard's
clear, the write's inverse / clean / batch restore): a hostile column id
(`__proto__`) stands the inert own entry, not the prototype's write —
the cell keeps its value over the write instead of standing silently
dropped.
