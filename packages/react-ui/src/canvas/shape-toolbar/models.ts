/** The shape toolbar's types. The constants stand in `constants.ts`.
 */
import { SHAPE_VARIANTS } from "./constants";

type ShapeVariantId = (typeof SHAPE_VARIANTS)[number]["id"];

/** The hex input's accepted form (3 or 6 digits, the `#` optional). */
const HEX_RE = /^(?:#)?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export type { ShapeVariantId };
