---
"docblocks-react-ui": patch
---

The enum column's edit form no longer deletes options added concurrently
over the open form. The commit's delete set is now the form's prefill (the
options the user saw) minus the kept, so an option an other client adds
while the form is open survives the save; the user's own removals over the
form still stand.
