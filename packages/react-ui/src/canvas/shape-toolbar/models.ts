/** The shape toolbar's types. The constants stand in `constants.ts`.
 */
import { SHAPE_VARIANTS } from "./constants";

type ShapeVariantId = (typeof SHAPE_VARIANTS)[number]["id"];

export type { ShapeVariantId };
