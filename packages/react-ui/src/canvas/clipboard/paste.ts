/** The canvas clipboard's paste: the copy lands at the pointer (the mouse's
 * world position) over the target surface, the ids remap (the container's
 * membership and the connector's endpoints — the internal refs stand the
 * copy's ids, the external ones stand the free points at the offset position
 * with the frozen side), and the commit is ONE transact (one undo step, one
 * wire update): the auto-membership and the inserts stand or fall together.
 */
import type { Block, BlockId, CanvasRef, ConnectorAttrs, Doc } from "docblocks-core";

import { CanvasPasteError } from "../../shared/errors";
import { endpointBoxOf, endpointPointOf, portOfNormal } from "../geometry";
import { findParentSurface } from "../insert";
import { autoMembership } from "../membership";
import type { CanvasPoint } from "../viewport";
import { DEFAULT_ITEM } from "./constants";
import type { CanvasClipboard, ClipboardItem } from "./models";

/**
 * The paste: the copy's items land into the target surface (the append
 * order — the new blocks stand the surface's z-order tail, on top of the
 * existing) with the union-center delta (the copy's union box's center
 * seats at the pointer). The ids remap: the container's membership and
 * the connector's endpoints internal to the copy stand the copy's ids
 * (the port / the position stand), the external refs stand the free
 * points at the offset position (the frozen side stands the resolution's
 * normal — the direction's contract); the unresolvable ref stands as-is
 * (the broken line stays broken). One transact for the whole paste.
 *
 * Returns the new TOP-LEVEL ids (the paste's selection) or `null` (no
 * item landed — the doc refused the insert).
 */
