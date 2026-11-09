/**
 * The canvas container / frame's shared title chip (the container's
 * idiom): the chip at the top-left above the box's top frame (the small
 * gap off the border line — the chip stands off when the title is absent
 * / empty), the chip's double-click inline edit (the commit is one
 * `updateBlock`; the empty commit stands the removed state — the empty
 * string is the removed stand), and the selected title-less block's
 * set-title menu (the shape toolbar's idiom) anchored at the title's
 * seat. Pure view state: the doc writes on the commit only. The `slot`
 * prefix stands the data hooks' identity (the group's slots stand the
 * container's, the frame's stand their own).
 */
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Input } from "../shared/ui/Input";
import { stopPropagation } from "../shared/utils";
import { useCanvasTextEdit } from "./canvas-text-edit-context";

/** The title chip's left offset from the box's left edge (px). */
const TITLE_LEFT_PX = 16;
/** The title chip's gap from the box's top frame (px): the chip stands
 * ABOVE the frame line, its bottom edge the gap off the border. */
const TITLE_GAP_PX = 4;
/** The title chip's data-hook slot's prefix (the caller's block type's
 * stand over the chip's idiom). */
type TitleSlot = "group" | "frame";

/** The title chip's position stand (the box's top-left corner, above the
 * top frame line — the chip's anchor point, off the border by the gap). */
const TITLE_CHIP_STYLE: { pointerEvents: "auto"; left: number; bottom: string } = {
  pointerEvents: "auto",
  left: TITLE_LEFT_PX,
  bottom: `calc(100% + ${TITLE_GAP_PX}px)`,
};

function CanvasTitleChip({
  id,
  title,
  selected,
  slot,
  ariaLabel,
  restBorderColor,
}: {
  id: BlockId;
  /** The committed title (the empty string = the removed stand). */
  title: string;
  selected: boolean;
  slot: TitleSlot;
  /** The chip's input's accessible name (the caller's block type's stand,
   * translated — the caller's i18n lookup). */
  ariaLabel: string;
  /** The chip's frame's resting color (the selected's stand is the
   *  selection's border). */
  restBorderColor: string;
}) {
  const { doc } = useEditorContext();
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
    if (current === null || (current.type !== "group" && current.type !== "frame")) return;
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
  const borderColor = selected ? selectedColor : restBorderColor;

  return (
    <>
      {hasTitle && !editing && (
        <div
          data-slot={`docblocks/${slot}-title`}
          className="
            absolute cursor-default truncate rounded-(--docblocks-radius) px-2 py-0.5
            text-(length:--docblocks-font-size) leading-5
          "
          style={{
            ...TITLE_CHIP_STYLE,
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
          data-slot={`docblocks/${slot}-title-edit`}
          aria-label={ariaLabel}
          defaultValue={title}
          onPointerDown={stopPropagation}
          // The chip stand lives in the inline style (the look set);
          // the className drops the field base props the chip owns
          // (height fit, no frame, no shadow, no focus ring).
          className="
            absolute h-auto rounded-(--docblocks-radius) border-0 px-2 py-0.5 text-(length:--docblocks-font-size)
            leading-5 shadow-none
            focus-visible:ring-0
            md:text-(length:--docblocks-font-size)
          "
          style={{
            ...TITLE_CHIP_STYLE,
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
        <TitleMenu
          slot={slot}
          ariaLabel={ariaLabel}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onCommit={commitTitle}
        />
      )}
    </>
  );
}

/**
 * The selected title-less block's set-title menu (the shape toolbar's
 * idiom): the small trigger chip at the top-left (the title's seat), the
 * popover's input. The commit is one `updateBlock` (the empty commit stands
 * the removed state — the menu closes, the chip stands off).
 */
function TitleMenu({
  slot,
  ariaLabel,
  open,
  onOpenChange,
  onCommit,
}: {
  slot: TitleSlot;
  ariaLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (value: string) => void;
}) {
  const { t } = useTranslation("canvas");
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
    <div className="absolute" style={TITLE_CHIP_STYLE} onPointerDown={stopPropagation}>
      <Button
        data-slot={`docblocks/${slot}-title-menu`}
        variant="ghost"
        size="sm"
        aria-label={slot === "group" ? t("titleChip.setContainerTitle") : t("titleChip.setFrameTitle")}
        aria-expanded={open}
        className="
          h-auto rounded-(--docblocks-radius) border border-(--docblocks-table-border-color)
          bg-(--docblocks-page-card-background) px-2 py-0.5 text-(length:--docblocks-font-size) leading-5
          text-(--docblocks-text-color) shadow-none
          hover:bg-(--docblocks-page-card-background) hover:text-(--docblocks-text-color)
          focus-visible:ring-0
        "
        onClick={toggleOpen}
      >
        {t("titleChip.button")}
      </Button>
      {open && (
        <Input
          size="sm"
          type="text"
          data-slot={`docblocks/${slot}-title-menu-input`}
          aria-label={ariaLabel}
          autoFocus
          className="
            mt-1 h-auto w-40 rounded-(--docblocks-radius) border-(--docblocks-table-border-color)
            bg-(--docblocks-page-card-background) px-1.5 py-0.5 text-(length:--docblocks-font-size)
            text-(--docblocks-text-color)
            md:text-(length:--docblocks-font-size)
            dark:bg-(--docblocks-page-card-background)
          "
          value={draft}
          placeholder={ariaLabel}
          onChange={onTitleChange}
          onBlur={onFormBlur}
          onKeyDown={onFormKeyDown}
        />
      )}
    </div>
  );
}

export { CanvasTitleChip };
