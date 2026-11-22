---
"docblocks-core": patch
---

The `SyncProvider.sendUpdate` contract now documents its no-throw's
posture: the callback runs synchronously inside the originating
transaction, so a provider's throw stands the transaction's failure —
the committed batch rolls back and the `transact`'s reject reaches the
caller (the behavior is pinned by a test). Providers stand the buffering
stand instead of throwing (the WsSyncProvider's pending buffer over the
closed socket).
