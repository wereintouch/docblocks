/**
 * The connector's floating style toolbar (the single `connector`
 * selection): the three line types (straight / orthogonal / curved), the
 * stroke color (the palette section — the hex is data, not theme), the
 * width (the 1–4 px dots, the FigureBorderSelector's parity with the
 * shape's border), the stroke style (the solid / the dashed stand — the
 * dot data renders but stands no pick), and the two arrowheads' figures
 * (none / arrow / circle) — the start first, then the end, the two
 * equal three-way menus
 * (the: the start stands its own figure, not a
 * copy of the end). Each pick is one `updateBlock` in one transact (one
 * undo step, one wire update). The toolbar is canvas chrome (its own
 * pointers; a press on it starts no canvas session). The label is not a
 * toolbar control: the line's
 * double-click stands the label's inline edit.
 */
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FigureBorderSelector,
} from "../shared/ui";
import { Separator } from "../shared/ui/Separator";
import { ArrowRight, Circle, Curve, Dashed, Diagonal, Elbow, Minus, Stroke } from "../shared/ui/icons";
import { ColorSection } from "./shape-toolbar/ColorSection";
import { BORDER_WIDTH_POINTS } from "./shape-toolbar/models";

const WIDTH_POINTS = BORDER_WIDTH_POINTS;
/** The absent width's stand (the registry's default). */
const DEFAULT_WIDTH = 1;

const ARROW_HEADS: readonly { value: "none" | "arrow" | "circle"; label: string; icon: ReactNode }[] = [
  { value: "arrow", label: "Arrow", icon: <ArrowRight className="size-4" /> },
  { value: "circle", label: "Circle", icon: <Circle className="size-4" /> },
  { value: "none", label: "None", icon: <Minus className="size-4" /> },
];

