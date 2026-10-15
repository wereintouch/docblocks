import type { PresenceSelection, PresenceState } from "docblocks-core";

/**
 * The pane's remote-peers panel. Each peer renders its selection anchor as
 * `<letter>:<blockId>:<offset>`; a peer whose selection has more than the
 * anchor point (a range or a block set) gets a second line with the age of
 * the peer's `updatedAt` (seconds since the pane mount) and the full
 * selection as compact JSON. A caret is fully described by the first line,
 * so it keeps exactly that one line.
 */

/** The peer's anchor line: `<letter>:<blockId>:<offset>`; null for a block-set selection. */
function anchorLine(letter: string, selection: PresenceSelection | null): string | null {
  if (selection === null) return null;
  if ("blockId" in selection) return `${letter}:${selection.blockId}:${selection.offset}`;
  if ("from" in selection) return `${letter}:${selection.from.blockId}:${selection.from.offset}`;
  return null;
}

/** The peer's second line: age plus the full selection JSON; null for a caret (the anchor line suffices). */
function detailLine(mountAt: number, peer: PresenceState): string | null {
  const selection = peer.selection;
  if (selection === null || "blockId" in selection) return null;
  const age = Math.max(0, Math.round((peer.updatedAt - mountAt) / 1000));
  return `t+${age}s ${JSON.stringify(selection)}`;
}

function PresencePanel({
  client,
  peerLabel,
  mountAt,
  peers,
}: {
  /** The letter of the remote peer (the harness runs exactly two clients). */
  client: "a" | "b";
  peerLabel: string;
  /** Unix ms of the pane's runtime mount (the `updatedAt` age reference). */
  mountAt: number;
  peers: PresenceState[];
}) {
  return (
    <div data-testid={`presence-${client}`} style={{ border: "1px solid var(--border)", marginTop: 8 }}>
      <div style={{ padding: 8, fontFamily: "monospace", fontSize: 11, overflow: "auto", maxHeight: 220 }}>
        {peers.length === 0 && <div style={{ color: "var(--muted-foreground)" }}>no peers</div>}
        {peers.map((peer) => {
          const anchor = anchorLine(peerLabel, peer.selection);
          const detail = detailLine(mountAt, peer);
          if (anchor === null && detail === null) return null;
          return (
            <div key={peer.peerId}>
              {anchor !== null && <div>{anchor}</div>}
              {detail !== null && <div style={{ color: "var(--muted-foreground)", paddingLeft: 8 }}>{detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { PresencePanel };
