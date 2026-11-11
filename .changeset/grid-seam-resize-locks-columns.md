---
"docblocks-react-ui": patch
---

The database grid's column-seam resize locks every column over its
rendered width for the drag's duration: over a fresh grid (the columns'
flexible tracks) the first drag's live preview no longer shrinks the
untouched columns as the dragged column grows — only the dragged column
moves. The preview's locked layout is exactly the release's commit (the
untouched columns' start measurement), so the release stands no jump.
