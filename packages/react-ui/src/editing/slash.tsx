import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentType, KeyboardEvent, RefObject, SVGProps } from "react";

import type { Block, BlockId, Doc } from "docblocks-core";
import type { InsertBlockPosition } from "docblocks-core";
import { BLOCK_REGISTRY, DEFAULT_TABLE_COLUMN_WIDTH, InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { cn } from "../shared/ui/cn";
import {
  CodeXml,
  Database,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Sigma,
  SquareCheck,
  SquareSplitVertical,
  Table,
  TextQuote,
} from "../shared/ui/icons";
import { focusCaretIn, focusCellActivation, segmentRange } from "./block-commands";
import { caretOffsetIn, locatePosition, selectionInside } from "./dom-offset";
import { DatabaseSlashPicker } from "./slash-database-picker";

/**
 * The empty-block hint text: shown while the caret sits in a text block
 * with no content, pointing at the "/" command palette (the
 * `commandPalettePlaceholder` provider prop overrides it).
 */
const COMMAND_PALETTE_PLACEHOLDER = "Type '/' for commands";

/**
 * The "/" slash command menu — the block-conversion affordance.
 *
 * The doc is the query's source of truth: the "/" is regular doc text — the
 * keypress commits it through the command API (the browser's insertion
 * stands suppressed), and Backspace deletes it like any other character;
 * the characters typed after it are plain text too. The menu tracks the
 * triggering "/" by its text offset: the filter query is the block text
 * between that "/" and the first whitespace (or the block end), re-derived
 * on every change. Deleting the "/" (or moving the caret out of the query
 * window) closes the menu; a "/" already in the text never re-triggers —
 * only a "/" keypress does.
 *
 * The derivation reads the caret live from the DOM selection (the browser
 * settles the DOM before the store commit that re-renders the menu, so the
 * read stands at the current text): a stale caret reading would stand past
 * the shrunken query's end after a Backspace and close the menu wrongly.
 *
 * Trigger: a "/" keypress with a collapsed caret in a page text block
 * (paragraph, heading, list-item, callout — code and latex are excluded:
 * a "/" there is plain text) at any position and any indent of the root
 * page sequence (or the provider's entry root itself).
 *
 * The menu stands a plain absolutely-positioned div inside the editor root
 * (no focus machinery): it never takes the focus — the caret stays in the
 * block while it is open — and anchors at the left edge of the "/"
 * character: below the line, or above it when the below placement would
 * overrun the viewport bottom (the list is bounded and scrolls, so the
 * flip stays close to the caret). Zero filter matches hide the list
 * (the
 * state stays open, so deleting the query back to a match brings it
 * back); the keys are Escape (close), ArrowUp/ArrowDown (move the active
 * item while a list stands), and Enter (apply). Printable keys, Backspace,
 * and space flow to the doc's normal input path — they grow, shrink, or
 * end the query.
 *
 * Applying a command converts the triggering block: the trigger phrase
 * ("/" + the query) is stripped from its text, and the rest survives the
 * type change (a same-type command is an attrs update; a different type
 * is changeBlockType — one transaction: one undo step, one wire update).
 * A block that holds only the trigger phrase converts by the replace path
 * (remove + insert, the caret seated in the new block) unless it owns a
 * derived segment (deeper followers) — a removal would cascade them, so
 * such a block converts in place. A no-op close (the command equals the
 * block's current shape, or a contentless target like the divider over
 * surviving text) issues no command.
 *
 * The command list (v1): the page block types creatable from default
 * attrs — text, headings 1-3, the three list kinds, callout, code (plain
 * and mermaid), latex, divider, and table. The table is the only insert
 * command: it lands after the caret block (2×2, the default widths), the
 * caret block stands, and the caret seats in the table's first cell (the
 * empty-cell activation). The image is an upload insert (the blob bridge,
 * decision 2026-10-19): the caret block stands (the trigger phrase
 * stripped), the file picker opens over the open menu, and the image
 * lands after the caret block in one transact once the upload resolved —
 * the doc holds only the committed key; a refused or cancelled pick
 * commits nothing. The database is a picker insert (the bridge, decision
 * 2026-10-19): the caret block stands (the trigger phrase stripped), the
 * table picker stands over the open menu (the existing tables + the
 * create-new form), and the block lands after the caret block in one
 * transact once a table is picked — the doc holds only the `tableId`
 * reference; a cancelled pick commits nothing. Externally referenced types
 * (embed, sync-embed, the canvas types) are not offered; they stay
 * command-API inserts.
 */

/** A 24px-stroke icon component (the package icon set). */
type SlashIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** One slash command: the block type, its default attrs, and the menu glyph. */
type SlashCommand =
  | { label: string; icon: SlashIcon; type: "paragraph" }
  | { label: string; icon: SlashIcon; type: "heading"; attrs: { level: 1 | 2 | 3 } }
  | { label: string; icon: SlashIcon; type: "list-item"; attrs: { list: "bullet" | "number" | "task" } }
  | { label: string; icon: SlashIcon; type: "quote" }
  | { label: string; icon: SlashIcon; type: "callout" }
  | { label: string; icon: SlashIcon; type: "code"; attrs?: { language?: string } }
  | { label: string; icon: SlashIcon; type: "latex"; attrs: { display: boolean } }
  | { label: string; icon: SlashIcon; type: "divider" }
  | { label: string; icon: SlashIcon; type: "image" }
  | { label: string; icon: SlashIcon; type: "database" }
  | { label: string; icon: SlashIcon; type: "table" };

/** The v1 command list (filterable by the typed query). */
const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Text", icon: Pilcrow, type: "paragraph" },
  { label: "Heading 1", icon: Heading1, type: "heading", attrs: { level: 1 } },
  { label: "Heading 2", icon: Heading2, type: "heading", attrs: { level: 2 } },
  { label: "Heading 3", icon: Heading3, type: "heading", attrs: { level: 3 } },
  { label: "Bulleted list", icon: List, type: "list-item", attrs: { list: "bullet" } },
  { label: "Numbered list", icon: ListOrdered, type: "list-item", attrs: { list: "number" } },
  { label: "Task list", icon: SquareCheck, type: "list-item", attrs: { list: "task" } },
  { label: "Quote", icon: Quote, type: "quote" },
  { label: "Callout", icon: TextQuote, type: "callout" },
  { label: "Code block", icon: CodeXml, type: "code" },
  { label: "Code block (mermaid)", icon: CodeXml, type: "code", attrs: { language: "mermaid" } },
  { label: "Formula", icon: Sigma, type: "latex", attrs: { display: false } },
  { label: "Divider", icon: SquareSplitVertical, type: "divider" },
  { label: "Image", icon: ImageIcon, type: "image" },
  { label: "Database", icon: Database, type: "database" },
  { label: "Table", icon: Table, type: "table" },
];

