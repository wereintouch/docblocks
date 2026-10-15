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
import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId, Doc, ListItemAttrs } from "docblocks-core";

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
 * The sequence container of a provider's entry root, from a plain blocks
 * map (the store's projection — no doc snapshot): the entry root's own id
 * when it is a page-sequence container (the document root, a table cell,
 * a frame — its children are the entry sequence), otherwise the id of the
 * page-sequence container whose children hold the entry root. A page
 * block's nesting is the sequence's `indent` attr — the block is
 * structurally childless, so a command's `parent` must be the sequence's
 * container, not the block. A dangling entry root, or one under a
 * structural container (a table row, a surface — where the indent is not
 * the nesting), stands alone.
 */
function sequenceContainerOf(blocks: Record<BlockId, Block>, entryRootId: BlockId): BlockId {
  const entry = blocks[entryRootId];
  if (entry !== undefined && BLOCK_REGISTRY[entry.type]?.sequence) return entryRootId;
  for (const [parentId, candidate] of Object.entries(blocks)) {
    const children = "children" in candidate ? candidate.children : undefined;
    if (children !== undefined && children.includes(entryRootId)) {
      const spec = BLOCK_REGISTRY[candidate.type];
      return spec !== undefined && spec.sequence ? parentId : entryRootId;
    }
  }
  return entryRootId;
}

/**
 * The command parent of a provider's entry root (the entry list's gesture
 * context): the entry root's sequence container (the document scan — the
 * entry root resolves once per provider render and the drag commit;
 * v1 documents are small).
 */
function entrySequenceParent(doc: Doc, entryRootId: BlockId): BlockId {
  if (entryRootId === doc.meta.id) return entryRootId;
  return sequenceContainerOf(doc.toJSON().blocks, entryRootId);
}

/**
 * The derived subtree (entry list) of a subtree entry's root, from a plain
 * blocks map (no doc snapshot): the contiguous stretch of the entry root's
 * page sequence (the container's children) from the block to the first
 * following block with `indent` <= its own (the block inclusive). A
 * container entry root (or a standalone one — a structural parent, a
 * dangling root) stands alone.
 */
function subtreeSegmentOf(blocks: Record<BlockId, Block>, containerId: BlockId, entryRootId: BlockId): BlockId[] {
  if (containerId === entryRootId) return [entryRootId];
  const container = blocks[containerId];
  const sequence = container !== undefined && "children" in container ? container.children : undefined;
  if (sequence === undefined) return [entryRootId];
  const index = sequence.indexOf(entryRootId);
  if (index === -1) return [entryRootId];
  const own = indentOf(blocks[entryRootId]);
  const out: BlockId[] = [entryRootId];
  for (let i = index + 1; i < sequence.length; i += 1) {
    const other = sequence[i];
    if (other === undefined) break;
    if (indentOf(blocks[other]) <= own) break;
    out.push(other);
  }
  return out;
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
 * The marker's cycle index (1|2|3) from the indent: the nesting depth is
 * unbounded and CSS cannot modulo it, so the renderer cycles it. The
 * marker style per cycle: disc / circle / square (bullet), decimal /
 * lower-alpha / lower-roman (number); the task list has no marker (the
 * checkbox stands in for it).
 */
function markerCycle(indent: number): number {
  return (indent % 3) + 1;
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

/** The displayed label of a `number` item's marker (the motion view renders it as text; the base view numbers the `ol` natively). */
function numberMarkerLabel(number: number, cycle: number): string {
  if (cycle === 2) return `${String.fromCharCode(96 + number)}.`; // lower-alpha
  if (cycle === 3) return `${toRoman(number)}.`; // lower-roman
  return `${number}.`; // decimal
}

/** 1 -> i, 2 -> ii, … (the lower-roman label). */
function toRoman(n: number): string {
  const TABLE: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let rest = n;
  let out = "";
  for (const [value, glyph] of TABLE) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

export {
  deriveFlat,
  entrySequenceParent,
  indentOf,
  markerCycle,
  numberMarkerLabel,
  sequenceContainerOf,
  subtreeSegmentOf,
  visibleRows,
};
export type { FlatDerivation, FlatNode, ListKind };
