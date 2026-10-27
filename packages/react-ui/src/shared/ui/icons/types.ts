import type { ComponentType, SVGProps } from "react";

/** The local icon's component type (the icon's consumer API: the SVG
 * props, the currentColor's stroke). */
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type { IconComponent };
