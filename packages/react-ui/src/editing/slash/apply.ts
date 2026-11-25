/**
 * The slash command's application over the doc: the plan's replace / update /
 * convert paths (one transaction each — one undo step, one wire update), the
 * caret's landing (the first table cell for the table, the survivor block's
 * rebase offset otherwise), and the keyboard-scope hold across the rebuild.
 */
import type { BlockId, Doc } from "docblocks-core";
import { BLOCK_REGISTRY, InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { assertNever } from "../../shared/utils";
import { focusCaretIn, focusCellActivation } from "../block-commands";
import { firstCellOf, holdFocus, insertCommand } from "./helpers";
import type { SlashApplyPlan, SlashCommand } from "./models";

/**
 * Execute the apply plan (one transaction for the non-replace kinds —
 * one undo step, one wire update). The validation-first ordering stands:
 * the type change / the attrs patch validate before the text deletion
 * runs, so a rejected plan commits nothing.
 */
function applySlashPlan(
  doc: Doc,
  plan: SlashApplyPlan,
  command: SlashCommand,
  blockId: BlockId,
  parentId: BlockId,
  indent: number,
  scope: ParentNode
): void {
  switch (plan.kind) {
    case "noop":
      return;
    case "replace": {
      let tableId: BlockId | null = null;
      let caretId: BlockId | null = null;
      doc.transact(() => {
        const siblings = doc.getChildren(parentId);
        const index = siblings.indexOf(blockId);
        const after = index > 0 ? siblings[index - 1] : undefined;
        doc.removeBlock(blockId);
        const newId = insertCommand(
          doc,
          command,
          after === undefined ? undefined : { parent: parentId, after },
          indent
        );
        if (command.type === "table") {
          // The table takes the block's slot; the trailing-paragraph
          // guarantee stands the editable block after it and the caret
          // seats in its first cell below.
          tableId = newId;
          return;
        }
        caretId = newId;
        // A non-text landing (a divider) is not editable: when it takes the
        // sequence's end, an empty paragraph stands after it (the caret
        // seats there — without the trailing block there is no way to keep
        // typing, and no caret stands in the non-text block).
        if (!BLOCK_REGISTRY[command.type].content && doc.getChildren(parentId).at(-1) === newId) {
          caretId = doc.insertBlock("paragraph", undefined, { parent: parentId, after: newId });
        }
      });
      // The seed's inner unmounts in the rebuild — hold the keyboard scope
      // on the root until the caret re-seats on the next frame.
      holdFocus(scope);
      if (tableId !== null) {
        const firstCell = firstCellOf(doc, tableId);
        if (firstCell !== undefined) {
          focusCellActivation(firstCell, scope);
          return;
        }
      }
      if (caretId !== null) focusCaretIn(caretId, 0, scope);
      return;
    }
    case "update":
    case "convert": {
      const attrs = "attrs" in command && command.attrs !== undefined ? command.attrs : undefined;
      let tableId: BlockId | null = null;
      try {
        doc.transact(() => {
          if (plan.kind === "convert") {
            switch (command.type) {
              case "paragraph":
                doc.changeBlockType(blockId, "paragraph");
                break;
              case "heading":
                doc.changeBlockType(blockId, "heading", command.attrs);
                break;
              case "list-item":
                doc.changeBlockType(blockId, "list-item", command.attrs);
                break;
              case "quote":
                doc.changeBlockType(blockId, "quote");
                break;
              case "callout":
                doc.changeBlockType(blockId, "callout");
                break;
              case "code":
                doc.changeBlockType(blockId, "code", command.attrs);
                break;
              default:
                break;
            }
          } else if (attrs !== undefined) {
            doc.updateBlock(blockId, attrs);
          }
          doc.deleteText(blockId, plan.deleteFrom, plan.deleteTo);
          // The table and the divider are inserts, not converts: the block
          // lands after the caret block (a 2×2 at the trigger's attach
          // level / a contentless divider); the caret block keeps its text
          // (the trigger phrase stripped).
          if (command.type === "table") {
            tableId = insertCommand(doc, command, { parent: parentId, after: blockId }, indent);
          } else if (command.type === "divider") {
            insertCommand(doc, command, { parent: parentId, after: blockId }, indent);
          }
        });
      } catch (error) {
        if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
        throw error;
      }
      if (tableId !== null) {
        // The first cell stands the activation layer (the empty cell has no
        // paragraph yet): seat the caret there on the next frame, after the
        // rebuild mounts the table's rows.
        const firstCell = firstCellOf(doc, tableId);
        if (firstCell !== undefined) {
          holdFocus(scope);
          focusCellActivation(firstCell, scope);
          return;
        }
      }
      // A type change remounts the row (the wrapper tag swap drops the
      // focus): hold the keyboard scope on the root and re-seat the caret
      // in the survivor at the rebase position (the deletion start — the
      // caret's rebase rule) on the next frame.
      if (plan.kind === "convert") holdFocus(scope);
      focusCaretIn(blockId, plan.deleteFrom, scope);
      return;
    }
    default:
      return assertNever(plan);
  }
}

export { applySlashPlan };
