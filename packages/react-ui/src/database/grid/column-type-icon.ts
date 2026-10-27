/** The column type's icon (the header's name-line's type mark + the
 * create-menu's entry's mark — the lucide set). The
 * mapping reads the column's type + the relation's kind / cardinality
 * (the enum's dict / the row's link; the many's stand): the relation's
 * kinds read first (a ref's type stands the plain `text`), then the
 * scalar's type. */
import type { LucideIcon } from "lucide-react";
import { Cable, Calendar, CalendarClock, CircleCheck, CircleChevronDown, Hash, ListChecks, Type } from "lucide-react";

function columnTypeIcon(type: string, refKind?: "enum" | "row", refMany?: boolean): LucideIcon {
  if (refKind === "enum") return refMany ? ListChecks : CircleChevronDown;
  if (refKind === "row") return Cable;
  if (type === "integer" || type === "numeric") return Hash;
  if (type === "boolean") return CircleCheck;
  if (type === "date") return Calendar;
  if (type === "timestamptz") return CalendarClock;
  return Type;
}

export { columnTypeIcon };