/** The command list filtered by the query (empty query = the full list). */
function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (q === "") return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.label.toLowerCase().includes(q));
}

/** One query boundary: the whitespace characters that end the query. */
function isQueryBoundary(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n";
}

/** The live derivation of the menu state from the block text (the doc is the source of truth). */
interface SlashDerivation {
  /** The anchor is gone (the "/" deleted or edited away) or the caret left the query window. */
  closed: boolean;
  /** The filter query: the block text between the "/" and its query boundary. */
  query: string;
  /** The end of the query (the boundary index, or the text length). */
  queryEnd: number;
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

/** The apply decision (pure): what a picked command does to the trigger block. */
type SlashApplyPlan =
  | { kind: "noop" }
  | { kind: "replace" }
  | { kind: "update"; deleteFrom: number; deleteTo: number }
  | { kind: "convert"; deleteFrom: number; deleteTo: number };

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

/** The block's text (a content block's runs joined; absent content is empty). */
function blockTextOf(block: Block | null | undefined): string {
  if (block === null || block === undefined || !("content" in block)) return "";
  return (block.content ?? []).reduce((t, run) => t + run.text, "");
}

/** The trigger block's inner editable (null when the block vanished). */
function slashInnerOf(rootRef: RefObject<HTMLElement | null>, blockId: BlockId): HTMLElement | null {
  return (
    rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${blockId}"] [data-slot="docblocks/block-content"]`) ??
    null
  );
}

/**
 * The caret offset inside the trigger block, live from the DOM selection.
 * The browser settles the DOM before the store commit that re-renders the
 * menu, so the read stands at the current text (a stale caret state would
 * stand past the shrunken query's end after a Backspace and close the menu
 * wrongly). The declared open seat (the caret right after the "/") stands
 * when the selection does not sit in the block.
 */
function liveCaretOf(rootRef: RefObject<HTMLElement | null>, blockId: BlockId, fallback: number): number {
  const el = slashInnerOf(rootRef, blockId);
  const selection = window.getSelection();
  if (
    el !== null &&
    selection !== null &&
    selection.rangeCount > 0 &&
    selection.isCollapsed &&
    selection.anchorNode !== null &&
    el.contains(selection.anchorNode)
  ) {
    return caretOffsetIn(el, selection.anchorNode, selection.anchorOffset);
  }
  return fallback;
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
    case "latex":
      return doc.insertBlock("latex", { display: command.attrs.display, ...ind }, at);
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
              case "latex":
                doc.changeBlockType(blockId, "latex", command.attrs);
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

interface SlashMenuState {
  /** The block the menu is attached to (the conversion target). */
  blockId: BlockId;
  parentId: BlockId;
  /** The text offset of the triggering "/" (the anchor; the query is derived after it). */
  slashOffset: number;
  /** The keyboard-active item index. */
  active: number;
}

/** The editor-level slash menu api, consumed by the block input guards. */
interface SlashMenuApi {
  /** Handle a key while the menu is open on `blockId`; true = consumed. */
  onKeyDown: (event: KeyboardEvent, blockId: BlockId) => boolean;
  /**
   * The "/" trigger open. `caretOffset` is the caret's text offset before
   * the "/" lands (the anchor); the default is prevented here (the browser
   * insertion stands suppressed — the caller commits the character
   * through the command API). true = opened.
   */
  onSlashKey: (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number) => boolean;
}

const SlashMenuContext = createContext<SlashMenuApi | null>(null);

/** The slash menu api for the nearest editor root (null = slash disabled). */
function useSlashMenuApi(): SlashMenuApi | null {
  return useContext(SlashMenuContext);
}

/** The key facts the open-menu key handling reads (react and native alike). */
interface OpenMenuKey {
  key: string;
  isComposing: boolean;
}

/**
 * The editor-level slash menu state and UI. The root owns the state and
 * renders the menu; the blocks get the stable api (the key handling reads
 * the state through a ref, so query changes do not re-render the block
 * tree).
 */
function useSlashMenu(rootRef: RefObject<HTMLElement | null>): { api: SlashMenuApi; menuNode: ReactNode } {
  const { doc, store, blobStore } = useEditorContext();
  const [state, setState] = useState<SlashMenuState | null>(null);
  const stateRef = useRef<SlashMenuState | null>(null);
  stateRef.current = state;
  // The slash Image upload: the picker's open ref (registered by the
  // menu's hidden file input) + the pending pick context (the caret block
  // and the slash anchor), committed on the file pick.
  const imageClickRef = useRef<{ open: () => void } | null>(null);
  const pendingImageRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);
  // The slash Database picker: the open flag (the menu panel stands the
  // picker over the phrase) + the pending pick context, committed on the
  // table pick.
  const [databasePick, setDatabasePick] = useState(false);
  const databasePickRef = useRef(false);
  databasePickRef.current = databasePick;
  const pendingDatabaseRef = useRef<{ blockId: BlockId; parentId: BlockId; slashOffset: number } | null>(null);

  const open = useCallback((blockId: BlockId, parentId: BlockId, slashOffset: number) => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
    setState({ blockId, parentId, slashOffset, active: 0 });
  }, []);

