/**
 * The canvas figure's z-order menu (the explicit zIndex): the
 * three-dots button + the four reorder items (bring forward / bring to
 * front / send backward / send to back). Each pick is one `doc.setZOrder`
 * (one transact — one undo step, one wire update). The edge states stand
 * disabled (the topmost's forward / front, the bottommost's backward /
 * back — the command is a no-op there, the UI stands it off).
 *
 * The position is the target's 0-based place among the surface's
 * z-order elements (the dense 1..count index space — the frame and the
 * page blocks stand no index). The toolbar chrome is non-modal here: a
 * pick closes the menu (the dropdown's contract), the outside press
 * closes without a write.
 */
import type { Block, BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/ui";
import { EllipsisVertical } from "../shared/ui/icons";

/** The z-order target types (the surface's canvas elements — the frame
 *  and the page blocks stand no index; the core command's parity). */
const ZORDER_TYPES: ReadonlySet<string> = new Set(["shape", "connector", "canvas-text", "group"]);

/**
 * The target's position (0-based) among the surface's z-order elements
 * and their total (the dense 1..count space); null when the target is
 * not a z-order element or is not among the children.
 */
function zPositionOf(
  childIds: readonly BlockId[],
  blocks: Record<BlockId, Block>,
  targetId: BlockId
): { position: number; count: number } | null {
  const target = blocks[targetId];
  if (target === undefined || !ZORDER_TYPES.has(target.type)) return null;
  let position = -1;
  let count = 0;
  for (const childId of childIds) {
    const block = blocks[childId];
    if (block === undefined || !ZORDER_TYPES.has(block.type)) continue;
    if (childId === targetId) position = count;
    count += 1;
  }
  if (position === -1) return null;
  return { position, count };
}

function ZOrderMenu({
  targetId,
  position,
  count,
  label,
}: {
  targetId: BlockId;
  /** The target's 0-based position among the surface's z-order elements. */
  position: number;
  /** The surface's z-order elements' total. */
  count: number;
  /** The trigger's accessible name (the toolbar's label). */
  label: string;
}) {
  const { doc } = useEditorContext();
  // count < 2: every pick would be a no-op (nothing to swap with) — the
  // trigger stands absent, not disabled.
  if (count < 2 || position < 0 || position >= count) return null;
  const atTop = position === count - 1;
  const atBottom = position === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-slot="docblocks/z-order-menu"
          aria-label={label}
          title="Arrange (z-order)"
        >
          <EllipsisVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} aria-label={label}>
        <DropdownMenuItem data-action="forward" disabled={atTop} onSelect={() => doc.setZOrder(targetId, "forward")}>
          Bring forward
        </DropdownMenuItem>
        <DropdownMenuItem data-action="to-front" disabled={atTop} onSelect={() => doc.setZOrder(targetId, "toFront")}>
          Bring to front
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-action="back" disabled={atBottom} onSelect={() => doc.setZOrder(targetId, "back")}>
          Send backward
        </DropdownMenuItem>
        <DropdownMenuItem data-action="to-back" disabled={atBottom} onSelect={() => doc.setZOrder(targetId, "toBack")}>
          Send to back
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ZOrderMenu, zPositionOf };
