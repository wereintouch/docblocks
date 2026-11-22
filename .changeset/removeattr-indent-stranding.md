---
"docblocks-core": patch
---

The `removeBlockAttr`'s doc-level invariants now cover the flat page model's
indent jump rule: removing `indent` (the block's outdent to 0) is rejected
with a typed `InvalidOperationError` when the following block would be
stranded, the `updateBlock`'s outdent parity. A mid-transact removal (the
segment outdent's composition) stands the same in-batch escape.
