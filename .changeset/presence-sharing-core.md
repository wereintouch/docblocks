---
"docblocks-core": patch
---

`PresenceState` now passes through the awareness payload's sharing
contract fields — the consumer user identity (`userId` / `name`), the
opaque ciphertext selection entries (`selections`), and the publication
counter (`seq`). The ws-provider mapper validates them defensively; a
legacy frame keeps its pre-sharing shape.
