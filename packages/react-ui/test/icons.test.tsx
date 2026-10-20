// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import * as Icons from "../src/shared/ui/icons";

// The committed icon set: self-contained SVG files (lucide path data), no
// runtime lucide-react dependency. Pin the exact set so a removal or an
// unlisted addition is a test failure. The per-file self-containment is
// pinned in icons-files.test.ts (node environment).
const ICON_SET = [
  "Baseline",
  "Bold",
  "Captions",
  "Check",
  "ChevronDown",
  "ChevronsDownUp",
  "ChevronsUpDown",
  "CircleCheck",
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
  "Underline",
  "X",
] as const;

afterEach(cleanup);

describe("shared/ui/icons", () => {
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
