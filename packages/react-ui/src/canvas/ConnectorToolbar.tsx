import type { CSSProperties, ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { Button } from "../shared/ui";
import { Curve, Diagonal, Elbow } from "../shared/ui/icons";

/**
 * The connector's floating type toolbar (the single `connector` selection):
 * the three line types (straight / orthogonal / curved). Each pick is one
 * `updateBlock({ variant })` in one transact (one undo step, one wire
 * update). The toolbar is canvas chrome (its own pointers; a press on it
 * starts no canvas session).
 */
function ConnectorToolbar({
  id,
  variant,
  style,
}: {
  id: BlockId;
  variant: "straight" | "orthogonal" | "curved" | undefined;
  /** The positioned style (the left/top at the line's midpoint). */
  style: CSSProperties;
}) {
  const { doc } = useEditorContext();

  const apply = (next: "straight" | "orthogonal" | "curved") => {
    doc.transact(() => {
      doc.updateBlock(id, { variant: next });
    });
  };

  const option = (next: "straight" | "orthogonal" | "curved", label: string, icon: ReactNode) => (
    <Button
      variant="ghost"
      size="icon"
      data-slot={`docblocks/connector-toolbar-${next}`}
      aria-label={label}
      aria-pressed={variant === next}
      title={label}
      onClick={() => apply(next)}
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
        // The press on the toolbar body keeps the canvas container's focus
        // (the keyboard context: the Delete/Backspace path).
        event.preventDefault();
      }}
    >
      <div
        data-slot="docblocks/connector-toolbar"
        role="toolbar"
        aria-label="Connector type"
        className="
          flex items-center gap-0.5 rounded-(--docblocks-radius) border border-(--docblocks-formatbar-border-color)
          bg-(--docblocks-formatbar-background) p-1 text-(--docblocks-text-color) shadow-(--docblocks-formatbar-shadow)
        "
      >
        {option("straight", "Straight line", <Diagonal className="size-4" />)}
        {option("orthogonal", "Orthogonal line", <Elbow className="size-4" />)}
        {option("curved", "Curved line", <Curve className="size-4" />)}
      </div>
    </div>
  );
}

export { ConnectorToolbar };
