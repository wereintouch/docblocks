/**
 * sync — document sync transport: the SyncProvider interface, the presence
 * wire types, and the attach() glue that routes a document to a provider.
 */
export { attach } from "./attach";
export type { SyncSession } from "./attach";
export type { PresenceSelection, PresenceState, SyncProvider, Unsubscribe } from "./provider";
export { WsSyncProvider } from "./ws-provider";
export type { WsLike, WsSyncOptions } from "./ws-provider";
