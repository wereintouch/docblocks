/**
 * The canvas container's floating toolbar (the single `group` / the single
 * `frame` selection): the standard toolbar's chrome over the z-order's menu
 * — the same mechanism over the shapes (the four reorder's picks, one
 * `setZOrder` each). The container and the frame carry no style attrs of
 * their own (the group's border / the frame's boundary stand the fixed's
 * stand), so the z-order's menu is the toolbar's whole content. The toolbar
 * is canvas chrome (its own pointers; a press on it starts no canvas
 * session).
 */
import { useTranslation } from "react-i18next";

import type { CSSProperties } from "react";

import type { BlockId } from "docblocks-core";

import { ZOrderMenu } from "./ZOrderMenu";
import { onToolbarBodyMouseDown } from "./shape-toolbar/utils";

function ZOrderToolbar({
  id,
  kind,
  zStand,
  style,
}: {
  id: BlockId;
  /** The toolbar's target's kind (the label's stand over the type). */
  kind: "group" | "frame";
  /** The z-order stand (the position / count over the surface's canvas
   *  elements). */
  zStand: { position: number; count: number };
  style: CSSProperties;
}) {
  const { t } = useTranslation("canvas");
  const label = kind === "frame" ? t("arrange.frame") : t("arrange.container");
  return (
    <div
      data-slot="docblocks/canvas-chrome"
      className="absolute z-50"
      style={{ ...style, transform: "translate(-50%, -100%)" }}
      onMouseDown={onToolbarBodyMouseDown}
    >
      <div
        data-slot="docblocks/z-order-toolbar"
        role="toolbar"
        aria-label={t("arrange.toolbar")}
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
      >
        <ZOrderMenu targetId={id} position={zStand.position} count={zStand.count} label={label} />
      </div>
    </div>
  );
}

export { ZOrderToolbar };
