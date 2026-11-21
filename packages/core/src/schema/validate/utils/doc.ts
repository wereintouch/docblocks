/**
 * The document-level validation's entry: the whole-doc pass (validateDoc)
 * and the per-block / per-mark entry points (validateBlockAttrs /
 * validateMarkSet) over the registry specs. The meta pass stands in
 * doc-meta; the structural passes (the z-order, the sequences, the frame's
 * context, the reachability, the opaque structure) stand in doc-structure;
 * the table's invariants stand in doc-table.
 */
import type { BlockType } from "../../block-union";
import { isReservedId } from "../../id-safety";
import { BLOCK_REGISTRY } from "../../registry";
import type { ValidationError } from "../models";
import { checkDatabaseFilter, validateCanvasBlock, validateDatabaseBlock, validateGeometry } from "./blocks";
import { isPlainObject, isSafeEmbedSrc, show } from "./common";
import { validateAttrs, validateContent, validateMarks } from "./content";
import { validateMeta } from "./doc-meta";
import {
  validateFrameContext,
  validateOpaqueStructure,
  validateReachability,
  validateSequences,
  validateSurfaceZOrder,
} from "./doc-structure";
import { validateTableInvariants } from "./doc-table";

/**
 * Validates a plain JSON document against schema v1.
 *
 * Strict posture (the default): unknown block types, marks, attributes, and
 * fields are rejected — the validator protects data written by this engine.
 * Lenient posture (`lenient: true`, the cross-minor load): a reader of
 * major 1 opening a newer minor's v1 data tolerates the additive unknowns —
 * an unknown block type stands as opaque data (the structural invariants
 * only), an unknown attribute and an unknown mark are preserved as-is (the
 * known attrs/marks keep their value checks). The lenient fallback rendering
 * (the placeholder for the unknown type, the text without the unknown mark)
 * is a reader/renderer concern.
 *
 * Collects all violations (does not stop at the first) and reports them in
 * document order. An empty result means the document is valid.
 */
