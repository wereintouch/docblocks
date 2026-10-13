import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type { Block, BlockId, Doc } from "docblocks-core";
import type { InsertBlockPosition } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { focusCaretIn } from "./block-commands";
import { selectionInside } from "./dom-offset";

/**
 * The "/" slash command menu — the block-insertion affordance.
 *
 * Trigger (v1 scope): a "/" typed with a collapsed caret in an empty,
 * root-level block. The menu opens without inserting the "/" into the
 * doc: the following input is captured as a filter query (the doc and the
 * wire see nothing until a command is applied), ArrowUp/ArrowDown move
 * the active item, Enter or a click applies it, Escape cancels, a
 * Backspace with an empty query closes (the phantom "/" is not in the doc
 * to delete), and the menu closes itself as soon as the DOM selection
 * leaves the triggering block or the block gains text.
 *
 * Applying a command converts the empty block: the block is removed and
 * the command's block is inserted in its place (one transaction — one
 * undo step, one wire update), then the caret focuses the new block. A
 * command matching the block's current type and attrs is a no-op close.
 *
 * The command list (v1): the page block types creatable from default
 * attrs — text, headings 1-3, the three list kinds, callout, code (plain
 * and mermaid), latex, and divider. Structurally seeded or externally
 * referenced types (table, database, image, embed, sync-embed, the
 * canvas types) are not offered; they stay command-API inserts.
 */

/** One slash command: the block type and its default attrs. */
type SlashCommand =
  | { label: string; type: "paragraph" }
  | { label: string; type: "heading"; attrs: { level: 1 | 2 | 3 } }
  | { label: string; type: "list-item"; attrs: { list: "bullet" | "number" | "task" } }
  | { label: string; type: "callout" }
  | { label: string; type: "code"; attrs?: { language?: string } }
  | { label: string; type: "latex"; attrs: { display: boolean } }
  | { label: string; type: "divider" };

/** The v1 command list (filterable by the typed query). */
const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Text", type: "paragraph" },
  { label: "Heading 1", type: "heading", attrs: { level: 1 } },
  { label: "Heading 2", type: "heading", attrs: { level: 2 } },
  { label: "Heading 3", type: "heading", attrs: { level: 3 } },
  { label: "Bulleted list", type: "list-item", attrs: { list: "bullet" } },
  { label: "Numbered list", type: "list-item", attrs: { list: "number" } },
  { label: "Task list", type: "list-item", attrs: { list: "task" } },
  { label: "Callout", type: "callout" },
  { label: "Code block", type: "code" },
  { label: "Code block (mermaid)", type: "code", attrs: { language: "mermaid" } },
  { label: "Formula", type: "latex", attrs: { display: false } },
  { label: "Divider", type: "divider" },
];

interface SlashMenuState {
  /** The empty block the menu is attached to (the conversion target). */
  blockId: BlockId;
  parentId: BlockId;
  /** The typed filter query (never inserted into the doc). */
  query: string;
  /** The keyboard-active item index. */
  active: number;
}

/** The editor-level slash menu api, consumed by the block input guards. */
interface SlashMenuApi {
  /** Handle a key while the menu is open on `blockId`; true = consumed. */
  onKeyDown: (event: KeyboardEvent, blockId: BlockId) => boolean;
  /**
   * The "/" trigger check + open. `isEmpty` / `isRootParent` are the
   * caller's block-context facts (the menu only opens for empty,
   * root-level blocks); true = consumed.
   */
  onSlashKey: (
    event: KeyboardEvent,
    blockId: BlockId,
    parentId: BlockId,
    isEmpty: boolean,
    isRootParent: boolean
  ) => boolean;
}

const SlashMenuContext = createContext<SlashMenuApi | null>(null);

/** The slash menu api for the nearest editor root (null = slash disabled). */
function useSlashMenuApi(): SlashMenuApi | null {
  return useContext(SlashMenuContext);
}

