import { memo } from "react";
import type { ComponentType, SVGProps } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
} from "../shared/ui";
import { cn } from "../shared/ui/cn";
import {
  ArrowRight,
  Circle,
  Cloud,
  Container,
  Cylinder,
  Diamond,
  Hand,
  MousePointer2,
  Pen,
  Square,
  SquareRounded,
  SquareSplitVertical,
  Type,
} from "../shared/ui/icons";
import type { CanvasTool } from "./viewport";
import type { CanvasViewportState } from "./viewport-state";

/** A 24px-stroke icon component (the package icon set). */
type DockIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** A dock tool button entry. */
interface DockTool {
  id: CanvasTool;
  label: string;
  icon: DockIcon;
}

/** The shape types (the dock's single shapes button opens them as a row). */
const SHAPE_TOOLS: DockTool[] = [
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "rounded", label: "Rounded Rectangle", icon: SquareRounded },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "diamond", label: "Diamond", icon: Diamond },
  { id: "cylinder", label: "Cylinder", icon: Cylinder },
  { id: "cloud", label: "Cloud", icon: Cloud },
];

const SHAPE_IDS: CanvasTool[] = SHAPE_TOOLS.map((tool) => tool.id);

/** The dock's tool groups, in display order (the Separators between the groups). */
const TOOL_GROUPS: DockTool[][] = [
  [{ id: "text", label: "Text", icon: Type }],
  [{ id: "frame", label: "Frame", icon: SquareSplitVertical }],
  [{ id: "container", label: "Container", icon: Container }],
  [{ id: "connector", label: "Connector", icon: ArrowRight }],
  [{ id: "pen", label: "Pen", icon: Pen }],
];

/**
 * The canvas dock (the floating chrome, bottom-center — the Miro-style
 * tool strip): the hand toggle (the pan mode) + the shapes' single button
 * (the shape types stand a horizontal menu) + the placement tools
 * (canvas-text, frame, connector, pen). The hand activates the pan mode
 * and drops any active tool (a pan never places); a tool click activates
 * the placement (the active state stands until a place, a cancel, or
 * another pick). The chrome wrapper keeps the container's pointer
 * sessions out (the buttons handle their own).
 */
const CanvasDock = memo(
  function CanvasDock({ viewport }: { viewport: CanvasViewportState }) {
    const { mode, activeTool, setMode, setActiveTool, setPendingStand } = viewport;

    const toggleHand = () => {
      const next = mode === "pan" ? "default" : "pan";
      setMode(next);
      if (next === "pan") {
        // The pan mode drops the active tool (the pan never places).
        setActiveTool(null);
        setPendingStand(null);
      }
    };

    const pickTool = (tool: CanvasTool) => {
      // A pick toggles: the active tool re-clicked is cancelled (along with
      // the pending connector pick); another pick replaces it.
      if (activeTool === tool) {
        setActiveTool(null);
        setPendingStand(null);
        return;
      }
      setMode("default");
      setActiveTool(tool);
      setPendingStand(null);
    };

    const shapesActive = activeTool !== null && SHAPE_IDS.includes(activeTool);

    return (
      <div data-slot="docblocks/canvas-chrome" className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div
          data-slot="docblocks/canvas-dock"
          role="toolbar"
          aria-label="Canvas tools"
          className="
            flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
            bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color)
            shadow-(--docblocks-formatbar-shadow)
          "
          onMouseDown={(event) => event.preventDefault()}
        >
          {/* The mode's button: the icon stands the current mode (the
            select pointer / the pan hand) — the press toggles it. The M
            key stands the select mode from the keyboard. */}
          <Button
            variant="ghost"
            size="xl"
            aria-label={mode === "pan" ? "Switch to the select mode" : "Switch to the pan mode"}
            aria-pressed={mode === "pan"}
            className={mode === "pan" ? "bg-accent text-accent-foreground" : undefined}
            onClick={toggleHand}
          >
            {mode === "pan" ? <Hand className="size-6" /> : <MousePointer2 className="size-6" />}
          </Button>
          <span className="flex items-center gap-0.5">
            <Separator orientation="vertical" className="h-6" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="xl"
                  title="Shapes"
                  aria-label="Shapes"
                  data-tool="shapes"
                  aria-pressed={shapesActive}
                  className={shapesActive ? "bg-accent text-accent-foreground" : undefined}
                >
                  <Square className="size-6" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="flex flex-row"
                aria-label="Shapes menu"
                data-slot="docblocks/canvas-shapes-menu"
              >
                {SHAPE_TOOLS.map(({ id, label, icon: Icon }) => (
                  <DropdownMenuItem
                    key={id}
                    aria-label={label}
                    data-tool={id}
                    className={cn("px-2.5", activeTool === id && "bg-accent text-accent-foreground")}
                    onSelect={() => pickTool(id)}
                  >
                    <Icon />
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
          {TOOL_GROUPS.map((group, index) => (
            <span key={group[0]!.id} className="flex items-center gap-0.5">
              {index > 0 && <Separator orientation="vertical" className="h-6" />}
              {group.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="xl"
                  title={label}
                  aria-label={label}
                  data-tool={id}
                  aria-pressed={activeTool === id}
                  className={activeTool === id ? "bg-accent text-accent-foreground" : undefined}
                  onClick={() => pickTool(id)}
                >
                  <Icon className="size-6" />
                </Button>
              ))}
            </span>
          ))}
        </div>
      </div>
    );
    // The viewport's object stands fresh per render (the hook's state
    // bundle): compare the fields the dock reads (the mode / tool flip and
    // the stable setters) so the session's pointermoves (the preview's
    // churn) stand the dock.
  },
  (prev, next) =>
    prev.viewport.mode === next.viewport.mode &&
    prev.viewport.activeTool === next.viewport.activeTool &&
    prev.viewport.setMode === next.viewport.setMode &&
    prev.viewport.setActiveTool === next.viewport.setActiveTool &&
    prev.viewport.setPendingStand === next.viewport.setPendingStand
);

export { CanvasDock };
