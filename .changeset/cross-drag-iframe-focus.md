---
"docblocks-react-ui": patch
---

Fix the caret's re-seat over a text block after the focus stood in an
embedded iframe (the embed's click): the cross-block selection's
mousedown suppression no longer stands over such a press — the
mousedown's default is the browser's focus move out of the frame, and
suppressing it left the editor's document unfocused (no visible caret,
the keystrokes' no-stand; only a double-click recovered it). The
press now lets the default stand (the native focus move + the caret's
seat) and tears the selection session down.
