/** The per-block render error boundary: a synchronous throw of a block's
 * renderer (anomalous data, a consumer renderer from the registry) is
 * contained to the block — the placeholder stand (the block's type badge
 * over the render-error note) replaces the failed render, the rest of the
 * editor stays mounted and editable (without the boundary the throw
 * propagates to the root and unmounts the whole editor).
 *
 * The `version` prop is the block's data identity (the store snapshot's
 * reference): while the boundary stands the failed state over a changed
 * version (the data changed — a peer fixed the anomalous block) the error
 * resets and the render retries. A healthy block's version change is a
 * plain prop update (no reset, no remount — the block's DOM state, the
 * caret included, stands). */
import { useTranslation } from "react-i18next";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import type { BlockType } from "docblocks-core";

import { Badge } from "../shared/ui/Badge";
import { Card, CardContent } from "../shared/ui/Card";

/** The placeholder stand of the failed block's render. */
function RenderErrorPlaceholder({ type }: { type: BlockType }) {
  const { t } = useTranslation("blocks");
  return (
    <Card
      data-slot="docblocks/render-error"
      data-block-type={type}
      className="my-(--docblocks-block-spacing) outline-none"
    >
      <CardContent className="flex items-center gap-2">
        <Badge variant="secondary">{type}</Badge>
        <span className="text-xs text-muted-foreground">{t("error.render")}</span>
      </CardContent>
    </Card>
  );
}

class BlockErrorBoundary extends Component<
  { version: unknown; type: BlockType; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(prev: { version: unknown }): void {
    // The data changed over the failed state: reset and retry — a remote
    // edit that fixed the anomalous block renders over the retry.
    if (this.state.failed && prev.version !== this.props.version) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      "[docblocks] a block renderer threw — the block stands the placeholder stand",
      this.props.type,
      info,
      error
    );
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <RenderErrorPlaceholder type={this.props.type} />;
    }
    return this.props.children;
  }
}

export { BlockErrorBoundary };
