/** The move's drop's stand (the containers' read + the drop indicators'
 * computation): the containers (the groups) of every surface over their
 * live box + members, and the in-flight move's green / red membership
 * indicators (the dragged items' containers — the inside stand the drop,
 * the outside stand the refusal). Pure doc reads — the session's
 * commands (session-shape) run them over the drag's frame. */
import type { Doc } from "docblocks-core";

import { boxContains, effectiveGeometry } from "../geometry";
import type { Box, DropIndicator, MoveSession } from "./models";

/** The containers (the groups) of every surface, with their live box and
 * the stored members (the shared canvas space) — the drop's stand and the
 * release's membership commit share the one read. */
function containersOf(doc: Doc): { id: string; box: Box; members: string[] }[] {
  const containers: { id: string; box: Box; members: string[] }[] = [];
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    for (const childId of doc.getChildren(surfaceId)) {
      const child = doc.getBlock(childId);
      if (child === null || child.type !== "group") continue;
      containers.push({ id: childId, box: effectiveGeometry(child), members: child.attrs.members });
    }
  }
  return containers;
}

/**
 * The move's drop indicator: for each
 * dragged shape OR container, the container it joins (kind "in" — the
 * green icon, the fully-containing box it is not yet a member of) or the
 * container it leaves (kind "out" — the red icon, the member no longer
 * inside its own box). A member dragged into another container stands the
 * green stand of the new home (the release's commit moves it between the
 * two). A dragged container's unit members ride the box (no individual
 * indicator — the relative position is invariant).
 */
function computeDropIndicators(
  types: Record<string, string>,
  snapshot: MoveSession["snapshot"],
  containers: MoveSession["containers"],
  groupMembers: Record<string, string[]>,
  ids: string[],
  dx: number,
  dy: number
): DropIndicator[] {
  if (containers.length === 0) return [];
  // The dragged containers stand their own membership indicator (the box's
  // delta); their unit's members ride the box (no individual indicator).
  const draggedGroups = ids.filter((id) => types[id] === "group");
  const riders = new Set<string>();
  for (const gid of draggedGroups) for (const mid of groupMembers[gid] ?? []) riders.add(mid);
  const indicators: DropIndicator[] = [];
  for (const id of ids) {
    const type = types[id];
    if (type === undefined || type === "connector") continue;
    if (riders.has(id)) continue; // the unit's member stands the box's delta
    // The membership's scope: the shapes, the canvas-text, and the
    // containers (the frame stands no membership).
    if (type !== "shape" && type !== "canvas-text" && type !== "group") continue;
    const base = snapshot[id];
    if (base === undefined) continue;
    const figure = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
    const owner = containers.find((c) => c.members.includes(id));
    // The target excludes the item's own box (a container's box stands
    // inside itself — the self-join is a no-op, never the home).
    const target = containers.find((c) => c.id !== id && boxContains(figure, c.box));
    if (target !== undefined && target.id !== owner?.id) {
      indicators.push({ id, containerId: target.id, kind: "in" });
    } else if (owner !== undefined && !boxContains(figure, owner.box)) {
      indicators.push({ id, containerId: owner.id, kind: "out" });
    }
  }
  return indicators;
}

export { computeDropIndicators, containersOf };
