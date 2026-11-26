---
"docblocks-react-ui": patch
---

The floating format toolbar never paints over the consumer's chrome above the
editor: a selection the DOM carries no rect for (the canvas/page switch
re-seats it over a re-mounted page) keeps the bar's last position instead of
anchoring off an empty rect, and the bar's own stand never lands above the
editor root's upper edge.
