/**
 * The flat page model, derived at render time.
 *
 * A page sequence (the root's children, a table cell's mini-doc, a frame's
 * nested page) is one flat block list; a block's nesting is its `indent`
 * attr (default 0) relative to the PRECEDING block of the same sequence:
 * a block with `indent = k` attaches to the last preceding block with
 * `indent = k - 1`. The block's "children" are a derived notion, not a data
 * field — the renderer computes them per render (the store stays a flat
 * map projection, the doc is the source of truth).
 *
 * Runs and numbering: a run is the maximal contiguous stretch of
 * `list-item`s of one kind and one `indent` — deeper blocks inside do not
 * break the run (they are the sublists). A `number` item's displayed
 * number is its position within the run, continuing across sublists
 * (markdown semantics: `1. [sub] 2.`). Markers cycle by `indent % 3`
 * (disc / circle / square; decimal / lower-alpha / lower-roman). A block's
 * subtree is the contiguous segment from the block to the first block
 * with `indent` <= its own (the block inclusive).
 *
 * The derivation is pure (ids + the store's block map) and cheap per
 * render; the doc-level gesture logic (Tab/Shift+Tab, merge, subtree
 * moves) reads the live sequence instead — see editing/block-commands.
 *
 * Node interning: a node object is REUSED across derivations while its
 * indent, run position, kind, and children are unchanged (compared against
 * the previous derivation's byId, passed as `prev`). The render memo (the
 * block view) is keyed on the node's identity, so an interned node means
 * the block (and its nested content) re-renders only through its own store
 * subscription — a change to a sibling's text never re-renders it.
 */
import type { Block, BlockId, ListItemAttrs, OpaqueBlock } from "docblocks-core";

type ListKind = ListItemAttrs["list"];

/** One derived node: a block's flat-sequence facts (the block snapshot itself is read from the store). */
interface FlatNode {
  id: BlockId;
  /** The block's indent (absent is 0). */
  indent: number;
  /** The `list` kind (list items only). */
  kind?: ListKind;
  /** The run position of a `number` item (1-based); absent for every other block. */
  number?: number;
  /** The direct derived children (the blocks attached to this block), in sequence order. */
  children: FlatNode[];
}

/** One sequence's derivation: the top-level nodes and every node by id. */
interface FlatDerivation {
  /** The nodes without an attach parent, in sequence order. */
  nodes: FlatNode[];
  /** Every sequence node by id (the interning cache for the next derivation). */
  byId: Map<BlockId, FlatNode>;
}

/** The intermediate per-block facts (the interned node is built from them). */
interface FreshNode {
  id: BlockId;
  indent: number;
  kind: ListKind | undefined;
  number: number | undefined;
  /** The fresh child nodes (re-linked to their finals after interning). */
  childNodes: FreshNode[];
  /** Set when the node attaches to another (absent = top-level). */
  parentId?: BlockId;
}

/**
 * The block's indent: a non-negative integer attr; absent (or malformed —
 * the strict validator reports it) is 0.
 */
