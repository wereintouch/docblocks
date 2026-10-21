import { Circle, Cloud, Cylinder, Diamond, Square, SquareRounded } from "../../shared/ui/icons";

/** The shape toolbar's constants (the border width dots, the shape variant
 *  picker list, the hex input's form). */

// The border's width stand (the FigureBorderSelector's dots, the px).
const BORDER_WIDTH_POINTS: readonly number[] = [1, 2, 3, 4];

/** The shape types (the dock's shapes menu and the toolbar's type picker). */
const SHAPE_VARIANTS = [
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "rounded", label: "Rounded Rectangle", icon: SquareRounded },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "diamond", label: "Diamond", icon: Diamond },
  { id: "cylinder", label: "Cylinder", icon: Cylinder },
  { id: "cloud", label: "Cloud", icon: Cloud },
] as const;

type ShapeVariantId = (typeof SHAPE_VARIANTS)[number]["id"];

/** The hex input's accepted form (3 or 6 digits, the `#` optional). */
const HEX_RE = /^(?:#)?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export { BORDER_WIDTH_POINTS, HEX_RE, SHAPE_VARIANTS };
export type { ShapeVariantId };
