/**
 * The in-memory standard y-websocket relay's entry (the re-export surface
 * the specs import from): the relay's mechanics stand in ws-relay-rooms.ts,
 * the fake-socket / PRNG fixtures in ws-relay-sockets.ts.
 */

export { WsRelay } from "./ws-relay-rooms";
export { mulberry32 } from "./ws-relay-sockets";
export type { FakeSocket } from "./ws-relay-sockets";
