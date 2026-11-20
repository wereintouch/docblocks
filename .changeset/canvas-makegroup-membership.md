---
"docblocks-react-ui": patch
---

Grouping the selected canvas figures leaves their earlier containers: the
engine used to add the members to the new group while the old group kept
them, so a figure stood in two containers and both markers moved it. The
new group's creation and the leave are one transaction (one undo step, one
wire update); an earlier group left without members stands in place (the
empty container is a legal marker).
