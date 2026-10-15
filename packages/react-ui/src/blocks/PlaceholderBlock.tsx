import type { BlockType } from "docblocks-core";

import { Badge } from "../shared/ui/Badge";
import { Card, CardContent } from "../shared/ui/Card";

/** Placeholder for a block type without a dedicated renderer yet. */
function PlaceholderBlock({ type }: { type: BlockType }) {
  return (
    <Card
      data-slot="docblocks/placeholder"
      data-block-type={type}
      className="my-(--docblocks-block-spacing) outline-none"
    >
      <CardContent>
        <Badge variant="secondary">{type}</Badge>
      </CardContent>
    </Card>
  );
}

export { PlaceholderBlock };