function validateDoc(json: unknown, lenient = false): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isPlainObject(json)) {
    return [{ path: "", message: `The document must be a plain object (got ${show(json)}).` }];
  }

  validateMeta(json, lenient, errors);
  if (!isPlainObject(json.blocks)) {
    if ("blocks" in json)
      errors.push({ path: "blocks", message: `blocks must be a plain object (got ${show(json.blocks)}).` });
    return errors;
  }
  const blocks = json.blocks;

  let rootId: string | undefined;
  const firstParent = new Map<string, { parentId: string; path: string }>();
  const referenceCount = new Map<string, number>();

  for (const [id, block] of Object.entries(blocks)) {
    // A reserved id (an Object.prototype key) cannot be a key of the plain
    // blocks map (it would be lost on the JSON round trip): reject it.
    if (isReservedId(id)) {
      errors.push({
        path: `blocks.${id}`,
        message: `The block id "${id}" is reserved (it collides with Object.prototype) and cannot be used.`,
      });
      continue;
    }
    if (!isPlainObject(block)) {
      errors.push({ path: `blocks.${id}`, message: `A block must be a plain object (got ${show(block)}).` });
      continue;
    }

    const type = block.type;
    if (typeof type !== "string" || !Object.hasOwn(BLOCK_REGISTRY, type)) {
      if (!lenient) {
        errors.push({ path: `blocks.${id}`, message: `Unknown block type ${show(type)}.` });
        continue;
      }
      // Lenient (cross-minor load): the unknown type stands as opaque data —
      // the structural invariants only (the children id array, the
      // geometry); the per-type rules are skipped (the engine does not know
      // the type's contract).
      validateOpaqueStructure(id, block, blocks, firstParent, referenceCount, errors);
      continue;
    }
    const blockType = type as BlockType;
    const spec = BLOCK_REGISTRY[blockType];

    if (blockType === "root") {
      // An invalid or missing id is reported on the meta field already.
      if (typeof json.id === "string" && id !== json.id) {
        errors.push({
          path: `blocks.${id}`,
          message: `The root block must be keyed by the document id "${json.id}" (got "${id}").`,
        });
      }
      if (rootId !== undefined) {
        errors.push({
          path: `blocks.${id}`,
          message: `The document must contain exactly one root block (first is "${rootId}").`,
        });
      } else {
        rootId = id;
      }
      if (!Array.isArray(block.children)) {
        errors.push({ path: `blocks.${id}.children`, message: "The root block must have a children array." });
      }
    }

    if (!spec.content && "content" in block) {
      errors.push({ path: `blocks.${id}.content`, message: `Block type "${blockType}" has no content.` });
    } else if ("content" in block && spec.content) {
      validateContent(blockType, block.content, `blocks.${id}.content`, errors, lenient);
    }

    // Writer contract vs legacy form: structural containers keep `children`
    // (their order); the remodeled page types carry it only in the legacy
    // nesting form (still valid v1, the same child-type rules apply). Both
    // shapes are accepted; the strictness is about the rules, not the shape.
    const allowedChildTypes = spec.childrenTypes ?? spec.legacyChildrenTypes;
    if ("children" in block && allowedChildTypes === undefined) {
      // The legacy frame stand (pre-rework: the frame carried a nested page
      // in `children`). The strict posture rejects the field (the frame is
      // a viewport window — it carries no children); the lenient load
      // tolerates the field and checks only the array shape: flattenDoc
      // drops the link on load, the child blocks keep standing in the raw
      // layer (the same posture as the dangling order ids).
      const legacyFrame = blockType === "frame" && lenient;
      if (!legacyFrame) {
        errors.push({ path: `blocks.${id}.children`, message: `Block type "${blockType}" has no children.` });
      } else if (!Array.isArray(block.children)) {
        errors.push({
          path: `blocks.${id}.children`,
          message: `children must be an array of block ids (got ${show(block.children)}).`,
        });
      }
    } else if ("children" in block && allowedChildTypes !== undefined) {
      if (!Array.isArray(block.children)) {
        errors.push({
          path: `blocks.${id}.children`,
          message: `children must be an array of block ids (got ${show(block.children)}).`,
        });
      } else {
        block.children.forEach((childId, index) => {
          const childPath = `blocks.${id}.children[${index}]`;
          if (typeof childId !== "string") {
            errors.push({ path: childPath, message: `A child id must be a string (got ${show(childId)}).` });
            return;
          }
          if (childId === id) {
            errors.push({ path: childPath, message: `Block "${id}" cannot be its own child.` });
          }
          if (!(childId in blocks)) {
            errors.push({ path: childPath, message: `Dangling child id "${childId}" (no such block).` });
            return;
          }
          const first = firstParent.get(childId);
          referenceCount.set(childId, (referenceCount.get(childId) ?? 0) + 1);
          if (first) {
            errors.push({
              path: childPath,
              message: `Block "${childId}" is referenced more than once (already a child of "${first.parentId}" at ${first.path}).`,
            });
          } else {
            firstParent.set(childId, { parentId: id, path: childPath });
          }
          const childBlock = blocks[childId];
          if (
            isPlainObject(childBlock) &&
            typeof childBlock.type === "string" &&
            Object.hasOwn(BLOCK_REGISTRY, childBlock.type)
          ) {
            if (!allowedChildTypes.includes(childBlock.type as BlockType)) {
              errors.push({
                path: childPath,
                message: `Block type "${childBlock.type}" is not allowed as a child of "${blockType}".`,
              });
            }
          }
        });
      }
    }

    if (!spec.rows && "rows" in block) {
      errors.push({ path: `blocks.${id}.rows`, message: `Block type "${blockType}" has no rows.` });
    }
    if (!spec.rows && "rowOrder" in block) {
      errors.push({ path: `blocks.${id}.rowOrder`, message: `Block type "${blockType}" has no rowOrder.` });
    }
    if (spec.rows) validateDatabaseBlock(block, `blocks.${id}`, errors, lenient);

    if ("geometry" in block) validateGeometry(block.geometry, `blocks.${id}.geometry`, errors, lenient);
    if (blockType === "shape" || blockType === "connector" || blockType === "group") {
      validateCanvasBlock(blockType, block, `blocks.${id}`, errors);
    }
    if (blockType === "embed") {
      // The kind x src cross-field rule (the registry's attrs spec is
      // per-attr). The strict posture rejects the unsafe scheme (the
      // `javascript:` / the foreign `data:` — the XSS over the consumer's
      // sandbox grant, the phishing surface); the lenient load keeps the
      // value as data (the renderer gates it).
      if (!lenient) {
        const attrs = block.attrs as Record<string, unknown> | undefined;
        const src = attrs?.src;
        const kind = attrs?.kind;
        if (typeof src === "string" && src.length > 0 && !isSafeEmbedSrc(kind, src)) {
          errors.push({
            path: `blocks.${id}.attrs.src`,
            message: `The embed's src is not a safe URL for kind "${kind}": absolute http/https only (the html kind stands the data:text/html snippet additionally).`,
          });
        }
      }
    }

    validateAttrs(blockType, spec, block.attrs, `blocks.${id}.attrs`, errors, lenient);
  }

  if (rootId === undefined) {
    errors.push({ path: "blocks", message: "The document must contain a root block." });
    return errors;
  }

  // The root's reachability (the orphan report stands the strict posture only).
  validateReachability(blocks, rootId, lenient, errors);

  // The flat page sequences: the indent-jump rule per sequence container.
  validateSequences(blocks, errors);

  // The frame's context rules (the root context: frameId required, title
  // forbidden; the surface context: frameId forbidden, title allowed).
  validateFrameContext(blocks, firstParent, errors);

  // The surface's explicit z-order (the canvas elements' dense zIndex).
  validateSurfaceZOrder(blocks, errors);

  // The table's invariants (the columnOrder's set + width mirror, the
  // table-row's cell binding over the column position).
  validateTableInvariants(blocks, firstParent, referenceCount, errors);

  return errors;
}

