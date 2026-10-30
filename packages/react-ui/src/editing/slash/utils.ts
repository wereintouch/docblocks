/** The slash menu's pure helpers: the command filtering and the query
 *  derivation (the doc text is the source of truth), the apply plan, the
 *  typed command insertion, and the apply execution (one transaction per
 *  plan). */
import type { Block, BlockId, Doc, InsertBlockPosition } from "docblocks-core";
import { BLOCK_REGISTRY, DEFAULT_TABLE_COLUMN_WIDTH, InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { focusCaretIn, focusCellActivation } from "../block-commands";
import { isQueryBoundary } from "../phrase";
import { SLASH_COMMANDS } from "./constants";
import type { SlashApplyPlan, SlashCommand, SlashDerivation } from "./models";

/** The command list filtered by the query (empty query = the full list). */
function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (q === "") return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.label.toLowerCase().includes(q));
}

/**
 * Derive the menu state for a triggering "/": the anchor must still stand
 * at `slashOffset` in the live text (edits before the "/" shift it — the
 * anchor is offset-anchored and gives up on a miss), and the caret must
 * sit inside the query window — after the "/" and no further than the
 * query's whitespace boundary (a typed space, or a move out, ends the
 * phrase). The query is the text between the two.
 */
function deriveSlash(text: string, slashOffset: number, caret: number): SlashDerivation {
  if (slashOffset < 0 || slashOffset >= text.length || text.charAt(slashOffset) !== "/") {
    return { closed: true, query: "", queryEnd: 0 };
  }
  let queryEnd = slashOffset + 1;
  while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
  const closed = caret <= slashOffset || caret > queryEnd;
  return { closed, query: text.slice(slashOffset + 1, queryEnd), queryEnd };
}

/** The command's attrs equal the block's current attrs (the no-op close)? */
function sameAttrs(block: Block, command: SlashCommand): boolean {
  if (command.type !== block.type) return false;
  const current = "attrs" in block ? block.attrs : undefined;
  const next = "attrs" in command ? command.attrs : undefined;
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}

/**
 * Plan the command's application. The trigger phrase ("/" + the query) is
 * always stripped; the stripped block is empty only when the phrase was
 * its whole text. The replace path needs both an empty result and a type
 * change — and a block that owns a derived segment cannot be removed (the
 * removal cascades its followers), so it converts in place instead. The
 * divider over a phrase-only block is a no-op close when the block owns a
 * derived segment (a removal would cascade its followers) — the replace
 * path stands only for a phrase-only block without followers (a divider
 * insert is contentless, nothing is lost).
 */
function planSlashApply(
  command: SlashCommand,
  block: Block,
  text: string,
  slashOffset: number,
  hasFollowers: boolean
): SlashApplyPlan {
  if (sameAttrs(block, command)) return { kind: "noop" };
  const queryEnd = deriveSlash(text, slashOffset, text.length).queryEnd;
  // The table is an insert, not a convert: the caret block stands (the
  // trigger phrase stripped) and the table lands after it — the replace
  // path is never taken (it would take the caret block's slot).
  if (command.type === "table") return { kind: "update", deleteFrom: slashOffset, deleteTo: queryEnd };
  const stripped = text.slice(0, slashOffset) + text.slice(queryEnd);
  if (stripped === "" && !hasFollowers && command.type !== block.type) return { kind: "replace" };
  // A divider cannot stand the block's text (the core rejects the type
  // change) nor replace a segment-owning block (the removal cascades):
  // the replace check above stands only for the phrase-only case, so any
  // other divider pick is a no-op close.
  if (command.type === "divider") return { kind: "noop" };
  if (command.type === block.type) return { kind: "update", deleteFrom: slashOffset, deleteTo: queryEnd };
  return { kind: "convert", deleteFrom: slashOffset, deleteTo: queryEnd };
}

