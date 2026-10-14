import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent, RefObject, SVGProps } from "react";

import type { Block, BlockId, Doc } from "docblocks-core";
import type { InsertBlockPosition } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../shared/ui/DropdownMenu";
import { cn } from "../shared/ui/cn";
import {
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Pilcrow,
  Sigma,
  SquareCheck,
  SquareSplitVertical,
  TextQuote,
} from "../shared/ui/icons";
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
 * Backspace with an empty query closes (the phantom "/" is not in the
 * doc to delete), and the menu closes itself as soon as the DOM selection
 * leaves the triggering block or the block gains text.
 *
 * The menu is a non-modal radix dropdown portaled to the document body:
 * the trigger is an invisible zero-size anchor at the block, and the
 * keys stay the editor's — the block's keydown while the focus sits in
 * the block, a document-level capture (scoped to this editor's root or
 * the menu) once radix's roving focus has landed on the menu. Hovering
 * and the keyboard both highlight through the active index. The content
 * suppresses the default mousedown (the selection must survive a click)
 * and the outside pointer/focus dismiss (the selection state owns the
 * visibility).
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

/** A 24px-stroke icon component (the package icon set). */
type SlashIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** One slash command: the block type, its default attrs, and the menu glyph. */
type SlashCommand =
  | { label: string; icon: SlashIcon; type: "paragraph" }
  | { label: string; icon: SlashIcon; type: "heading"; attrs: { level: 1 | 2 | 3 } }
  | { label: string; icon: SlashIcon; type: "list-item"; attrs: { list: "bullet" | "number" | "task" } }
  | { label: string; icon: SlashIcon; type: "callout" }
  | { label: string; icon: SlashIcon; type: "code"; attrs?: { language?: string } }
  | { label: string; icon: SlashIcon; type: "latex"; attrs: { display: boolean } }
  | { label: string; icon: SlashIcon; type: "divider" };

/** The v1 command list (filterable by the typed query). */
const SLASH_COMMANDS: SlashCommand[] = [
  { label: "Text", icon: Pilcrow, type: "paragraph" },
  { label: "Heading 1", icon: Heading1, type: "heading", attrs: { level: 1 } },
  { label: "Heading 2", icon: Heading2, type: "heading", attrs: { level: 2 } },
  { label: "Heading 3", icon: Heading3, type: "heading", attrs: { level: 3 } },
  { label: "Bulleted list", icon: List, type: "list-item", attrs: { list: "bullet" } },
  { label: "Numbered list", icon: ListOrdered, type: "list-item", attrs: { list: "number" } },
  { label: "Task list", icon: SquareCheck, type: "list-item", attrs: { list: "task" } },
  { label: "Callout", icon: TextQuote, type: "callout" },
  { label: "Code block", icon: CodeXml, type: "code" },
  { label: "Code block (mermaid)", icon: CodeXml, type: "code", attrs: { language: "mermaid" } },
  { label: "Formula", icon: Sigma, type: "latex", attrs: { display: false } },
  { label: "Divider", icon: SquareSplitVertical, type: "divider" },
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

/** The key facts the open-menu key handling reads (react and native alike). */
interface OpenMenuKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/**
 * The editor-level slash menu state and UI. The root owns the state and
 * renders the menu; the blocks get the stable api (the key handling reads
 * the state through a ref, so query changes do not re-render the block
 * tree).
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

  /**
   * The open-menu key handling, on the key facts (react and native
   * keyboard events alike); true = the key is the menu's (the caller
   * preventDefaults).
   */
  const handleOpenMenuKey = useCallback(
    (key: OpenMenuKey, blockId: BlockId): boolean => {
      const s = stateRef.current;
      if (s === null || s.blockId !== blockId) return false;
      switch (key.key) {
        case "Escape":
          setState(null);
          return true;
        case "ArrowDown":
          move(1);
          return true;
        case "ArrowUp":
          move(-1);
          return true;
        case "Enter":
          if (!key.isComposing) {
            pick(s.active);
            return true;
          }
          return false;
        case "Backspace":
          if (!key.isComposing) {
            backspaceQuery();
            return true;
          }
          return false;
        default:
          if (key.isComposing || key.metaKey || key.ctrlKey || key.altKey) return false;
          if (key.key.length === 1) {
            typeChar(key.key);
            return true;
          }
          return false;
      }
    },
    [backspaceQuery, move, pick, typeChar]
  );

  /** The open-menu key handling on the block's react event (consumes it). */
  const onKeyDown = useCallback(
    (event: KeyboardEvent, blockId: BlockId): boolean => {
      const consumed = handleOpenMenuKey(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          isComposing: event.nativeEvent.isComposing,
        },
        blockId
      );
      if (consumed) event.preventDefault();
      return consumed;
    },
    [handleOpenMenuKey]
  );

  // The focus lands on the portaled menu when it opens (radix's roving
  // focus), and then the block's keydown never fires: while the menu is
  // open, the root also owns the keys at the document level (capture),
  // scoped to this editor's root or the menu itself (a page can render
  // several roots — the other roots' keys must not filter this menu).
  // stopPropagation keeps the menu's own key handling (roving focus,
  // typeahead) out — the state machine above is the single key owner.
  const openFlag = state !== null;
  useEffect(() => {
    if (!openFlag) return;
    const onDocKeyDown = (event: globalThis.KeyboardEvent): void => {
      const s = stateRef.current;
      const root = rootRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (s === null || root === null || target === null) return;
      // Scope: the key must land in this editor's root (a nested editor root
      // inside this one is another editor — its keys stay its own) or in the
      // menu itself (portaled outside every editor root).
      const inOwnEditor = target.closest('[data-slot="docblocks/editor"]') === root;
      if (!inOwnEditor && target.closest('[data-slot="docblocks/slash-menu"]') === null) return;
      const consumed = handleOpenMenuKey(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          isComposing: event.isComposing,
        },
        s.blockId
      );
      if (consumed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onDocKeyDown, true);
    return () => document.removeEventListener("keydown", onDocKeyDown, true);
  }, [openFlag, rootRef, handleOpenMenuKey]);

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

/**
 * The floating command list: a non-modal radix dropdown anchored at the
 * triggering block through an invisible zero-size trigger (the content is
 * portaled to the document body and styles itself; the bar-level mousedown
 * guard and the outside dismiss suppression stand here as well — the
 * editor owns the selection and the selection state owns the visibility).
 */
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
    <DropdownMenu modal={false} open>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" style={{ position: "absolute", top, left, width: 0, height: 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        data-slot="docblocks/slash-menu"
        className="data-[state=open]:animate-none data-[state=closed]:animate-none"
        onMouseDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        {items.length === 0 ? (
          <div data-slot="docblocks/slash-empty" className="px-2 py-1.5 text-sm text-muted-foreground">
            no commands
          </div>
        ) : (
          items.map((command, index) => (
            <DropdownMenuItem
              key={command.label}
              onSelect={() => onPick(index)}
              onMouseEnter={() => onHover(index)}
              className={cn("focus:bg-transparent", index === active && "bg-accent text-accent-foreground")}
            >
              <command.icon className="size-4" />
              {command.label}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { SlashMenuContext, useSlashMenu, useSlashMenuApi };
