import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as Icons from "../src/shared/ui/icons";

const ICON_SET = [
  "ArrowRight",
  "Ban",
  "Baseline",
  "Bold",
  "BookOpen",
  "Calendar",
  "Captions",
  "Check",
  "ChevronDown",
  "ChevronLeft",
  "ChevronRight",
  "ChevronsDownUp",
  "ChevronsUpDown",
  "Circle",
  "CircleCheck",
  "CircleHelp",
  "CircleX",
  "Cloud",
  "CodeXml",
  "Container",
  "Copy",
  "Curve",
  "Cylinder",
  "Dashed",
  "Database",
  "Diagonal",
  "Diamond",
  "Dot",
  "Download",
  "Elbow",
  "Ellipsis",
  "EllipsisVertical",
  "Eye",
  "Fill",
  "Flag",
  "GripVertical",
  "Hand",
  "Hash",
  "Heading1",
  "Heading2",
  "Heading3",
  "Heart",
  "Image",
  "Info",
  "Italic",
  "Lightbulb",
  "Link",
  "List",
  "ListOrdered",
  "LoaderCircle",
  "Lock",
  "Menu",
  "MessageSquare",
  "Minus",
  "MousePointer2",
  "Network",
  "Palette",
  "Pen",
  "Pilcrow",
  "Plus",
  "Quote",
  "RotateCcw",
  "Scan",
  "Search",
  "Shield",
  "Sigma",
  "Sparkles",
  "Square",
  "SquareCheck",
  "SquareRounded",
  "SquareSplitVertical",
  "SquareText",
  "Star",
  "Strikethrough",
  "Stroke",
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
  "Zap",
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
