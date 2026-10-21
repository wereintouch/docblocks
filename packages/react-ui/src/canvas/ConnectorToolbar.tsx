/**
 * The connector's floating style toolbar (the single `connector`
 * selection): the three line types (straight / orthogonal / curved), the
 * stroke color (the palette section — the hex is data, not theme), the
 * width (the 1–4 px dots, the FigureBorderSelector's parity with the
 * shape's border), the arrowhead's figure (none / arrow / circle) and
 * the start-side stand. Each pick is one `updateBlock` in one transact
 * (one undo step, one wire update). The toolbar is canvas chrome (its
 * own pointers; a press on it starts no canvas session).
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
import { cn } from "../shared/ui/cn";
import { ArrowRight, Circle, Curve, Diagonal, Elbow, Minus, Stroke } from "../shared/ui/icons";
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
  arrowHead,
  arrowStart,
  style,
}: {
  id: BlockId;
  variant: "straight" | "orthogonal" | "curved" | undefined;
  strokeColor: string | undefined;
  strokeWidth: number | undefined;
  arrowHead: "none" | "arrow" | "circle" | undefined;
  arrowStart: boolean | undefined;
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

  return (
    <div
      data-slot="docblocks/canvas-chrome"
      className="absolute z-50"
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
        {/* The arrowhead's figure (absent = the arrow). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-slot="docblocks/connector-toolbar-arrow-head"
              aria-label="Arrowhead"
              title="Arrowhead"
            >
              {ARROW_HEADS.find((head) => head.value === (arrowHead ?? "arrow"))?.icon ?? (
                <ArrowRight className="size-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} aria-label="Arrowheads">
            {ARROW_HEADS.map(({ value, label, icon }) => (
              <DropdownMenuCheckboxItem
                key={value}
                aria-label={label}
                checked={arrowHead === value || (value === "arrow" && arrowHead === undefined)}
                onSelect={() => {
                  if (value === (arrowHead ?? "arrow")) return; // the no-op stand writes nothing
                  apply({ arrowHead: value });
                }}
              >
                {icon}
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* The start-side stand (an arrowhead at the start endpoint too). */}
        <Button
          variant="ghost"
          size="icon"
          data-slot="docblocks/connector-toolbar-arrow-start"
          aria-label="Arrow at the start"
          title="Arrow at the start"
          aria-pressed={arrowStart === true}
          className={cn(arrowStart === true && "bg-accent text-accent-foreground")}
          onClick={() => apply({ arrowStart: !arrowStart })}
        >
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export { ConnectorToolbar };