  const close = useCallback(() => {
    setDatabasePick(false);
    pendingDatabaseRef.current = null;
    setState(null);
  }, []);

  /** The open-menu derivation (the live doc text + the live caret). */
  const openDerivation = useCallback(
    (blockId: BlockId, slashOffset: number): SlashDerivation => {
      const block = store.getState().blocks[blockId];
      return deriveSlash(blockTextOf(block), slashOffset, liveCaretOf(rootRef, blockId, slashOffset + 1));
    },
    [rootRef, store]
  );

  const move = useCallback(
    (delta: 1 | -1) => {
      setState((s) => {
        if (s === null) return s;
        const items = filterCommands(openDerivation(s.blockId, s.slashOffset).query);
        if (items.length === 0) return s;
        const next = (s.active + delta + items.length) % items.length;
        return { ...s, active: next };
      });
    },
    [openDerivation]
  );

  const hover = useCallback((index: number) => {
    setState((s) => (s === null ? s : { ...s, active: index }));
  }, []);

  /**
   * Apply the item: the plan is re-derived from the live doc (the doc is
   * the source of truth — a change since the open can stale the state);
   * a stale anchor, a vanished block, or a zero-list pick is a no-op close.
   */
  const pick = useCallback(
    (index: number) => {
      const s = stateRef.current;
      if (s === null) return;
      const block = doc.getBlock(s.blockId);
      if (block === null) {
        close();
        return;
      }
      const text = blockTextOf(block);
      const derivation = openDerivation(s.blockId, s.slashOffset);
      if (derivation.closed) {
        close();
        return;
      }
      const items = filterCommands(derivation.query);
      // The clamped highlight index (the menu renders the clamped value):
      // a filtered-down list keeps the last item active.
      const command = items.length === 0 ? undefined : items[Math.min(index, items.length - 1)];
      if (command === undefined) return;
      // The image is an upload insert: the menu stays open (the phrase is
      // intact, the derivation stays live) while the picker stands; the
      // commit (phrase strip + the insert) lands on the file pick.
      if (command.type === "image") {
        pendingImageRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        imageClickRef.current?.open();
        return;
      }
      // The database is a picker insert: the menu stands open (the phrase
      // stays intact, the derivation stays live) while the picker stands;
      // the commit (phrase strip + the insert) lands on the table pick.
      if (command.type === "database") {
        pendingDatabaseRef.current = { blockId: s.blockId, parentId: s.parentId, slashOffset: s.slashOffset };
        setDatabasePick(true);
        return;
      }
      setState(null);
      const segment = segmentRange(doc, s.parentId, s.blockId);
      const hasFollowers = segment !== null && segment.end > segment.start + 1;
      const plan = planSlashApply(command, block, text, s.slashOffset, hasFollowers);
      applySlashPlan(doc, plan, command, s.blockId, s.parentId, indentOf(block), rootRef.current ?? document);
    },
    [close, doc, openDerivation, rootRef]
  );

