/** The provider's awareness handling: the remote peers' mapping over the
 *  awareness states, the change's delivery (the frame + the listeners), and
 *  the room teardown over a connection ending. */
import { removeAwarenessStates } from "y-protocols/awareness";
import type { Awareness } from "y-protocols/awareness";

import type { PresenceState } from "../models";
import { buildAwarenessFrame } from "../ws-frames";
import type { WsLike } from "./models";
import { parsePresenceExtras, parseSelection } from "./parse";

/** The awareness "update" event (the changed clients, per category). */
interface AwarenessUpdateEvent {
  added: number[];
  updated: number[];
  removed: number[];
}

/** Map the awareness's remote states (every client but the own) to the wire peer list. */
function remotePeers(awareness: Awareness): PresenceState[] {
  const own = awareness.clientID;
  const peers: PresenceState[] = [];
  awareness.states.forEach((state, clientID) => {
    if (clientID === own) return;
    peers.push({
      peerId: String(clientID),
      selection: parseSelection(state.selection),
      updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : 0,
      ...parsePresenceExtras(state),
    });
  });
  return peers;
}

/**
 * An awareness change's delivery: the changed clients' frame over the open
 * socket — the open flag's gate (as in sendUpdate): the pre-open awareness
 * stands resent over the open handshake (the local state's frame) — then the
 * listeners' emit (always, over the current remote peers).
 */
function onAwarenessUpdate(
  awareness: Awareness,
  open: boolean,
  socket: WsLike | null,
  listeners: Set<(peers: PresenceState[]) => void>,
  event: AwarenessUpdateEvent
): void {
  const changed = [...event.added, ...event.updated, ...event.removed];
  if (changed.length > 0 && open && socket !== null) {
    socket.send(buildAwarenessFrame(awareness, changed));
  }
  emitAwareness(awareness, listeners);
}

/** The awareness listeners' emit over the current remote peers. */
function emitAwareness(awareness: Awareness, listeners: Set<(peers: PresenceState[]) => void>): void {
  const peers = remotePeers(awareness);
  for (const cb of [...listeners]) cb(peers);
}

/** A connection ending (either side) ⇒ all remote peers of the room left. */
function teardownAwareness(awareness: Awareness): void {
  const own = awareness.clientID;
  const remotes = [...awareness.states.keys()].filter((id) => id !== own);
  if (remotes.length > 0) removeAwarenessStates(awareness, remotes, "socket closed");
}

export { onAwarenessUpdate, remotePeers, teardownAwareness };
export type { AwarenessUpdateEvent };