function ConnectorToolbar({
  id,
  variant,
  strokeColor,
  strokeWidth,
  strokeStyle,
  arrowHead,
  arrowStart,
  style,
}: {
  id: BlockId;
  variant: "straight" | "orthogonal" | "curved" | undefined;
  strokeColor: string | undefined;
  strokeWidth: number | undefined;
  strokeStyle: "solid" | "dash" | "dot" | undefined;
  arrowHead: "none" | "arrow" | "circle" | undefined;
  arrowStart: "none" | "arrow" | "circle" | undefined;
  /** The positioned style (the left/top at the line's midpoint). */
  style: CSSProperties;
}) {
  const { doc } = useEditorContext();
  // The palette section's open state (the toolbar's single section).
  const [openSection, setOpenSection] = useState<"stroke" | null>(null);

  const apply = (patch: Record<string, unknown>) => {
    doc.transact(() => {
      doc.updateBlock(id, patch);
    });
  };

  const applyVariant = (next: "straight" | "orthogonal" | "curved") => {
    if (next === variant) return;
    apply({ variant: next });
  };

  const applyWidth = (index: number) => {
    const value = WIDTH_POINTS[index];
    if (value === undefined) return;
    if (Math.round(strokeWidth ?? DEFAULT_WIDTH) === value) return; // the no-op stand writes nothing
    apply({ strokeWidth: value });
  };

  const widthIndex = WIDTH_POINTS.indexOf(Math.round(strokeWidth ?? DEFAULT_WIDTH));

  // The line's stroke style (the solid / the dashed stand): the absent
  // value stands the solid default; the dot data renders but stands no
  // UI pick. A pick of the current style is the no-op stand (it writes
  // nothing).
  const currentStyle = strokeStyle ?? "solid";
  const applyStyle = (next: "solid" | "dash") => {
    if (next === currentStyle) return; // the no-op stand writes nothing
    apply({ strokeStyle: next });
  };

  const styleOption = (next: "solid" | "dash", label: string, icon: ReactNode) => (
    <Button
      variant="ghost"
      size="icon"
      data-slot={`docblocks/connector-toolbar-${next}`}
      aria-label={label}
      aria-pressed={currentStyle === next}
      title={label}
      onClick={() => applyStyle(next)}
    >
      {icon}
    </Button>
  );

  const option = (next: "straight" | "orthogonal" | "curved", label: string, icon: ReactNode) => (
    <Button
      variant="ghost"
      size="icon"
      data-slot={`docblocks/connector-toolbar-${next}`}
      aria-label={label}
      aria-pressed={variant === next}
      title={label}
      onClick={() => applyVariant(next)}
    >
      {icon}
    </Button>
  );

  // The arrowhead figure's three-way menu (the end and the start stand the
  // equal menus —). `effective` is the
  // current figure (the end defaults to the arrow, the start to none); a
  // pick of the current figure is the no-op stand (it writes nothing).
  const arrowHeadMenu = (
    which: "start" | "end",
    effective: "none" | "arrow" | "circle",
    pick: (value: "none" | "arrow" | "circle") => void
  ) => {
    const label = `${which === "start" ? "Start" : "End"} arrowhead`;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-slot={`docblocks/connector-toolbar-arrow-${which}`}
            aria-label={label}
            title={label}
          >
            {ARROW_HEADS.find((head) => head.value === effective)?.icon ?? <ArrowRight className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          aria-label={`${which === "start" ? "Start" : "End"} arrowheads`}
        >
          {ARROW_HEADS.map(({ value, label: headLabel, icon }) => (
            <DropdownMenuCheckboxItem
              key={value}
              aria-label={headLabel}
              checked={effective === value}
              onSelect={() => {
                if (value === effective) return; // the no-op stand writes nothing
                pick(value);
              }}
            >
              {icon}
              {headLabel}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div
      data-slot="docblocks/canvas-chrome"
      // The toolbar (the selected line's menu) stands the TOPMOST chrome:
      // above the connector's endpoint handles (the port circles, z-50)
      // and the world layer. At an equal z-index the handles — rendered
      // after the toolbar in the canvas view — would paint over the menu
      // in the overlap zone (the zone under the menu belongs to the menu:
      // the port stands hidden and non-interactive there, and a click hits
      // the menu). The handles keep their stand (re-anchor / the port snap)
      // everywhere the menu does not cover them.
      className="absolute z-60"
      style={{ ...style, transform: "translate(-50%, -100%)" }}
      onMouseDown={(event) => {
        // The press on the toolbar body (the triggers) keeps the canvas
        // container's focus (the keyboard context: the Delete/Backspace
        // path). A press on the portaled palette content is NOT guarded
        // (the hex input must receive the mousedown default).
        if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
          event.preventDefault();
        }
      }}
    >
      <div
        data-slot="docblocks/connector-toolbar"
        role="toolbar"
        aria-label="Connector options"
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
      >
        {option("straight", "Straight line", <Diagonal className="size-4" />)}
        {option("orthogonal", "Orthogonal line", <Elbow className="size-4" />)}
        {option("curved", "Curved line", <Curve className="size-4" />)}
        <Separator orientation="vertical" className="h-5" />
        {/* The stroke color (the palette + the custom hex + the none
            entry — the absent stand is the theme's token). */}
        <ColorSection
          target="stroke"
          label="Line color"
          current={strokeColor}
          chipStyle={{ border: `2px solid ${strokeColor ?? "currentColor"}` }}
          icon={<Stroke className="size-4" />}
          open={openSection === "stroke"}
          onOpenChange={(value) => setOpenSection(value ? "stroke" : null)}
          onApply={(value) => apply({ strokeColor: value })}
        />
        {/* The width (the 1–4 px dots; the absent stand is the 1 px
            default — unlike the shape's border, the connector is the
            thin line by default). */}
        <FigureBorderSelector
          points={WIDTH_POINTS.length}
          value={widthIndex < 0 ? 0 : widthIndex}
          onChange={applyWidth}
          label="Line width"
          title="Line width (1–4 px)"
          className="mr-0.5"
        />
        <Separator orientation="vertical" className="h-5" />
        {/* The line's stroke style (the solid / the dashed stand — the
            dot data renders but stands no pick; a re-pick of the current
            style is the no-op stand). */}
        {styleOption("solid", "Solid line", <Minus className="size-4" />)}
        {styleOption("dash", "Dashed line", <Dashed className="size-4" />)}
        <Separator orientation="vertical" className="h-5" />
        {/* The two arrowheads' figures (the:
            the start first, then the end — the two equal three-way menus,
            none / arrow / circle). The end defaults to the arrow (absent
            = "arrow"), the start to none (absent = no start marker); each
            stands its own figure, not a copy of the other. */}
        {arrowHeadMenu("start", arrowStart ?? "none", (value) => apply({ arrowStart: value }))}
        {arrowHeadMenu("end", arrowHead ?? "arrow", (value) => apply({ arrowHead: value }))}
      </div>
    </div>
  );
}

export { ConnectorToolbar };
