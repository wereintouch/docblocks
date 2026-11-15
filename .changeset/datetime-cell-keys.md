---
"docblocks-react-ui": patch
---

The database grid's datetime cell commits the draft (the picked date + the
typed time) on Enter over the open picker and closes it, and Escape cancels
the in-flight draft without a write; the close over the outside press / the
trigger press / the session's teardown keeps the deferred commit stand.
