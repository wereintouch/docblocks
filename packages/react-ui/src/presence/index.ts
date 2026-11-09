// The presence unit's cross-unit surface: the caret/range overlay
// component (the peer and the pixel geometry relative to the editor root)
// and the sharing contract's types (the grant mode, the consumer cipher,
// the roster entry, the session-state hook's shape).
export { PresenceCaretOverlay } from "./PresenceCaretOverlay";
export { buildPresencePayload, resolvePeerSelection } from "./sharing";
export type { PublishParams } from "./sharing";
export type {
  OverlayBox,
  PresenceCrypto,
  PresenceIdentity,
  PresencePeer,
  PresenceSharing,
  PresenceSharingMode,
} from "./models";
