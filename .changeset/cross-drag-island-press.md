---
"docblocks-react-ui": patch
---

A press over a non-editable island inside the text (the mention chip, an
image figure, the table's chrome) starts no cross-drag caret session: the
session used to seat the selection on the island's line and focus the
editable with it, which pulled the scroll port to the chip and left the
caret away from the pressed point. A self-contained editable inside the
island (a table cell's inner, the empty cell's activation layer) keeps its
session.
