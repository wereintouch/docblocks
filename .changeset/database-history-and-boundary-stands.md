---
"docblocks-react-ui": patch
---

The external-form database's history and boundary stands:

- the undo / redo's in-flight window — a forward write that commits while
  the undo's inverse (or the redo's forward) is in flight stands the
  history's invariants: the undo's path consumes the undone op (popped from
  the undo stack, not moved to the redo stack — the fresh write cleared the
  redo side, and the re-commit over the newer entry would clobber it), and
  the redo's path re-enters the op on the undo stack at the call's position
  (below the window's writes, not on top — the undo order's inversion is
  closed, the first undo reverts the newest write).
- the operation's rejections stand the structured `BridgeError` (the code's
  retry / the clear's decision stands the first-class property, not the
  `cause`'s dig): a rejection that carries no machine code stands the
  transport-level `unavailable` (the safe recovery is the same-operationId's
  reconciliation, not a blind new operation).
- the cell-value equality stands the element-wise comparison over the
  composite value (the multi-select's array) — the identity stand committed
  the no-op over the same content and pushed the undo entry.
- the enum's options catalog stands the full page set (the cursor's
  continuation to the tail) over the single page's `limit: 200` — the
  truncated catalog over 200 options stood the silent-ignored delete of the
  truncated option over the commit's diff.
- the column form's commit failures stand the logged error + the catalog's
  re-read (the partial stand over the move's second commit), the silent
  catches are gone.
