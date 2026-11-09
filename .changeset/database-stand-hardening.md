---
"docblocks-react-ui": patch
---

The external-form database stand's hardening: the bridge tables' picker
guards the `listTables` rejection (the unhandled rejection stands the
logged error + the empty list stand), and the hook's undo / redo drops
the replaced entry by identity (the in-flight inverse over the history's
mutation no longer drops the fresh entry — the double-apply and the
stale restore are closed). The database JSDoc stands the actual
contract: the mixed paste's description is self-contained, and the lost
response's reconciliation is the consumer's stand over the bridge's
`getOperationStatus` (the UI's convergence is the rebaseline).
