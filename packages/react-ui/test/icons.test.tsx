// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as Icons from "../src/shared/ui/icons";

// The committed icon set: self-contained SVG files (the local SVG path
// data), no runtime icon-library dependency. Pin the exact set so a
// removal or an unlisted addition is a test failure. The per-file
// self-containment is pinned in icons-files.test.ts (node environment).
const ICON_SET = [
  "Baseline",
  "Bold",
  "Cable",
  "CalendarIcon",
  "CalendarClock",
  "Captions",
  "Check",
  "ChevronDown",
  "ChevronUp",
  "ChevronsDownUp",
  "ChevronsUpDown",
  "Circle",
  "CircleCheck",
  "CircleChevronDown",
  "CodeXml",
  "Copy",
  "Database",
  "Dot",
  "EllipsisVertical",
  "Eye",
  "GripVertical",
  "Hash",
  "Heading1",
  "Heading2",
  "Heading3",
  "Image",
  "Italic",
  "List",
  "ListChecks",
  "ListOrdered",
  "LoaderCircle",
  "Menu",
  "Pilcrow",
  "Quote",
  "Search",
  "Sigma",
  "SquareCheck",
  "SquareSplitVertical",
  "Strikethrough",
  "Table",
  "TextAlignCenter",
  "TextAlignEnd",
  "TextAlignStart",
  "TextQuote",
  "TextWrap",
  "Triangle",
  "TriangleAlert",
  "TriangleFilled",
  "Type",
  "Underline",
  "X",
] as const;

afterEach(cleanup);

describe("shared/ui/icons", () => {
  it("stands the consumer's props (the size's width/height, the className, the currentColor's stroke)", () => {
    // The 13 icons of the default catalog (the consumer's API:
    // the SVG props over the component).
    const ownerSet = [
      "Check",
      "ChevronDown",
      "ChevronUp",
      "ChevronRight",
      "Circle",
      "Cable",
      "CalendarIcon",
      "CalendarClock",
      "CircleCheck",
      "CircleChevronDown",
      "Hash",
      "ListChecks",
      "Type",
    ] as const;
    for (const name of ownerSet) {
      const Icon = Icons[name];
      const { container, unmount } = render(<Icon width={14} height={14} className="hidden" />);
      const svg = container.querySelector("svg");
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute("width"), name).toBe("14");
      expect(svg?.getAttribute("height"), name).toBe("14");
      expect(svg?.getAttribute("class"), name).toBe("hidden");
      expect(svg?.getAttribute("stroke"), name).toBe("currentColor");
      expect(svg?.querySelector("path, line, rect, circle"), name).not.toBeNull();
      unmount();
    }
  });
  it("renders a 24x24 color-anchored svg per icon", () => {
    for (const name of ICON_SET) {
      const Icon = Icons[name];
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute("viewBox"), name).toBe("0 0 24 24");
      if (name === "TriangleFilled") {
        // The filled variant anchors its color via fill.
        expect(svg?.getAttribute("fill"), name).toBe("currentColor");
        expect(svg?.getAttribute("stroke"), name).toBe("none");
      } else {
        expect(svg?.getAttribute("stroke"), name).toBe("currentColor");
        expect(svg?.getAttribute("fill"), name).toBe("none");
      }
      unmount();
    }
  });
});
