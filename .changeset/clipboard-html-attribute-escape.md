---
"docblocks-react-ui": patch
---

The code block's clipboard `text/html` payload now escapes the double quote
in the language's `class` attribute (and in the code's body). A hostile
`language` value (a free data string, reachable through a raw document
write or a markdown fence's info) could otherwise open a new HTML attribute
in the serialized payload and reach the clipboard of a third-party paste
target.
