/** The canvas arrow-key nudge: each arrow
 * press moves the selection by the world px step (the Shift stands the
 * multiplier) — a real move, not a preview: one setGeometry per item in
 * one transact (one undo step, one wire update). The move session's
 * target contract stands: the connector carries no box (never a
 * target), the container stands the unit (the members ride the one
 * delta). */
import type { BlockId, Doc, Selection } from "docblocks-core";

import { effectiveGeometry } from "../blocks/canvas-geometry";
import type { Box } from "../blocks/canvas-geometry";
import { NUDGE_SHIFT_MULTIPLIER, NUDGE_STEP_PX } from "./viewport/constants";
import { unitMembers } from "./viewport/hooks";

/** The nudge keys (the plain arrows — the Shift is the only modifier). */
const NUDGE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

/** The in-flight gesture flags the nudge yields to (each gesture owns
 * the keys — the move / the resize / the endpoint drag, the pan /
 * marquee / the pen / the drag-to-size sessions, the active tool, the
 * pending connector stand; the editing surfaces stand the caller's
 * guard). */
interface NudgeGateFlags {
  move: boolean;
  resize: boolean;
  pan: boolean;
  endpoint: boolean;
  marquee: boolean;
  pen: boolean;
  place: boolean;
  tool: boolean;
  pending: boolean;
}

/**
 * The nudge key's delta (canvas world px): the direction's axis times
 * the step, the Shift standing the multiplier; null over the non-nudge
 * keys.
 */
function nudgeDelta(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? NUDGE_STEP_PX * NUDGE_SHIFT_MULTIPLIER : NUDGE_STEP_PX;
  switch (key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * The nudge's gate: the canvas's blocks selection stands and no gesture
 * is in flight (see the flags) — the in-flight gestures own the keys
 * (their cancel / commit paths), the page's text blocks and the editing
 * surfaces keep their own arrows (the caller's guards).
 */
function nudgeGate(flags: NudgeGateFlags, selection: Selection | null): boolean {
  if (selection === null || selection.kind !== "blocks" || selection.ids.length === 0) return false;
  return !(
    flags.move ||
    flags.resize ||
    flags.pan ||
    flags.endpoint ||
    flags.marquee ||
    flags.pen ||
    flags.place ||
    flags.tool ||
    flags.pending
  );
}

/**
 * The nudge's move targets over the selection (the move session's
 * contract): the connector carries no box (never a target), the
 * container stands the unit (itself + the transitive members — the
 * members keep their absolute coordinates, the unit takes the one
 * delta), the repeated ids stand once. Each target's effective geometry
 * (the stored, or the synthesized default) keyed by id.
 */
function nudgeTargets(doc: Doc, ids: BlockId[]): Map<BlockId, Box> {
  const targets = new Map<BlockId, Box>();
  const all: BlockId[] = [];
  const add = (id: BlockId, box: Box) => {
    all.push(id);
    targets.set(id, box);
  };
  for (const id of ids) {
    const block = doc.getBlock(id);
    if (block === null || block.type === "connector") continue;
    if (block.type === "group") {
      if (!all.includes(id)) add(id, effectiveGeometry(block));
      for (const memberId of unitMembers(doc, id)) {
        const member = doc.getBlock(memberId);
        if (member === null || all.includes(memberId)) continue;
        add(memberId, effectiveGeometry(member));
      }
      continue;
    }
    if (all.includes(id)) continue;
    add(id, effectiveGeometry(block));
  }
  return targets;
}

/**
 * Nudges the selection's canvas items by the (world px) delta: one
 * setGeometry per target in one transact — one undo step, one wire
 * update (the move release's contract). The vanished blocks (the
 * concurrent removals) stand the skip; the targetless selection stands
 * the no-op (no transact — the empty commit would stamp the meta and
 * emit an update for nothing). Returns the nudged ids, null when
 * nothing stood.
 */
function nudgeSelection(doc: Doc, ids: BlockId[], dx: number, dy: number): BlockId[] | null {
  const targets = nudgeTargets(doc, ids);
  if (targets.size === 0) return null;
  const nudged: BlockId[] = [];
  doc.transact(() => {
    for (const [id, box] of targets) {
      if (doc.getBlock(id) === null) continue;
      doc.setGeometry(id, { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
      nudged.push(id);
    }
  });
  return nudged.length > 0 ? nudged : null;
}

export { NUDGE_KEYS, nudgeDelta, nudgeGate, nudgeSelection };
export type { NudgeGateFlags };
