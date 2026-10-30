import type { ComponentType, SVGProps } from "react";

import {
  Ban,
  BookOpen,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  Eye,
  Flag,
  Heart,
  Info,
  Lightbulb,
  Lock,
  MessageSquare,
  Shield,
  Sparkles,
  Star,
  TriangleAlert,
  Zap,
} from "../shared/ui/icons";

type CalloutVariant = "info" | "warning" | "danger";

/**
 * The callout's icon catalog (name -> component). The names stand in the data
 * (the core's `CALLOUT_ICONS`); this map is the render-side lookup and the
 * picker's grid source.
 */
const CALLOUT_ICON_COMPONENTS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  info: Info,
  "triangle-alert": TriangleAlert,
  "circle-x": CircleX,
  "circle-check": CircleCheck,
  "circle-help": CircleHelp,
  lightbulb: Lightbulb,
  "message-square": MessageSquare,
  star: Star,
  heart: Heart,
  zap: Zap,
  flag: Flag,
  lock: Lock,
  shield: Shield,
  "book-open": BookOpen,
  ban: Ban,
  eye: Eye,
  sparkles: Sparkles,
  check: Check,
};

/** The preset icon name per callout variant (the icon that stands when no override is set). */
const CALLOUT_PRESET_ICONS: Record<CalloutVariant, string> = {
  info: "info",
  warning: "triangle-alert",
  danger: "circle-x",
};

/**
 * The callout's effective icon name: the override when it stands a catalog
 * name, else the preset per variant (the lenient reader — an unknown override
 * falls back to the preset rather than rendering nothing).
 */
function calloutIconName(icon: string | null | undefined, variant: CalloutVariant | undefined): string {
  if (typeof icon === "string" && icon in CALLOUT_ICON_COMPONENTS) return icon;
  return CALLOUT_PRESET_ICONS[variant ?? "info"];
}

export { CALLOUT_ICON_COMPONENTS, CALLOUT_PRESET_ICONS, calloutIconName };
export type { CalloutVariant };
