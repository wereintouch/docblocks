/**
 * The canvas container's renderer (the reworked group): the rectangle's thin neutral border + the title chip at the
 * top-left (above the box's top frame, the small gap off the border line —
 * the chip stands off when the title is absent / empty). The interior is
 * pointer-transparent (the members stand z-above and clickable); the
 * border's wide hit band and the title chip are the press targets (they
 * select the container). The selected border stands the canvas selection's
 * color (the wrapper's tint stands off — the box is the members' area). The
 * title's double-click enters the inline edit (the commit is one
 * `updateBlock`; the empty commit stands the removed state — the attr is
 * never deleted, the empty string is the removed stand). A selected
 * title-less container stands the title's set-menu (the shape toolbar's
 * idiom) anchored at the top-left. Pure view state: the doc writes on the
 * commit only.
 */
import { useEffect, useRef, useState } from "react";

import type { Block, BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Input } from "../shared/ui/Input";
import { stopPropagation } from "../shared/utils";
import { useCanvasTextEdit } from "./canvas-text-edit-context";

type GROUP_BLOCK_VIEW = Extract<Block, { type: "group" }>;
/** The border's wide hit band (px, both sides — the thin line's reach). */
const BORDER_HIT_PX = 6;
/** The title chip's left offset from the box's left edge (px). */
const TITLE_LEFT_PX = 16;
/** The title chip's gap from the box's top frame (px): the chip stands
 * ABOVE the frame line, its bottom edge the gap off the border. */
const TITLE_GAP_PX = 4;

function GroupBlock({ id, block, selected }: { id: BlockId; block: GROUP_BLOCK_VIEW; selected: boolean }) {
  const { doc } = useEditorContext();
  const title = block.attrs?.title ?? "";
  const hasTitle = title !== "";
  // The title's inline edit (the canvas's inline-edit session — the press's
  // pointer capture retargets the dblclick to the view's container, so the
  // edit opens from the container's dblclick handler, not the chip's own).
  const canvasTextEdit = useCanvasTextEdit();
  const editing = canvasTextEdit !== null && canvasTextEdit.editingId === id;
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The edit's focus + select-all on open (the whole title stands selected —
  // the Backspace / the type replace it).
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitTitle = (value: string) => {
    const trimmed = value.trim();
    // The no-op stand (the value stands the committed title — the doc's own
    // read: the peer's concurrent edit is not clobbered) and the gone block.
    const current = doc.getBlock(id);
    if (current === null || current.type !== "group") return;
    if (trimmed === (current.attrs?.title ?? "")) return;
    doc.transact(() => {
      doc.updateBlock(id, { title: trimmed });
    });
  };

  const closeEditing = () => canvasTextEdit?.setEditingId(null);
  const onTitleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    closeEditing();
    commitTitle(event.target.value);
  };
  const onTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const selectedColor = "var(--docblocks-canvas-selection-border-color)";
  const borderColor = selected ? selectedColor : "var(--docblocks-table-border-color)";

  // The border's wide hit band's half (px): each of the four strips stands
  // the edge straddled (the half in, the half out).
  const HIT_HALF = BORDER_HIT_PX / 2;

  return (
    <div className="pointer-events-none h-full w-full">
      {/* The visual border (the 1px ring + the selected outline):
          pointer-TRANSPARENT — the interior stands the members' press (a
          full-box hit band would shield the members under the container). */}
      <div
        className="absolute rounded-(--docblocks-radius)"
        style={{
          inset: 0,
          boxShadow: `inset 0 0 0 1px ${borderColor}`,
          outline: selected ? `1px solid ${selectedColor}` : undefined,
          outlineOffset: 1,
        }}
      />
      {/* The border's wide hit bands (the press target — the ring ONLY, the
          interior stays pointer-transparent so the members stand their own
          press): four transparent strips, each straddling one edge. */}
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          left: -HIT_HALF,
          right: -HIT_HALF,
          top: -HIT_HALF,
          height: BORDER_HIT_PX,
        }}
      />
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          left: -HIT_HALF,
          right: -HIT_HALF,
          bottom: -HIT_HALF,
          height: BORDER_HIT_PX,
        }}
      />
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          top: -HIT_HALF,
          bottom: -HIT_HALF,
          left: -HIT_HALF,
          width: BORDER_HIT_PX,
        }}
      />
      <div
        data-slot="docblocks/group-border"
        style={{
          pointerEvents: "auto",
          cursor: "default",
          position: "absolute",
          top: -HIT_HALF,
          bottom: -HIT_HALF,
          right: -HIT_HALF,
          width: BORDER_HIT_PX,
        }}
      />
      {hasTitle && !editing && (
        <div
          data-slot="docblocks/group-title"
          className="absolute cursor-default truncate rounded-(--docblocks-radius) px-2 py-0.5 text-(length:--docblocks-font-size) leading-5"
          style={{
            pointerEvents: "auto",
            left: TITLE_LEFT_PX,
            bottom: `calc(100% + ${TITLE_GAP_PX}px)`,
            maxWidth: "calc(100% - 32px)",
            background: "var(--docblocks-page-card-background)",
            border: `1px solid ${borderColor}`,
            color: "var(--docblocks-text-color)",
          }}
        >
          {title}
        </div>
      )}
      {hasTitle && editing && (
        <Input
          ref={inputRef}
          type="text"
          data-slot="docblocks/group-title-edit"
          aria-label="Container title"
          defaultValue={title}
          onPointerDown={stopPropagation}
          // The chip stand lives in the inline style (the look set);
          // the className drops the field base props the chip owns
          // (height fit, no frame, no shadow, no focus ring).
          className="absolute h-auto rounded-(--docblocks-radius) border-0 px-2 py-0.5 text-(length:--docblocks-font-size) leading-5 shadow-none focus-visible:ring-0 md:text-(length:--docblocks-font-size)"
          style={{
            pointerEvents: "auto",
            left: TITLE_LEFT_PX,
            bottom: `calc(100% + ${TITLE_GAP_PX}px)`,
            width: 120,
            boxSizing: "border-box",
            background: "var(--docblocks-page-card-background)",
            border: `1px solid ${selectedColor}`,
            color: "var(--docblocks-text-color)",
            outline: "none",
          }}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
        />
      )}
      {selected && !hasTitle && !editing && (
        <GroupTitleMenu onCommit={commitTitle} open={menuOpen} onOpenChange={setMenuOpen} />
      )}
    </div>
  );
}

