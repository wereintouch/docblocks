/** The slash menu's pure plan: the command filtering and the query
 *  derivation (the doc text is the source of truth) and the apply plan. The
 *  typed command insertion stands in `./helpers`, the plan's execution in
 *  `./apply`. */
import type { Block } from "docblocks-core";

import { isQueryBoundary } from "../phrase";
import { SLASH_COMMANDS } from "./constants";
import type { SlashApplyPlan, SlashCommand, SlashDerivation } from "./models";

/** The command list filtered by the query (empty query = the full list).
 *  The `database` command stands only while a bridge is available — without
 *  one the external-form blocks render the disconnected placeholder, so the
 *  command (the table's create / pick over the bridge) is hidden. A command
 *  matches on its canonical label or, over the optional `translate`, on the
 *  localized label (the menu's display language) — the en filter is
 *  unchanged (there the translation is the label itself). */
function filterCommands(
  query: string,
  databaseAvailable = true,
  translate: (key: string) => string = (key) => key
): SlashCommand[] {
  const q = query.toLowerCase();
  const commands = SLASH_COMMANDS.filter((command) => databaseAvailable || command.type !== "database");
  if (q === "") return commands;
  return commands.filter(
    (command) => command.label.toLowerCase().includes(q) || translate(command.labelKey).toLowerCase().includes(q)
  );
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
 * divider over a phrase-only block without followers takes the replace
 * path (a contentless insert loses nothing); over any block whose text
 * survives the strip it is an insert after the block instead — the
 * divider cannot take the block's text (the core rejects the type change),
 * nor replace a segment-owning block (the removal cascades).
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
  const stripped = text.slice(0, slashOffset) + text.slice(queryEnd);
  if (command.type === "table") {
    // The table never CONVERTS (a fill-in cell grid cannot take the block's
    // text): an empty phrase-only block gives the table its slot (the
    // replace path, like the other non-text landings), any surviving text
    // keeps the block and takes the table right after it.
    return stripped === "" && !hasFollowers
      ? { kind: "replace" }
      : { kind: "update", deleteFrom: slashOffset, deleteTo: queryEnd };
  }
  if (stripped === "" && !hasFollowers && command.type !== block.type) return { kind: "replace" };
  // The divider over surviving text (or over a block that owns a derived
  // segment) is an insert after the caret block, like the table: the
  // block keeps its text, the phrase strips, the divider lands next.
  if (command.type === "divider") return { kind: "update", deleteFrom: slashOffset, deleteTo: queryEnd };
  if (command.type === block.type) return { kind: "update", deleteFrom: slashOffset, deleteTo: queryEnd };
  return { kind: "convert", deleteFrom: slashOffset, deleteTo: queryEnd };
}
export { deriveSlash, filterCommands, planSlashApply };