  /**
   * The open-menu key handling, on the key facts; true = the key is the
   * menu's (the caller preventDefaults). Everything else is the doc's:
   * printable keys, Backspace, and space flow through the normal input
   * path (they grow, shrink, or end the query).
   */
  /**
   * The file pick of the slash Image command: the upload runs first (the
   * doc holds only a committed key), then one transact — the trigger
   * phrase strip (when it still stands at its anchor) + the image insert
   * after the caret block, a trailing empty paragraph when the image
   * takes the sequence's end (the caret seats there), and the caret
   * re-seat. A refused or cancelled pick commits nothing (the menu stays
   * open on the phrase).
   */
  const handleImageFile = useCallback(
    (file: File | null) => {
      const pending = pendingImageRef.current;
      pendingImageRef.current = null;
      if (pending === null || file === null) return;
      const { blockId, parentId, slashOffset } = pending;
      if (doc.getBlock(blockId) === null) return;
      blobStore
        .upload(file, { name: file.name })
        .then((key) => {
          const scope = rootRef.current ?? document;
          try {
            doc.transact(() => {
              const current = doc.getBlock(blockId);
              if (current === null) return;
              const indent = indentOf(current);
              const ind = indent !== 0 ? { indent } : {};
              const text = blockTextOf(current);
              if (text.charAt(slashOffset) === "/") {
                let queryEnd = slashOffset + 1;
                while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
                doc.deleteText(blockId, slashOffset, queryEnd);
              }
              const imageId = doc.insertBlock("image", { src: key, ...ind }, { parent: parentId, after: blockId });
              const sequence = doc.getChildren(parentId);
              if (sequence[sequence.length - 1] === imageId) {
                const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: imageId });
                focusCaretIn(trailingId, 0, scope);
              } else {
                focusCaretIn(blockId, slashOffset, scope);
              }
            });
          } catch (error) {
            if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
            throw error;
          }
          close();
        })
        .catch(() => {
          // The upload was refused (or the legacy resolver holds no upload
          // path): nothing commits; the menu stands open on the phrase.
        });
    },
    [blobStore, close, doc, rootRef]
  );

  /**
   * The table pick of the slash Database command: one transact — the
   * trigger phrase strip (when it still stands at its anchor) + the
   * database insert (the `tableId` reference) after the caret block, a
   * trailing empty paragraph when the block takes the sequence's end (the
   * caret seats there), and the caret re-seat. A cancelled pick commits
   * nothing (the menu stands open on the phrase).
   */
  const commitDatabase = useCallback(
    (tableId: string) => {
      const pending = pendingDatabaseRef.current;
      pendingDatabaseRef.current = null;
      setDatabasePick(false);
      if (pending === null) return;
      const { blockId, parentId, slashOffset } = pending;
      if (doc.getBlock(blockId) === null) return;
      const scope = rootRef.current ?? document;
      try {
        doc.transact(() => {
          const current = doc.getBlock(blockId);
          if (current === null) return;
          const indent = indentOf(current);
          const ind = indent !== 0 ? { indent } : {};
          const text = blockTextOf(current);
          if (text.charAt(slashOffset) === "/") {
            let queryEnd = slashOffset + 1;
            while (queryEnd < text.length && !isQueryBoundary(text.charAt(queryEnd))) queryEnd += 1;
            doc.deleteText(blockId, slashOffset, queryEnd);
          }
          const databaseId = doc.insertBlock("database", { tableId, ...ind }, { parent: parentId, after: blockId });
          const sequence = doc.getChildren(parentId);
          if (sequence[sequence.length - 1] === databaseId) {
            const trailingId = doc.insertBlock("paragraph", ind, { parent: parentId, after: databaseId });
            focusCaretIn(trailingId, 0, scope);
          } else {
            focusCaretIn(blockId, slashOffset, scope);
          }
        });
      } catch (error) {
        if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
        throw error;
      }
      close();
    },
    [close, doc, rootRef]
  );

  const handleOpenMenuKey = useCallback(
    (key: OpenMenuKey, blockId: BlockId): boolean => {
      const s = stateRef.current;
      if (s === null || s.blockId !== blockId) return false;
      const derivation = openDerivation(blockId, s.slashOffset);
      if (derivation.closed) {
        close();
        return false;
      }
      const items = filterCommands(derivation.query);
      // The picker state: the Escape cancels the picker (the menu stands
      // open on the phrase); the picker's input stops its own keys' propagation.
      if (databasePickRef.current) {
        if (key.key === "Escape") {
          setDatabasePick(false);
          pendingDatabaseRef.current = null;
          return true;
        }
        return false;
      }
      switch (key.key) {
        case "Escape":
          close();
          return true;
        case "ArrowDown":
          if (items.length > 0) {
            move(1);
            return true;
          }
          return false;
        case "ArrowUp":
          if (items.length > 0) {
            move(-1);
            return true;
          }
          return false;
        case "Enter":
          if (!key.isComposing && items.length > 0) {
            pick(s.active);
            return true;
          }
          return false;
        default:
          return false;
      }
    },
    [close, move, openDerivation, pick]
  );

  /** The open-menu key handling on the block's react event (consumes it). */
  const onKeyDown = useCallback(
    (event: KeyboardEvent, blockId: BlockId): boolean => {
      const consumed = handleOpenMenuKey(
        {
          key: event.key,
          isComposing: event.nativeEvent.isComposing,
        },
        blockId
      );
      if (consumed) event.preventDefault();
      return consumed;
    },
    [handleOpenMenuKey]
  );

  // The "/" trigger: a plain "/" keystroke with a collapsed caret. The
  // default is prevented — the browser's insertion stands suppressed; the
  // caller commits the character through the command API (one undo step)
  // and the menu tracks it by offset (the doc is the source of truth).
  const onSlashKey = useCallback(
    (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, caretOffset: number): boolean => {
      if (event.key !== "/" || event.nativeEvent.isComposing) return false;
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      event.preventDefault();
      open(blockId, parentId, caretOffset);
      return true;
    },
    [open]
  );

  // Auto-close: the selection left the triggering block, became a range,
  // or the block vanished (the caret window itself is checked on the
  // derivation — live, at render and key time). A caret move inside the
  // block re-renders the menu (a fresh state object) so the derivation
  // re-runs.
  const openFlag = state !== null;
  useEffect(() => {
    if (!openFlag) return;
    const onSelectionChange = () => {
      const s = stateRef.current;
      if (s === null) return;
      const el = slashInnerOf(rootRef, s.blockId);
      if (el === null) {
        setState(null);
        return;
      }
      const selection = window.getSelection();
      if (!selectionInside(el) || selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
        setState(null);
        return;
      }
      // A caret move inside the block: re-derive (the live read stands).
      setState((cur) => (cur === null ? cur : { ...cur }));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [openFlag, rootRef]);

  const api = useMemo(() => ({ onKeyDown, onSlashKey }), [onKeyDown, onSlashKey]);
  const menuNode =
    state !== null ? (
      <SlashMenu
        rootRef={rootRef}
        state={state}
        onHover={hover}
        onPick={pick}
        onClose={close}
        onImageFile={handleImageFile}
        imageClickRef={imageClickRef}
        databasePick={databasePick}
        onDatabasePickCancel={() => {
          setDatabasePick(false);
          pendingDatabaseRef.current = null;
        }}
        onDatabaseCommit={commitDatabase}
      />
    ) : null;

  return { api, menuNode };
}

interface SlashMenuProps {
  rootRef: RefObject<HTMLElement | null>;
  state: SlashMenuState;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  onClose: () => void;
  onImageFile: (file: File | null) => void;
  imageClickRef: RefObject<{ open: () => void } | null>;
  databasePick: boolean;
  onDatabasePickCancel: () => void;
  onDatabaseCommit: (tableId: string) => void;
}

/**
 * The floating command list: a plain absolutely-positioned div inside the
 * editor root (the root is the positioning context). It renders no DOM
 * while the filter stands at zero (the state stays open — deleting the
 * query back to a match brings the list back). The mousedown suppression
 * keeps the block's selection (and focus) alive across an item click.
 */
function SlashMenu({
  rootRef,
  state,
  onHover,
  onPick,
  onClose,
  onImageFile,
  imageClickRef,
  databasePick,
  onDatabasePickCancel,
  onDatabaseCommit,
}: SlashMenuProps) {
  const block = useBlock(state.blockId);
  const text = blockTextOf(block);

  // The hidden file input of the Image command: a programmatic click
  // opens the picker (no pointer events reach the menu), and it stands
  // while the menu is open — the phrase stays intact during the pick, so
  // the derivation (and the menu) stays live until the file lands.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    imageClickRef.current = { open: () => fileInputRef.current?.click() };
    return () => {
      imageClickRef.current = null;
    };
  }, [imageClickRef]);

  // The derivation, live (the block text from the store + the caret from
  // the DOM selection — the browser settles the DOM before the store
  // commit that re-renders this component, so both stand together). A
  // closed derivation is a no-op close (the "/" deleted, or the caret out
  // of the query window).
  const [derived, setDerived] = useState<SlashDerivation | null>(null);
  useLayoutEffect(() => {
    const caret = liveCaretOf(rootRef, state.blockId, state.slashOffset + 1);
    const derivation = deriveSlash(text, state.slashOffset, caret);
    setDerived(derivation);
    if (derivation.closed) onClose();
  }, [text, state, rootRef, onClose]);

  const items = derived === null ? [] : filterCommands(derived.query);
  const visible = items.length > 0 || databasePick;
  const active = Math.min(state.active, Math.max(items.length - 1, 0));

  // Anchor at the "/" character: below the line, or above it when the
  // below placement overruns the viewport bottom (the bounded list keeps
  // the flip close to the caret). Measured in a layout effect (the first
  // frame stands hidden until the rects stand); environments without
  // layout (jsdom — no range rects) leave the menu unpositioned.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return;
    }
    const root = rootRef.current;
    const inner = slashInnerOf(rootRef, state.blockId);
    if (root === null || inner === null) return;
    const start = locatePosition(inner, state.slashOffset);
    const end = locatePosition(inner, state.slashOffset + 1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (typeof range.getBoundingClientRect !== "function") return;
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const left = rect.left - rootRect.left;
    const height = menuRef.current?.offsetHeight ?? 0;
    if (rect.bottom + height + 8 > window.innerHeight) {
      // `bottom` is measured from the root's BOTTOM edge (the css absolute
      // posture): the menu's bottom edge stands at the caret's top.
      setPosition({ left, bottom: rootRect.bottom - rect.top });
    } else {
      setPosition({ left, top: rect.bottom - rootRect.top });
    }
  }, [visible, state.blockId, state.slashOffset, text, rootRef]);

  // The keyboard-navigated active item stands visible inside the bounded
  // list (the minimal scroll of the menu's own overflow; jsdom has no
  // scrollIntoView — the guard stands). Skipped while the menu is
  // unpositioned: the first frame stands at the document's end, and a
  // scrollIntoView there would scroll the page (the menu takes its
  // position on the next commit).
  useLayoutEffect(() => {
    if (!visible || position === null) return;
    const activeEl = menuRef.current?.querySelector<HTMLElement>("[data-slot='docblocks/slash-item'][data-active]");
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }, [active, visible, position]);

  if (!visible) return null;
  return (
    <ScrollArea
      ref={menuRef}
      role="menu"
      data-slot="docblocks/slash-menu"
      className={cn(
        "absolute z-modal max-h-80 min-w-32 overflow-x-hidden rounded-md border border-border bg-popover p-1",
        "text-popover-foreground shadow-md",
        position === null && "opacity-0"
      )}
      style={
        position === null
          ? undefined
          : {
              left: position.left,
              ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
            }
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        data-slot="docblocks/slash-file-input"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(event) => {
          const files = event.target.files;
          const file = files !== null && files.length > 0 ? (files[0] ?? null) : null;
          event.target.value = "";
          onImageFile(file);
        }}
      />
      {databasePick ? (
        <DatabaseSlashPicker onCommit={onDatabaseCommit} onCancel={onDatabasePickCancel} />
      ) : (
        <>
          {items.map((command, index) => (
            <div
              key={command.label}
              role="menuitem"
              data-slot="docblocks/slash-item"
              data-active={index === active || undefined}
              className={cn(
                "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none",
                "[&_svg]:pointer-events-none [&_svg]:shrink-0",
                index === active && "bg-accent text-accent-foreground"
              )}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(index)}
            >
              <command.icon className="size-4" />
              {command.label}
            </div>
          ))}
        </>
      )}
    </ScrollArea>
  );
}

export {
  COMMAND_PALETTE_PLACEHOLDER,
  SLASH_COMMANDS,
  SlashMenuContext,
  deriveSlash,
  filterCommands,
  planSlashApply,
  useSlashMenu,
  useSlashMenuApi,
};