/**
 * The selected title-less container's set-title menu (the shape toolbar's
 * idiom): the small trigger chip at the top-left (the title's seat), the
 * popover's input. The commit is one `updateBlock` (the empty commit stands
 * the removed state — the menu closes, the chip stands off).
 */
function GroupTitleMenu({
  open,
  onOpenChange,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const toggleOpen = () => onOpenChange(!open);
  const onTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value);
  const onFormBlur = () => {
    onCommit(draft);
    setDraft("");
    onOpenChange(false);
  };
  const onFormKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(draft);
      setDraft("");
      onOpenChange(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      onOpenChange(false);
    }
  };

  return (
    <div
      className="absolute"
      style={{ pointerEvents: "auto", left: TITLE_LEFT_PX, bottom: `calc(100% + ${TITLE_GAP_PX}px)` }}
      onPointerDown={stopPropagation}
    >
      <Button
        data-slot="docblocks/group-title-menu"
        variant="ghost"
        size="sm"
        aria-label="Set container title"
        aria-expanded={open}
        className="h-auto rounded-(--docblocks-radius) border border-(--docblocks-table-border-color) bg-(--docblocks-page-card-background) px-2 py-0.5 text-(length:--docblocks-font-size) leading-5 text-(--docblocks-text-color) shadow-none hover:bg-(--docblocks-page-card-background) hover:text-(--docblocks-text-color) focus-visible:ring-0"
        onClick={toggleOpen}
      >
        Title
      </Button>
      {open && (
        <Input
          size="sm"
          type="text"
          data-slot="docblocks/group-title-menu-input"
          aria-label="Container title"
          autoFocus
          className="mt-1 h-auto w-40 rounded-(--docblocks-radius) border-(--docblocks-table-border-color) bg-(--docblocks-page-card-background) px-1.5 py-0.5 text-(length:--docblocks-font-size) text-(--docblocks-text-color) md:text-(length:--docblocks-font-size) dark:bg-(--docblocks-page-card-background)"
          value={draft}
          placeholder="Container title"
          onChange={onTitleChange}
          onBlur={onFormBlur}
          onKeyDown={onFormKeyDown}
        />
      )}
    </div>
  );
}

export type { GROUP_BLOCK_VIEW as GroupBlockView };
export { GroupBlock };
