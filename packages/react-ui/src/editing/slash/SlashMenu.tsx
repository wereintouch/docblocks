/** The slash menu's floating command list: a plain absolutely-positioned
 *  div inside the editor root (the root is the positioning context),
 *  anchored at the "/" character (below the line, or above it on the
 *  viewport-bottom flip). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useBlock } from "../../hooks";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { cn } from "../../shared/ui/cn";
import { locatePosition } from "../dom-offset";
import { blockInnerOf, blockTextOf, liveCaretOf } from "../phrase";
import { DatabaseSlashPicker } from "./DatabaseSlashPicker";
import { SlashEmbedForm } from "./SlashEmbedForm";
import type { SlashDerivation, SlashMenuProps } from "./models";
import { deriveSlash, filterCommands } from "./utils";

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
  embedForm,
  onEmbedCancel,
  onEmbedCommit,
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
    // The picker / form is standing (the input's focus is expected — the menu
    // stays open over the phrase; the derivation is irrelevant while it stands).
    if (databasePick || embedForm) return;
    const caret = liveCaretOf(rootRef, state.blockId, state.slashOffset + 1);
    const derivation = deriveSlash(text, state.slashOffset, caret);
    setDerived(derivation);
    if (derivation.closed) onClose();
  }, [text, state, rootRef, onClose, databasePick, embedForm]);

  const items = derived === null ? [] : filterCommands(derived.query);
  const visible = items.length > 0 || databasePick || embedForm;
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
    const inner = blockInnerOf(rootRef, state.blockId);
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
      {embedForm ? (
        <SlashEmbedForm onCommit={onEmbedCommit} onCancel={onEmbedCancel} />
      ) : databasePick ? (
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

export { SlashMenu };