function pasteCanvasItems(
  doc: Doc,
  clipboard: CanvasClipboard,
  targetSurface: BlockId,
  center: CanvasPoint
): BlockId[] | null {
  // The copy's union box (the snapshot geometries — the copy-time stand)
  // and its center → the delta to the pointer. The connectors stand no
  // box (the line's own stand — the figures' / the containers' center is
  // the copy's center); over no box (the connector-only copy) the delta
  // stands zero — the copy stands its original position.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let dx = 0;
  let dy = 0;
  for (const entry of clipboard.entries) {
    if (entry.item.type === "connector") continue;
    const box = entry.item.geometry ?? DEFAULT_ITEM;
    minX = Math.min(minX, box.x - box.w / 2);
    minY = Math.min(minY, box.y - box.h / 2);
    maxX = Math.max(maxX, box.x + box.w / 2);
    maxY = Math.max(maxY, box.y + box.h / 2);
  }
  if (Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY)) {
    dx = center.x - (minX + maxX) / 2;
    dy = center.y - (minY + maxY) / 2;
  }

  // The items' topological order (the original id with the item): a
  // container after its members (the membership remap stands the members'
  // new ids).
  const byId = new Map<BlockId, ClipboardItem>();
  for (const entry of clipboard.entries) byId.set(entry.id, entry.item);
  const order: { id: BlockId; item: ClipboardItem }[] = [];
  const done = new Set<BlockId>();
  const visit = (id: BlockId): void => {
    if (done.has(id)) return;
    const item = byId.get(id);
    if (item === undefined) return;
    done.add(id);
    if (item.type === "group") {
      for (const memberId of item.attrs.members) visit(memberId);
    }
    order.push({ id, item });
  };
  for (const id of clipboard.ids) visit(id);

  const idMap = new Map<BlockId, BlockId>();
  const copySet = new Set(clipboard.entries.map((entry) => entry.id));
  const topSet = new Set(clipboard.ids);
  const newTopIds: BlockId[] = [];
  try {
    doc.transact(() => {
      // The items land in two phases: the non-connectors first (the
      // container's membership remap stands the members' new ids — the
      // connectors are never members), the connectors after (the
      // endpoints' remap stands the COMPLETE idMap — the internal refs
      // stand the copy's ids). The geometry shifts with the same delta
      // (the setGeometry over the insert — the geometry is a block field,
      // not an attr).
      for (const { id: originalId, item } of order) {
        if (item.type === "connector") continue;
        const id = insertNonConnector(doc, item, targetSurface, idMap);
        if (item.type === "canvas-text" && item.content !== undefined) {
          // The runs land through the text command (one run per insert,
          // the marks stand — the insertBlock's fresh content is empty).
          let pos = 0;
          for (const run of item.content) {
            if (run.text === "") continue;
            doc.insertText(id, pos, run.text, run.marks);
            pos += run.text.length;
          }
        }
        if (item.geometry !== undefined) {
          doc.setGeometry(id, {
            x: item.geometry.x + dx,
            y: item.geometry.y + dy,
            w: item.geometry.w,
            h: item.geometry.h,
          });
        }
        idMap.set(originalId, id);
        if (topSet.has(originalId)) newTopIds.push(id);
      }
      for (const { id: originalId, item } of order) {
        if (item.type !== "connector") continue;
        const id = doc.insertBlock("connector", remapEndpoints(doc, item.attrs, originalId, copySet, idMap, dx, dy), {
          parent: targetSurface,
        });
        if (item.geometry !== undefined) {
          doc.setGeometry(id, {
            x: item.geometry.x + dx,
            y: item.geometry.y + dy,
            w: item.geometry.w,
            h: item.geometry.h,
          });
        }
        idMap.set(originalId, id);
        if (topSet.has(originalId)) newTopIds.push(id);
      }
      // The auto-membership's candidates: the pasted shapes / texts that
      // stand outside the pasted groups (the fragment's own containers are
      // never the external homes — their membership stands as pasted).
      const pastedGroups = new Set<BlockId>();
      const nested = new Set<BlockId>();
      for (const { id: originalId, item } of order) {
        if (item.type !== "group") continue;
        const newId = idMap.get(originalId);
        if (newId !== undefined) pastedGroups.add(newId);
        for (const memberId of item.attrs.members) {
          const mapped = idMap.get(memberId);
          if (mapped !== undefined) nested.add(mapped);
        }
      }
      for (const [originalId, newId] of idMap) {
        const item = byId.get(originalId);
        if (item === undefined) continue;
        if (item.type !== "shape" && item.type !== "canvas-text") continue;
        if (nested.has(newId)) continue;
        autoMembership(doc, newId, pastedGroups);
      }
    });
  } catch {
    // The doc refused an insert (the target surface gone) — the transact
    // rolled back; the paste stands no partial copy.
    return null;
  }
  return newTopIds.length > 0 ? newTopIds : null;
}

/**
 * The one non-connector item's insert into the target surface (the attrs
 * stand the copy; the container's membership remaps onto the copy's ids
 * — a dangling member stands the original id, the lenient read skips it).
 * Returns the new block id.
 */
function insertNonConnector(
  doc: Doc,
  item: ClipboardItem,
  targetSurface: BlockId,
  idMap: Map<BlockId, BlockId>
): BlockId {
  const at = { parent: targetSurface };
  if (item.type === "group") {
    // The membership remaps onto the copy's ids; a member that stands no
    // copy entry (the frame member — the frame stands the copy out) is
    // dropped — the copy is autonomous (no ref to the original's frame).
    const attrs = {
      ...item.attrs,
      members: item.attrs.members.filter((memberId) => idMap.has(memberId)).map((memberId) => idMap.get(memberId)!),
    };
    return doc.insertBlock("group", attrs, at);
  }
  if (item.type === "canvas-text") {
    return doc.insertBlock("canvas-text", item.attrs, at);
  }
  // The shape (the connector stands the paste's follow-up pass — never here).
  if (item.type !== "shape") throw new CanvasPasteError("the connector stands the paste's follow-up pass");
  return doc.insertBlock("shape", item.attrs, at);
}

