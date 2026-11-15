---
"docblocks-react-ui": patch
---

Filter popover fixes: the segment selector's active button no longer
restyles its label over the pill's fill on hover (the ghost button's
hover restyle washed the label to an unreadable color over the primary
fill). The filter popover's condition/group add rows and the clear/apply
footer keep a clear break (the popover's own 10px rhythm over both sides
of the separator).