/** The command list filtered by the query (empty query = the full list). */
function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (q === "") return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.label.toLowerCase().includes(q));
}

/** Insert the command's block with its default attrs (type-safe per type). */
function insertCommand(doc: Doc, command: SlashCommand, at?: InsertBlockPosition): BlockId {
  switch (command.type) {
    case "paragraph":
      return doc.insertBlock("paragraph", undefined, at);
    case "heading":
      return doc.insertBlock("heading", { level: command.attrs.level }, at);
    case "list-item":
      return doc.insertBlock("list-item", { list: command.attrs.list }, at);
    case "callout":
      return doc.insertBlock("callout", undefined, at);
    case "code":
      return doc.insertBlock(
        "code",
        command.attrs?.language === undefined ? undefined : { language: command.attrs.language },
        at
      );
    case "latex":
      return doc.insertBlock("latex", { display: command.attrs.display }, at);
    case "divider":
      return doc.insertBlock("divider", undefined, at);
    default:
      throw new Error(`Unknown slash command type "${(command as { type: string }).type}".`);
  }
}

/** The command's attrs equal the block's current attrs (the no-op close)? */
function sameAttrs(block: Block, command: SlashCommand): boolean {
  if (command.type !== block.type) return false;
  const current = "attrs" in block ? block.attrs : undefined;
  const next = "attrs" in command ? command.attrs : undefined;
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}

/**
 * Apply the command to the (empty) target block: a no-op close when the
 * block already is the command's type with the same attrs, otherwise a
 * remove + insert in place inside one transaction (the undo step), with
 * the caret moved to the new block.
 */
function applyCommand(doc: Doc, command: SlashCommand, blockId: BlockId, parentId: BlockId, scope: ParentNode): void {
  const current = doc.getBlock(blockId);
  // The triggering block vanished (a concurrent remote removal or an undo
  // with the menu open): nothing to convert.
  if (current === null) return;
  if (sameAttrs(current, command)) return;
  doc.transact(() => {
    const siblings = doc.getChildren(parentId);
    const index = siblings.indexOf(blockId);
    const after = index > 0 ? siblings[index - 1] : undefined;
    doc.removeBlock(blockId);
    const newId = insertCommand(doc, command, after === undefined ? undefined : { parent: parentId, after });
    focusCaretIn(newId, 0, scope);
  });
}

/**
 * The editor-level slash menu state and UI. The root owns the state and
 * renders the floating menu; the blocks get the stable api (the key
 * handling reads the state through a ref, so query changes do not
 * re-render the block tree).
 */