/**
 * The endpoint remap pair (the two-pass toward — the render's parity: the
 * endpoint's legacy anchor stands toward the OTHER endpoint's stand (the
 * box's center, the free point, the origin over neither)).
 */
function remapEndpoints(
  doc: Doc,
  attrs: ConnectorAttrs,
  originalId: BlockId,
  copySet: Set<BlockId>,
  idMap: Map<BlockId, BlockId>,
  dx: number,
  dy: number
): ConnectorAttrs {
  // The endpoint resolution's context: the connector's own surface's
  // children (the refs resolve against the original's siblings — read
  // live: a concurrent removal dangles the ref and stands the lenient
  // skip) and the blocks map (the endpoint's box / the toward stand).
  const sourceSurface = findParentSurface(doc, originalId);
  const sourceChildren = sourceSurface !== null ? doc.getChildren(sourceSurface) : [];
  const blocks: Record<BlockId, Block> = {};
  for (const childId of sourceChildren) {
    const child = doc.getBlock(childId);
    if (child !== null) blocks[childId] = child;
  }
  const startRef = attrs.start;
  const endRef = attrs.end;
  const startBox = endpointBoxOf(startRef, sourceChildren, blocks);
  const endBox = endpointBoxOf(endRef, sourceChildren, blocks);
  const startFree = startRef.x !== undefined && startRef.y !== undefined ? { x: startRef.x, y: startRef.y } : null;
  const endFree = endRef.x !== undefined && endRef.y !== undefined ? { x: endRef.x, y: endRef.y } : null;
  const startToward = endBox !== null ? { x: endBox.x, y: endBox.y } : (endFree ?? { x: 0, y: 0 });
  const endToward = startBox !== null ? { x: startBox.x, y: startBox.y } : (startFree ?? { x: 0, y: 0 });
  const resolve = (ref: CanvasRef, toward: CanvasPoint) => endpointPointOf(ref, sourceChildren, blocks, toward);
  return {
    ...attrs,
    start: remapEndpoint(startRef, copySet, idMap, dx, dy, startToward, resolve),
    end: remapEndpoint(endRef, copySet, idMap, dx, dy, endToward, resolve),
  };
}

/** The one endpoint's remap: the internal block ref stands the copy's id
 * (the port / the position stand — the ref's details preserve); the
 * external / the cross-doc ref stands the free point at the offset
 * position (the frozen side stands the resolution's normal — the
 * direction's contract; the unresolvable ref stands as-is — the broken
 * line stays broken); the free point shifts (the frozen direction
 * stands).
 */
function remapEndpoint(
  ref: CanvasRef,
  copySet: Set<BlockId>,
  idMap: Map<BlockId, BlockId>,
  dx: number,
  dy: number,
  toward: CanvasPoint,
  resolve: (ref: CanvasRef, toward: CanvasPoint) => { x: number; y: number; nx: number; ny: number } | null
): CanvasRef {
  if (ref.blockId !== undefined && copySet.has(ref.blockId)) {
    const out: CanvasRef = { ...ref };
    out.blockId = idMap.get(ref.blockId) ?? ref.blockId;
    if (out.x !== undefined) out.x += dx;
    if (out.y !== undefined) out.y += dy;
    return out;
  }
  if (ref.docId !== undefined || ref.blockId !== undefined) {
    const point = resolve(ref, toward);
    if (point === null) return { ...ref };
    const port = portOfNormal(point.nx, point.ny) ?? ref.port;
    const out: CanvasRef = { x: point.x + dx, y: point.y + dy };
    if (port !== undefined) out.port = port;
    return out;
  }
  // The free point (x / y stand together per the validator).
  if (ref.x !== undefined && ref.y !== undefined) {
    const out: CanvasRef = { x: ref.x + dx, y: ref.y + dy };
    if (ref.port !== undefined) out.port = ref.port;
    return out;
  }
  // The malformed ref (no ref, no point): the lenient stand as-is.
  return { ...ref };
}

export { pasteCanvasItems };
