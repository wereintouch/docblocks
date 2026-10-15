/**
 * Eager normalization of the legacy nesting form to the flat page model.
 *
 * The legacy form nests page content in the `children` field of the
 * remodeled page types (nested `list-item`; the page-set children of the
 * five text types). This helper converts it to the flat form per page
 * sequence (the root sequence, each cell mini-doc sequence, each frame's
 * nested page): a block's children are inlined into the PARENT sequence in
 * reading order (depth-first, the block before its subtree), and the
 * nesting depth becomes the `indent` attr (a child's indent = the parent's
 * final indent + 1). Indent-jump violations are clamped (a block's indent
 * never exceeds the preceding block's by more than 1 — the lenient-reader
 * posture; the strict validator rejects unclamped input).
 *
 * The writer always emits the flat form: `fromJSON` / `loadDoc` run it, so
 * a live document is always flat and `toJSON` never carries legacy
 * children. Structural containers keep their `children` untouched (the
 * inlining lands in the container's own sequence); a legacy subtree inside
 * a structural context (a surface's z-order) is inlined right after its
 * parent entry there.
 *
 * Pure JSON → JSON (no CRDT): idempotent and byte-stable on flat input
 * (the output of `flattenDoc` on a flat document is JSON-identical to the
 * input). Unchanged leaf entries share their object with the input; the
 * document, the order arrays, and every rewritten entry are new.
 */
import type { Block, BlockType } from "./block-union";
import { BLOCK_REGISTRY } from "./registry";
import type { BlockId, DocJSON } from "./types";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type BlockMap = Record<string, unknown>;

/** The block's stored indent; absent (or a non-integer — the validator reports it) is 0. */
function storedIndent(block: Record<string, unknown>): number {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;
  const indent = attrs?.indent;
  return typeof indent === "number" && Number.isInteger(indent) ? indent : 0;
}

/** The legacy `children` ids; null when the block carries no legacy form. */
function legacyChildrenOf(block: Record<string, unknown>): unknown[] | null {
  if (!Array.isArray(block.children)) return null;
  const type = block.type;
  if (typeof type !== "string" || !(type in BLOCK_REGISTRY)) return null;
  return BLOCK_REGISTRY[type as BlockType].children === false ? (block.children as unknown[]) : null;
}

interface FlattenState {
  /** Final indents that differ from the stored value (written on the output). */
  assigned: Map<BlockId, number>;
  /** The last emitted indent of the in-flight sequence (clamping cursor). */
  prev: number;
}

/**
 * Expand one container's order array: every entry is emitted in place
 * (a top-level entry keeps its stored indent, clamped against the
 * preceding entry), and the legacy `children` of an entry are inlined
 * right after it (their indent derives from the depth).
 */
function expand(
  ids: readonly unknown[],
  blocks: BlockMap,
  state: FlattenState,
  parentFinal: number | null,
  chain: Set<BlockId>
): BlockId[] {
  const out: BlockId[] = [];
  for (const id of ids) {
    if (typeof id !== "string") {
      out.push(String(id)); // a malformed id (the validator reports it)
      continue;
    }
    const block = blocks[id];
    if (!isPlainObject(block)) {
      out.push(id); // a dangling id (the validator reports it)
      continue;
    }
    if (chain.has(id)) {
      out.push(id); // a cycle (only in unvalidated input)
      continue;
    }
    const stored = storedIndent(block);
    // A top-level entry is clamped against the preceding entry (a jump
    // violation — the lenient reader clamps); an inlined legacy child
    // derives its indent from the depth (the parent's final indent + 1).
    const final = parentFinal === null ? Math.min(stored, state.prev + 1) : parentFinal + 1;
    if (final !== stored) state.assigned.set(id, final);
    out.push(id);
    state.prev = final;
    chain.add(id);
    const legacy = legacyChildrenOf(block);
    if (legacy !== null) out.push(...expand(legacy, blocks, state, final, chain));
    chain.delete(id);
  }
  return out;
}

/** The indent patch of one output block (absent when the stored value stands). */
function withIndent(block: Record<string, unknown>, id: BlockId, state: FlattenState): Record<string, unknown> {
  const indent = state.assigned.get(id);
  if (indent === undefined) return block;
  const attrs = isPlainObject(block.attrs) ? block.attrs : {};
  if (attrs.indent === indent) return block;
  return { ...block, attrs: { ...attrs, indent } };
}

/** The output form of one block: the structural order rewritten, the legacy form dropped. */
function projectBlock(block: unknown, id: BlockId, input: BlockMap, state: FlattenState): Block {
  if (!isPlainObject(block)) return block as unknown as Block; // the validator reports it
  const ordered = block.children;
  if (!Array.isArray(ordered)) {
    // No order array on the entry: only the clamped indent can change.
    return withIndent(block, id, state) as unknown as Block;
  }
  const type = block.type;
  const spec = typeof type === "string" && type in BLOCK_REGISTRY ? BLOCK_REGISTRY[type as BlockType] : undefined;
  if (spec === undefined) {
    return withIndent(block, id, state) as unknown as Block; // an unknown type (the validator reports it)
  }
  if (!spec.children) {
    // The legacy form: the children are inlined into the PARENT's sequence
    // (by the parent's expand); the field is dropped from the writer form.
    const withoutChildren = { ...block };
    delete withoutChildren.children;
    return withIndent(withoutChildren, id, state) as unknown as Block;
  }
  // A structural container: its own order array is rewritten, inlining the
  // legacy subtrees of its entries into it.
  const next: FlattenState = { assigned: state.assigned, prev: -1 };
  const result = withIndent({ ...block, children: expand(ordered, input, next, null, new Set()) }, id, state);
  return result as unknown as Block;
}

/**
 * The legacy shape as the flat shape: a new document with the legacy
 * `children` inlined into the page sequences and the depth converted to
 * `indent`. The input is not mutated.
 */
function flattenDoc(json: DocJSON): DocJSON {
  const input = json.blocks as BlockMap;
  const state: FlattenState = { assigned: new Map(), prev: -1 };
  const blocks: Record<string, Block> = {};
  for (const [id, block] of Object.entries(input)) {
    blocks[id] = projectBlock(block, id, input, state);
  }
  return { ...json, blocks };
}

export { flattenDoc };
