/** The column type's icon (the header's name-line's type mark + the
 * create-menu's entry's mark — the icon set's stand as local SVG). The mapping reads the column's type + the
 * relation's kind / cardinality (the enum's dict / the row's link; the
 * many's stand): the relation's kinds read first (a ref's type stands the
 * plain `text`), then the scalar's type. */
import type { IconComponent } from "../../shared/ui/icons";
import {
  Cable,
  CalendarClock,
  CalendarIcon,
  CircleCheck,
  CircleChevronDown,
  Hash,
  ListChecks,
  Type,
} from "../../shared/ui/icons";

function columnTypeIcon(type: string, refKind?: "enum" | "row", refMany?: boolean): IconComponent {
  if (refKind === "enum") return refMany ? ListChecks : CircleChevronDown;
  if (refKind === "row") return Cable;
  if (type === "integer" || type === "numeric") return Hash;
  if (type === "boolean") return CircleCheck;
  if (type === "date") return CalendarIcon;
  if (type === "timestamptz") return CalendarClock;
  return Type;
}

export { columnTypeIcon };
