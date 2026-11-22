-

"docblocks-core": patch
---

The strict validator's dangling-child check now runs over the `blocks` record's own keys (`Object.hasOwn`) instead of the `in` operator: a dangling child id that collides with an `Object.prototype` key (`toString`, `constructor`, …) is reported instead of standing as a present block. The empty reply's payload behavior (the frame-type byte only) is documented.
