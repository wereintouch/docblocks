import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as Icons from "../src/shared/ui/icons";

const ICON_SET = [
  "ArrowRight",
  "Baseline",
  "Bold",
  "Captions",
  "Check",
  "ChevronDown",
  "ChevronsDownUp",
  "ChevronsUpDown",
  "Circle",
  "CircleCheck",
  "CodeXml",
  "Copy",
  "Curve",
  "Database",
  "Diagonal",
  "Diamond",
  "Dot",
  "Elbow",
  "Ellipsis",
  "EllipsisVertical",
  "Eye",
  "Fill",
  "GripVertical",
  "Hand",
  "Hash",
  "Heading1",
  "Heading2",
  "Heading3",
  "Image",
  "Italic",
  "Link",
  "List",
  "ListOrdered",
  "LoaderCircle",
  "Menu",
  "MousePointer2",
  "Minus",
  "Palette",
  "Pen",
  "Pilcrow",
  "Plus",
  "Quote",
  "Search",
  "Sigma",
  "Square",
  "SquareCheck",
  "SquareRounded",
  "SquareSplitVertical",
  "Stroke",
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

describe("shared/ui/icons files", () => {
  it("exports exactly the committed icon set", () => {
    expect(Object.keys(Icons).sort()).toEqual([...ICON_SET].sort());
    for (const name of ICON_SET) expect(Icons[name], name).toBeTypeOf("function");
  });

  it("keeps every icon file self-contained (no lucide-react import)", () => {
    const dir = fileURLToPath(new URL("../src/shared/ui/icons", import.meta.url));
    const files = readdirSync(dir).filter((file) => file.endsWith(".tsx"));
    expect(files.length).toBe(ICON_SET.length);
    for (const file of files) {
      const src = readFileSync(`${dir}/${file}`, "utf8");
      expect(src, file).not.toContain("lucide-react");
      // Every icon anchors its color via stroke or fill (currentColor).
      expect(src.includes('stroke="currentColor"') || src.includes('fill="currentColor"'), file).toBe(true);
    }
  });
});
