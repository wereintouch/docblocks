---
"docblocks-react-ui": minor
---

The presence selection's visibility over the room stands grant-gated (the
privacy stand): the `EditorProvider`'s additive `presence` prop carries
the local user's identity (`userId` / the optional `name`) and the
optional `PresenceCrypto` cipher; the new `usePresenceSharing()` hook
drives the local grant — the session-state default is **off** (the
selection does not publish, only the light identity frame the roster
needs), and the consumer flips it to `everyone` (the plaintext wire
shape, the legacy stand) or to a targeted user-id list (the selection
publishes as opaque ciphertext entries, one per grant member — the
entries carry no target id, a recipient opens only the entry addressed
to it, an unaddressed peer sees the sharer's identity but never the
selection). The library orchestrates the publish gating, the receive's
decrypt, and the per-peer sequence guard over the async decrypt; the
cryptography and the sharing's UI are the consumer's stand (the package
ships no built-in control). A provider without the `presence` prop keeps
the legacy stand (the anonymous plaintext selection over the room).
