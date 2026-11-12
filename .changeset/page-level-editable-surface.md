---
"docblocks-react-ui": patch
---

The page view now edits over one shared `contenteditable` surface (the
page's container), with each text block's inner a nested editable: the
native selection crosses block boundaries in every engine, and the
block's handlers receive the container-level events through a dispatch
that resolves the active block from the live selection. The follow-up
keys run in the shared surface's context, so the in-block range's
Delete / Backspace commits as a command (the caret re-seats at the
range's start), the empty cell's activation layer suppresses the
line-backspace, and the Home / End over a page text block resolve the
block's own line edges. The gutter-handle drag's release keeps the
user's text seat: the browser's release over the drag's non-editable
chrome would collapse the selection to the page container (and the
release's click would stand a residual blocks selection), so the drag
session suppresses the release's click over non-text chrome and
restores the captured seat on the release (a drop over a text inner
seats the caret at the drop point instead).
