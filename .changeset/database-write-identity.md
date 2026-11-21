---
"docblocks-react-ui": patch
---

The database table's row and column writes drop their late tail after the
block's table changes: a rollback, an error note or a post-commit refetch of
the previous table no longer overwrites the relinked grid's rows or leaves it
loading.
