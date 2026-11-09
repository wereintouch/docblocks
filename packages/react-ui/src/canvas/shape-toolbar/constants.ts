import { Circle, Cloud, Cylinder, Diamond, Square, SquareRounded } from "../../shared/ui/icons";

/** The shape toolbar's constants (the border width dots, the shape variant
 *  picker list, the hex input's form). */

// The border's width stand (the FigureBorderSelector's dots, the px).
const BORDER_WIDTH_POINTS: readonly number[] = [1, 2, 3, 4];

/** The shape types (the dock's shapes menu and the toolbar's type picker;
 * the label's i18n key — the `canvas` namespace's `shapes.*`). */
const SHAPE_VARIANTS = [
  { id: "rect", labelKey: "shapes.rect", icon: Square },
  { id: "rounded", labelKey: "shapes.rounded", icon: SquareRounded },
  { id: "ellipse", labelKey: "shapes.ellipse", icon: Circle },
  { id: "diamond", labelKey: "shapes.diamond", icon: Diamond },
  { id: "cylinder", labelKey: "shapes.cylinder", icon: Cylinder },
  { id: "cloud", labelKey: "shapes.cloud", icon: Cloud },
] as const;

/** The hex input's accepted form (3 or 6 digits, the `#` optional). */
const HEX_RE = /^(?:#)?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The active item's stand (the pressed / the current's tint). */
const ACTIVE_ITEM_CLASS = "bg-accent text-accent-foreground";

export { ACTIVE_ITEM_CLASS, BORDER_WIDTH_POINTS, HEX_RE, SHAPE_VARIANTS };