/** Insert the command's block with its default attrs (type-safe per type), keeping the trigger's attach level (a subtree view's root level may sit deeper than 0 — the same position and indent were valid before, so the sequence's jump rule holds at the landing). */
function insertCommand(doc: Doc, command: SlashCommand, at?: InsertBlockPosition, indent = 0): BlockId {
  const ind: { indent?: number } = indent !== 0 ? { indent } : {};
  switch (command.type) {
    case "paragraph":
      return doc.insertBlock("paragraph", ind.indent === undefined ? undefined : { ...ind }, at);
    case "heading":
      return doc.insertBlock("heading", { level: command.attrs.level, ...ind }, at);
    case "list-item":
      return doc.insertBlock("list-item", { list: command.attrs.list, ...ind }, at);
    case "quote":
      return doc.insertBlock("quote", ind.indent === undefined ? undefined : { ...ind }, at);
    case "callout":
      return doc.insertBlock("callout", ind.indent === undefined ? undefined : { ...ind }, at);
    case "code":
      return doc.insertBlock(
        "code",
        command.attrs?.language === undefined
          ? ind.indent === undefined
            ? undefined
            : { ...ind }
          : { language: command.attrs.language, ...ind },
        at
      );
    case "divider":
      return doc.insertBlock("divider", ind.indent === undefined ? undefined : { ...ind }, at);
    case "table": {
      // A 2×2 table with the default column widths; the cells stand empty
      // (no child paragraph until the first input activates one).
      const tableId = doc.insertBlock(
        "table",
        { cols: 2, columnWidths: [DEFAULT_TABLE_COLUMN_WIDTH, DEFAULT_TABLE_COLUMN_WIDTH], ...ind },
        at
      );
      for (let row = 0; row < 2; row++) {
        const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
        for (let col = 0; col < 2; col++) {
          doc.insertBlock("table-cell", undefined, { parent: rowId });
        }
      }
      return tableId;
    }
    default:
      throw new Error(`Unknown slash command type "${(command as { type: string }).type}".`);
  }
}

/** The block snapshot's indent: a non-negative integer attr; absent is 0. */
function indentOf(block: Block): number {
  if (!("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * Hold the editor root's focus across a structural rebuild: the focused
 * inner editable unmounts during the store-driven re-render, and the
 * browser drops the focus to <body> until the next-frame caret re-seating
 * lands. Focusing the (tabIndex -1) root before the rebuild keeps the
 * focus — and the keyboard scope — inside the editor while the gap lasts
 * (the root's keydown handler still owns the hotkeys).
 */
function holdFocus(scope: ParentNode): void {
  if (scope instanceof HTMLElement && scope.isConnected) scope.focus({ preventScroll: true });
}

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
    case "replace":
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
        // A non-text landing (a divider / a table) is not editable: when it
        // takes the sequence's end, an empty paragraph stands after it (the
        // caret seats there — without the trailing block there is no way
        // to keep typing, and no caret stands in the non-text block).
        let caretId = newId;
        if (!BLOCK_REGISTRY[command.type].content) {
          const sequence = doc.getChildren(parentId);
          if (sequence[sequence.length - 1] === newId) {
            caretId = doc.insertBlock("paragraph", undefined, { parent: parentId, after: newId });
          }
        }
        focusCaretIn(caretId, 0, scope);
      });
      // The seed's inner unmounts in the rebuild — hold the keyboard
      // scope on the root until the caret re-seats on the next frame.
      holdFocus(scope);
      return;
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
          // The table command is an insert, not a convert: the table stands
          // after the caret block (a 2×2 at the trigger's attach level).
          if (command.type === "table") {
            tableId = insertCommand(doc, command, { parent: parentId, after: blockId }, indent);
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
        const rows = doc.getChildren(tableId);
        const firstRow = rows[0];
        const firstCell = firstRow === undefined ? undefined : doc.getChildren(firstRow)[0];
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
  }
}

export { applySlashPlan, deriveSlash, filterCommands, indentOf, planSlashApply };