/**
 * Validates block attrs against the registry rules of the type: unknown
 * keys, missing required attrs, and value rules. `undefined` is valid only
 * for types without attrs. An empty result means the attrs are valid.
 * `lenient` (the cross-minor load posture): unknown keys and a new enum
 * value on a known key stand preserved (not rejected); the known keys' full
 * rules stand either way. `strictKeys` (the writer's hybrid stand): the keys
 * the caller's patch touches stand the strict posture even
 * under `lenient` (the caller owns the patch — its unknown key or invalid
 * value is a rejection); the untouched keys stand the lenient posture (the
 * live document's data, which may carry a future minor's additive values).
 */
function validateBlockAttrs(
  type: BlockType,
  attrs: unknown,
  lenient = false,
  strictKeys?: ReadonlySet<string>
): ValidationError[] {
  const errors: ValidationError[] = [];
  validateAttrs(type, BLOCK_REGISTRY[type], attrs, "attrs", errors, lenient, strictKeys);
  // The database's recursive filter payload is not expressible in the flat
  // AttrSpec (the registry keeps `filter` a plain `object`): the command
  // paths (insertBlock / updateBlock) reject an invalid payload here, like
  // the doc-level validator does.
  if (type === "database" && isPlainObject(attrs) && attrs.filter !== undefined) {
    checkDatabaseFilter(attrs.filter, "attrs.filter", errors);
  }
  return errors;
}

/**
 * Validates a mark set for a run of the given block type: known marks with
 * well-formed values, no marks in a code block, no coexistence with an
 * exclusive mark. An empty result means the marks are valid.
 */
function validateMarkSet(blockType: BlockType, marks: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  validateMarks(blockType, marks, "marks", errors);
  return errors;
}

export { validateBlockAttrs, validateDoc, validateMarkSet };
