---
"docblocks-react-ui": patch
---

The provider hooks' misuse now throws the typed `HookMisuseError` (the
`DocBlocksUiError` family, exported over the entry point) instead of a
raw `Error`: an editor hook rendered outside the `EditorProvider`, or a
block hook outside its block context, is catchable by class. The
`./motion` subpath's references in the shipped comments stand replaced
over the current stand (the base entry's row layer — framer-motion the
required peer).
