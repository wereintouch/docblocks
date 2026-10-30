/** The editor store's projection utils: the known-type blocks filter
 * (the store's projection holds only known-type blocks — an unknown-type
 * (opaque) block is preserved in the document and the export (the
 * cross-minor stand), but the UI renders no renderer for it, so the
 * projection filters it out — the row stands absent, not corrupt), the
 * structural equality over plain snapshot values (blocks and meta — the
 * seed and the diff share one reader (`toDocJSON` / `getBlock` both build
 * blocks via `readBlock`), so comparing those snapshots is meaningful). */
import { BLOCK_REGISTRY } from "docblocks-core";
import type { Block, BlockId, OpaqueBlock } from "docblocks-core";

/**
 * The store's projection holds only known-type blocks: an unknown-type
 * (opaque) block is preserved in the document and the export (the
 * cross-minor stand), but the UI renders no renderer for it, so the
 * projection filters it out (the row stands absent, not corrupt).
 */
function knownBlocks(blocks: Record<BlockId, Block | OpaqueBlock>): Record<BlockId, Block> {
  const out: Record<BlockId, Block> = {};
  for (const [id, block] of Object.entries(blocks)) {
    if (block.type in BLOCK_REGISTRY) out[id] = block as Block;
  }
  return out;
}

/**
 * Structural equality over plain snapshot values (blocks and meta). The
 * seed and the diff share one reader (`toDocJSON` / `getBlock` both build
 * blocks via `readBlock`), so comparing those snapshots is meaningful.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;
  return keysA.every((key) => key in objB && deepEqual(objA[key], objB[key]));
}

export { deepEqual, knownBlocks };
