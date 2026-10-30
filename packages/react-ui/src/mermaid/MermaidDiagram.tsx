/** The live diagram preview of one mermaid code block: `mermaid.render`
 * into a unique id per attempt, the svg injected into a container. The
 * previous svg stays put while a (re-)render runs (no flicker while
 * typing); a parse error drops the svg and shows the raw text with the
 * error flag. The effect re-runs on every text change (the store-driven
 * re-render passes a fresh block snapshot, so the text prop is the
 * re-render trigger) and on an editor-theme flip (the theme is the
 * global config's stand, set in the same task as the render call). */
import mermaid from "mermaid";

import { useEffect, useRef, useState } from "react";

import type { BlockId } from "docblocks-core";

import { Alert, AlertDescription, AlertTitle } from "../shared/ui/Alert";
import { Skeleton } from "../shared/ui/Skeleton";
import { LoaderCircle, TriangleAlert } from "../shared/ui/icons";
import { INLINE_CODE_CLASS } from "../text/runs";
import { configureMermaidTheme, safeId } from "./mermaid-config";
import { useContainerTheme } from "./useContainerTheme";

/** The preview state: the current svg (kept while a re-render runs), or the last error. */
type DiagramState = { svg: string | null; error: string | null };

/** A unique mermaid render id per attempt (mermaid requires one per render). */
let renderSeq = 0;

function MermaidDiagram({ id, text }: { id: BlockId; text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useContainerTheme(containerRef);
  const [state, setState] = useState<DiagramState>({ svg: null, error: null });

  useEffect(() => {
    renderSeq += 1;
    const renderId = `mb-${renderSeq}-${safeId(id)}`;
    let cancelled = false;
    configureMermaidTheme(theme);
    mermaid
      .render(renderId, text)
      .then(({ svg }) => {
        if (!cancelled) setState({ svg, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ svg: null, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, text, theme]);

  if (state.error !== null) {
    return (
      <Alert
        ref={containerRef}
        data-slot="docblocks/mermaid"
        data-state="error"
        variant="destructive"
        className="mt-(--docblocks-block-spacing)"
      >
        <TriangleAlert />
        <AlertTitle data-slot="docblocks/mermaid-error-message" className="line-clamp-none">
          {state.error}
        </AlertTitle>
        <AlertDescription>
          <code data-slot="docblocks/mermaid-error" className={INLINE_CODE_CLASS}>
            {text}
          </code>
        </AlertDescription>
      </Alert>
    );
  }
  if (state.svg !== null) {
    return (
      <div
        ref={containerRef}
        data-slot="docblocks/mermaid"
        data-state="diagram"
        className="mt-(--docblocks-block-spacing)"
      >
        <div data-slot="docblocks/mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      data-slot="docblocks/mermaid"
      data-state="loading"
      className="relative mt-(--docblocks-block-spacing)"
    >
      <Skeleton className="h-24 w-full" />
      <div className="absolute inset-0 flex items-center justify-center gap-2">
        <LoaderCircle className="size-4 animate-spin" />
        <span data-slot="docblocks/mermaid-loading">rendering…</span>
      </div>
    </div>
  );
}

export { MermaidDiagram };
