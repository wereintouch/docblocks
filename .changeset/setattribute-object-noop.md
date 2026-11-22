-

"docblocks-core": patch
---

The `setAttribute` no-op stand now holds over the object-form values (the id-only mention reference, the typed attribute value): the stored value is compared over its plain snapshot (the read path) structurally, so a set of the same value stands no write, no undo step, and no wire update.