function useSlashMenu(rootRef: RefObject<HTMLElement | null>): { api: SlashMenuApi; menuNode: ReactNode } {
  const { doc, store } = useEditorContext();
  const [state, setState] = useState<SlashMenuState | null>(null);
  const stateRef = useRef<SlashMenuState | null>(null);
  stateRef.current = state;

  const open = useCallback(
    (blockId: BlockId, parentId: BlockId) => setState({ blockId, parentId, query: "", active: 0 }),
    []
  );

  const typeChar = useCallback((ch: string) => {
    setState((s) => (s === null ? s : { ...s, query: s.query + ch.toLowerCase(), active: 0 }));
  }, []);

  const backspaceQuery = useCallback(() => {
    setState((s) => {
      if (s === null) return s;
      if (s.query === "") return null;
      return { ...s, query: s.query.slice(0, -1), active: 0 };
    });
  }, []);

  const move = useCallback((delta: 1 | -1) => {
    setState((s) => {
      if (s === null) return s;
      const items = filterCommands(s.query);
      if (items.length === 0) return s;
      const next = (s.active + delta + items.length) % items.length;
      return { ...s, active: next };
    });
  }, []);

  const hover = useCallback((index: number) => {
    setState((s) => (s === null ? s : { ...s, active: index }));
  }, []);

  const pick = useCallback(
    (index: number) => {
      const s = stateRef.current;
      if (s === null) return;
      const items = filterCommands(s.query);
      const command = items[index] ?? items[0];
      setState(null);
      if (command === undefined) return;
      applyCommand(doc, command, s.blockId, s.parentId, rootRef.current ?? document);
    },
    [doc, rootRef]
  );

  /** The open-menu key handling (consumes the event; false otherwise). */
  const onKeyDown = useCallback(
    (event: KeyboardEvent, blockId: BlockId): boolean => {
      const s = stateRef.current;
      if (s === null || s.blockId !== blockId) return false;
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          setState(null);
          return true;
        case "ArrowDown":
          event.preventDefault();
          move(1);
          return true;
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          return true;
        case "Enter":
          if (!event.nativeEvent.isComposing) {
            event.preventDefault();
            pick(s.active);
            return true;
          }
          return false;
        case "Backspace":
          if (!event.nativeEvent.isComposing) {
            event.preventDefault();
            backspaceQuery();
            return true;
          }
          return false;
        default:
          if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
          if (event.key.length === 1) {
            event.preventDefault();
            typeChar(event.key);
            return true;
          }
          return false;
      }
    },
    [backspaceQuery, move, pick, typeChar]
  );

  /** The "/" trigger: a plain "/" keystroke in an eligible block. */
  const onSlashKey = useCallback(
    (event: KeyboardEvent, blockId: BlockId, parentId: BlockId, isEmpty: boolean, isRootParent: boolean): boolean => {
      if (event.key !== "/" || event.nativeEvent.isComposing) return false;
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (!isEmpty || !isRootParent) return false;
      event.preventDefault();
      open(blockId, parentId);
      return true;
    },
    [open]
  );

  // Auto-close: the selection left the triggering block, or the block
  // gained text (an IME commit while the menu captured the query).
  const openFlag = state !== null;
  useEffect(() => {
    if (!openFlag) return;
    const onSelectionChange = () => {
      const s = stateRef.current;
      if (s === null) return;
      const el =
        rootRef.current?.querySelector<HTMLElement>(
          `[data-block-id="${s.blockId}"] [data-slot="docblocks/block-content"]`
        ) ?? null;
      if (el !== null && selectionInside(el)) {
        const block = store.getState().blocks[s.blockId];
        if (block !== undefined && "content" in block) {
          const text = (block.content ?? []).reduce((t, run) => t + run.text, "");
          if (text !== "") {
            setState(null);
            return;
          }
        }
        return;
      }
      setState(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [openFlag, rootRef, store]);

  const api = useMemo(() => ({ onKeyDown, onSlashKey }), [onKeyDown, onSlashKey]);
  const menuNode = state !== null ? <SlashMenu rootRef={rootRef} state={state} onHover={hover} onPick={pick} /> : null;

  return { api, menuNode };
}

interface SlashMenuProps {
  rootRef: RefObject<HTMLElement | null>;
  state: SlashMenuState;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
}

/** The floating command list, anchored at the triggering block. */
function SlashMenu({ rootRef, state, onHover, onPick }: SlashMenuProps) {
  const items = filterCommands(state.query);
  const anchor =
    rootRef.current?.querySelector<HTMLElement>(
      `[data-block-id="${state.blockId}"] [data-slot="docblocks/block-content"]`
    ) ?? null;
  const root = rootRef.current;
  let top = 8;
  let left = 8;
  if (anchor !== null && root !== null) {
    const a = anchor.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    top = a.top - r.top;
    left = a.left - r.left;
  }
  const active = Math.min(state.active, Math.max(items.length - 1, 0));

  return (
    <div data-slot="docblocks/slash-menu" role="listbox" style={{ top, left }}>
      {items.length === 0 ? (
        <div data-slot="docblocks/slash-empty">no commands</div>
      ) : (
        items.map((command, index) => (
          <div
            key={command.label}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
            onMouseEnter={() => onHover(index)}
          >
            {command.label}
          </div>
        ))
      )}
    </div>
  );
}

export { SlashMenuContext, useSlashMenu, useSlashMenuApi };
