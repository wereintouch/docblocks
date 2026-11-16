---
"docblocks-react-ui": patch
---

**A paste over the full document selection replaces the selection instead
of wiping the document.**

Over the range the seam's absence (the whole-document delete stands no
seam) previously dropped the paste payload and cleared the document of all
blocks with no undo restore and an unplaceable caret. Now, when the
selection's delete consumes the whole document and no seam remains, a
fresh empty paragraph is inserted at the root as the paste seat and the
payload materializes into it (one transaction, one undo step); a
whitespace-only full paste leaves the editable empty seat. Partial
cross-range pastes are unchanged.