function indentOf(block: Block | undefined): number {
  if (block === undefined || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * Derive one page sequence: the attach parents (the last preceding block
 * with `indent - 1`), the direct derived children, and the run numbering.
 *
 * The attach scan breaks on a shallower block (a lenient-reader safety
 * guard: a clamped sequence never reaches it). A dangling id (absent from
 * the map) derives as a non-list block at indent 0 (the renderer renders
 * nothing for it).
 */
/**
 * The flat sequence's structure digest: a primitive key over the ids —
 * the indents + the list kinds (the derivation's only inputs). The
 * sequence's view subscribes to the key, not the whole blocks map: a
 * text-only change (a keystroke in a block) stands no re-derivation,
 * and an indent / a list-kind change stands the derivation's own
 * re-render only.
 */
function flatStructureKey(ids: BlockId[], blocks: Record<BlockId, Block | OpaqueBlock>): string {
  let key = "";
  for (const id of ids) {
    const block = blocks[id];
    if (block === undefined) {
      key += "-;";
      continue;
    }
    const kind = block.type === "list-item" ? (block.attrs?.list ?? "") : "";
    key += `${indentOf(block as Block)}:${kind};`;
  }
  return key;
}

function deriveFlat(ids: BlockId[], blocks: Record<BlockId, Block>, prev?: Map<BlockId, FlatNode>): FlatDerivation {
  /** The fresh nodes in sequence order (interning runs backwards over them). */
  const fresh: FreshNode[] = [];
  /** The run state per indent level: the live kind (null = broken by a non-list block) and the item counter. */
  const runs = new Map<number, { kind: ListKind | null; counter: number }>();

  for (const id of ids) {
    const block = blocks[id];
    const indent = indentOf(block);
    const kind = block !== undefined && block.type === "list-item" ? block.attrs.list : undefined;

    // A shallower block closes every deeper run (a deeper item after it
    // starts a fresh run).
    for (const level of runs.keys()) if (level > indent) runs.delete(level);
    let number: number | undefined;
    if (kind !== undefined) {
      const run = runs.get(indent);
      if (run !== undefined && run.kind === kind) {
        runs.set(indent, { kind, counter: run.counter + 1 });
        number = run.counter + 1;
      } else {
        runs.set(indent, { kind, counter: 1 });
        number = 1;
      }
      if (kind !== "number") number = undefined;
    } else {
      runs.set(indent, { kind: null, counter: 0 });
    }

    // The attach parent: the last preceding block with `indent - 1`.
    let attach: FreshNode | null = null;
    for (let j = fresh.length - 1; j >= 0; j--) {
      const sibling = fresh[j]!;
      if (sibling.indent < indent - 1) break;
      if (sibling.indent === indent - 1) {
        attach = sibling;
        break;
      }
    }

    const node: FreshNode = { id, indent, kind, number, childNodes: [] };
    fresh.push(node);
    if (attach !== null) {
      attach.childNodes.push(node);
      node.parentId = attach.id;
    }
  }

  const indexById = new Map<BlockId, number>();
  fresh.forEach((node, i) => indexById.set(node.id, i));

  // Interning (backwards, children before parents: a child's final is
  // already decided when its parent is processed). A node stands while its
  // data and its children's finals (by identity) are unchanged — then the
  // parent's children compare equal to the previous node's children.
  const finals: (FlatNode | undefined)[] = new Array(fresh.length);
  for (let i = fresh.length - 1; i >= 0; i -= 1) {
    const node = fresh[i]!;
    const prevNode = prev?.get(node.id);
    const childFinals = node.childNodes.map((child) => finals[indexById.get(child.id)!]!);
    const unchanged =
      prevNode !== undefined &&
      prevNode.indent === node.indent &&
      prevNode.kind === node.kind &&
      prevNode.number === node.number &&
      prevNode.children.length === childFinals.length &&
      childFinals.every((child, j) => child === prevNode.children[j]);
    if (prevNode !== undefined && unchanged) {
      finals[i] = prevNode;
    } else {
      const out: FlatNode = { id: node.id, indent: node.indent, children: childFinals };
      if (node.kind !== undefined) out.kind = node.kind;
      if (node.number !== undefined) out.number = node.number;
      finals[i] = out;
    }
  }

  const byId = new Map<BlockId, FlatNode>();
  const top: FlatNode[] = [];
  for (let i = 0; i < fresh.length; i += 1) {
    const node = fresh[i]!;
    const final = finals[i]!;
    byId.set(node.id, final);
    if (node.parentId === undefined) top.push(final);
  }

  return { nodes: top, byId };
}

/**
 * The VISIBLE rows of a sequence: the sequence with every collapsed
 * block's derived segment unmounted (the collapse is a view state — the
 * rows stand in the data; the motion view's row list and its local drag
 * order run over the visible rows only).
 */
function visibleRows(ids: BlockId[], byId: Map<BlockId, FlatNode>, collapsedIds: readonly BlockId[]): BlockId[] {
  const collapsed = new Set(collapsedIds);
  /** The indent of the open collapsed segment (the stack never grows past one). */
  const open: number[] = [];
  const out: BlockId[] = [];
  for (const id of ids) {
    const node = byId.get(id);
    if (node === undefined) continue;
    // The segment ends at the first row with `indent` <= the item's.
    while (open.length > 0 && node.indent <= open[open.length - 1]!) open.pop();
    if (open.length > 0) continue; // hidden inside a collapsed segment
    out.push(id);
    // Any collapsed block with a derived segment hides it (view state).
    if (collapsed.has(id) && node.children.length > 0) open.push(node.indent);
  }
  return out;
}

export { deriveFlat, flatStructureKey, indentOf, visibleRows };
export { collapseEmptyTextChains, isEmptyChainText } from "./flat-empty-chains";
export { entrySequenceParent, sequenceContainerOf, subtreeSegmentOf } from "./flat-segments";
export { markerCycle, numberMarkerLabel } from "./flat-markers";
export type { FlatDerivation, FlatNode, ListKind };
