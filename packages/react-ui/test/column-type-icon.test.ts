/** The column type's icon mapping's pin (the 10 types' lucide set — the
 * header's name-line + the create-menu's entries). The relation's kinds
 * read first (a ref's type stands the plain `text`), then the scalar's
 * type. */
import { Cable, Calendar, CalendarClock, CircleCheck, CircleChevronDown, Hash, ListChecks, Type } from "lucide-react";
import { describe, expect, it } from "vitest";

import { columnTypeIcon } from "../src/database/grid/column-type-icon";

describe("columnTypeIcon", () => {
  it("the scalar's types stand their icons", () => {
    expect(columnTypeIcon("text")).toBe(Type);
    expect(columnTypeIcon("integer")).toBe(Hash);
    expect(columnTypeIcon("numeric")).toBe(Hash);
    expect(columnTypeIcon("boolean")).toBe(CircleCheck);
    expect(columnTypeIcon("date")).toBe(Calendar);
    expect(columnTypeIcon("timestamptz")).toBe(CalendarClock);
  });

  it("the relation's kinds read over the scalar's type (the ref's type stands the plain text)", () => {
    // The enum's dict (the single / the many's stand).
    expect(columnTypeIcon("text", "enum")).toBe(CircleChevronDown);
    expect(columnTypeIcon("text", "enum", true)).toBe(ListChecks);
    // The row's linked table (the single / the many's stand — the Cable's
    // share).
    expect(columnTypeIcon("text", "row")).toBe(Cable);
    expect(columnTypeIcon("text", "row", true)).toBe(Cable);
  });

  it("an unknown scalar's type stands the text's default", () => {
    expect(columnTypeIcon("some-consumer-type")).toBe(Type);
  });
});
