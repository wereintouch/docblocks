/** The link's right-click menu (the anchor's actions): the open + the
 * copy's address stand over the edit and the view's modes, the edit + the
 * remove stand over the edit's mode only (the read-only's stand). A plain
 * fixed-positioned div (the viewport's coords) — no Radix menu (the
 * release-open's buttonless-up select's stand is the Radix item's gap, not
 * the plain button's). */
import { useTranslation } from "react-i18next";

import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "../../shared/ui/Button";
import { cn } from "../../shared/ui/cn";
import { preventDefault } from "../../shared/utils";
import type { LinkMenuState } from "./models";

/** The menu's width (px — the clamp's measure). */
const MENU_WIDTH_PX = 224;
/** The menu's viewport's edge margin (px). */
const VIEWPORT_MARGIN_PX = 6;

interface LinkMenuProps {
  menu: LinkMenuState;
  viewMode: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}

function LinkMenu({ menu, viewMode, onOpen, onCopy, onEdit, onRemove, onClose }: LinkMenuProps) {
  const { t } = useTranslation("editor");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Clamp inside the viewport (the menu stands over the open's point —
  // the scroll's container's offset stands the client's coords' direct
  // stand).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (el === null) return;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(menu.x, window.innerWidth - MENU_WIDTH_PX - VIEWPORT_MARGIN_PX));
    const top = Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(menu.y, window.innerHeight - el.offsetHeight - VIEWPORT_MARGIN_PX)
    );
    setPosition({ left, top });
  }, [menu.x, menu.y]);

  const handleOpen = () => onOpen();
  const handleCopy = () => onCopy();
  const handleEdit = () => onEdit();
  const handleRemove = () => onRemove();

  // The close's explicit's paths (the read-only's stand's parity over the
  // other's menus): the Escape (the capture's document's stand — the menu's
  // own focus's absence) + the outside's pointerdown (the capture's
  // document's stand over the menu's own press's exclusion).
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const el = menuRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (el !== null && target !== null && !el.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);
  const item = (label: string, action: () => void) => (
    <Button
      role="menuitem"
      variant="ghost"
      size="sm"
      className="h-8 w-full justify-start px-2 text-sm"
      onClick={action}
    >
      {label}
    </Button>
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      data-slot="docblocks/link-menu"
      aria-label={t("link.menuAria")}
      className={cn(
        "fixed z-modal flex flex-col gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground",
        "shadow-md",
        position === null && "opacity-0"
      )}
      style={position === null ? undefined : { left: position.left, top: position.top, width: MENU_WIDTH_PX }}
      onMouseDown={preventDefault}
      onContextMenu={(event) => event.preventDefault()}
    >
      {item(t("link.open"), handleOpen)}
      {item(t("link.copy"), handleCopy)}
      {!viewMode && item(t("link.edit"), handleEdit)}
      {!viewMode && item(t("link.remove"), handleRemove)}
    </div>
  );
}

export { LinkMenu };
