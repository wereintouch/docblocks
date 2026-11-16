/** The custom attribute row's drag wrapper: the framer `Reorder.Item` (the
 *  position-only layout slide over the rows' reflow, the dragged row's
 *  zIndex lift — the blocks' rows' parity) + the gutter grip (the blocks'
 *  grip's parity: the same `--docblocks-gutter-left`'s offset over the
 *  row's column, the hover's reveal). The grip's pointerdown starts the
 *  drag (the grip is the only drag trigger — the row's own drag is
 *  disarmed, a press without movement stays the plain gesture). The
 *  release stands the release's commit (one command — one undo step);
 *  the live reorder over the drag is the preview (the doc/wire stand
 *  untouched until the release). */
import { Reorder, useDragControls } from "framer-motion";
import { useTranslation } from "react-i18next";

import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import { TRANSITION } from "../motion/constants";
import { GripVertical } from "../shared/ui/icons";

function DraggableAttributeRow({
  attributeKey,
  onDragStart,
  onDragEnd,
  children,
}: {
  attributeKey: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("editor");
  const dragControls = useDragControls();
  const onGripPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    // The default's suppression keeps the page editable's focus (a
    // mousedown's default would move the caret into the shared editable
    // and seat it over the panel's island).
    event.preventDefault();
    onDragStart();
    dragControls.start(event);
  };
  return (
    <Reorder.Item
      as="div"
      data-slot="docblocks/attribute-custom-row"
      value={attributeKey}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      layout="position"
      transition={{ layout: TRANSITION }}
      whileDrag={{ zIndex: 10 }}
      className="group relative"
    >
      <span
        data-slot="docblocks/attribute-row-grip"
        data-attribute-key={attributeKey}
        role="button"
        aria-label={t("attributes.reorderAria", { name: attributeKey })}
        onPointerDown={onGripPointerDown}
        className="
          absolute top-1/2 left-(--docblocks-gutter-left) flex size-5 -translate-y-1/2 cursor-grab touch-none
          items-center justify-center rounded-full text-(--docblocks-gutter-color) opacity-0
          group-hover:opacity-100
          active:cursor-grabbing
        "
      >
        <GripVertical className="size-4" />
      </span>
      {children}
    </Reorder.Item>
  );
}

export { DraggableAttributeRow };
