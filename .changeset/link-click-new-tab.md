---
"docblocks-react-ui": patch
---

The link's click over the edit's mode: the browser cancels the anchor's
navigation default inside the contenteditable (the caret's seat stands),
so a clicked link stood dead — the editor now opens the href itself over
the new tab's stand (`noopener,noreferrer`, the `window.open`'s
gesture's call) — the edit and the view's modes stand the same contract
(the reader's same-tab's carry-away's off), the editor's state stands
untouched (the caret's seat and the focus are the mousedown's default's
work — preserved; no write, no navigation). A press-drag over the link
(the selection's gesture) stands no open (the down/click distance's
guard); the modified clicks and the middle-click stand the browser's
native stands; the rendered anchor stands `rel="noopener noreferrer"`
(the native open's security's parity).
