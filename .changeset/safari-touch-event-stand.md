---
"docblocks-react-ui": patch
---

The motion drag's pointer-Y helper no longer tests the event against the
global `TouchEvent` (the `instanceof` stand): the global is absent on the
no-touch Safari (a desktop Safari on macOS), so every drag callback threw
a `ReferenceError` and the block drag-reorder failed there. The touch's
stand is duck-typed over the event's own `changedTouches` property.
