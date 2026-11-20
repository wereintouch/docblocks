/** The code block's body: the line-number track (the metrics' anchors —
 * the line boxes measured against the inner's live DOM) and the wrap-aware
 * scroll container with the highlight layer (behind the inner, the same
 * scroll box — no scroll desync). The inner editable itself stands over
 * the entry (every text type shares it); this body wraps it for the code
 * block only. */
import { useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { cn } from "../shared/ui/cn";
import { textOf } from "../text/text-inner";
import { CodeHighlight } from "./code/CodeHighlight";
import { isHighlightable } from "./code/code-highlight";
import { measureCodeLines } from "./code/code-metrics";
import type { CodeLineMetric } from "./code/code-metrics";
import type { EditableBlock } from "./models";
import { COLLAPSED_CLAMP } from "./text-block-classes";

/** Whether two measured line layouts agree (the metrics re-measure guard). */
function sameMetrics(a: CodeLineMetric[] | null, b: CodeLineMetric[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.top !== y.top || x.height !== y.height) return false;
  }
  return true;
}

/**
 * The code block's logical line metrics (the line-number anchors): the
 * line boxes measured against the inner's live DOM after every render
 * (a text / attr / selection re-render re-runs the measure; the guard
 * keeps the metrics reference stable while the layout stands) and on a
 * width change (the wrap reflows the lines).
 */
function useCodeLineMetrics(
  block: EditableBlock,
  innerRef: RefObject<HTMLDivElement | null>,
  id: BlockId
): CodeLineMetric[] | null {
  const { store } = useEditorContext();
  const isCode = block.type === "code";
  const [lineMetrics, setLineMetrics] = useState<CodeLineMetric[] | null>(null);
  useLayoutEffect(() => {
    if (!isCode) return;
    const inner = innerRef.current;
    if (inner === null) return;
    const next = measureCodeLines(inner, textOf(block.content));
    setLineMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
  });
  useEffect(() => {
    if (!isCode || typeof ResizeObserver === "undefined") return;
    const inner = innerRef.current;
    if (inner === null) return;
    const observer = new ResizeObserver(() => {
      const current = store.getState().blocks[id];
      if (current === undefined || "content" in current === false) return;
      const next = measureCodeLines(inner, textOf(current.content));
      setLineMetrics((prev) => (sameMetrics(prev, next) ? prev : next));
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [id, isCode, store]);
  return lineMetrics;
}

interface CodeBodyProps {
  id: BlockId;
  block: EditableBlock;
  /** The code body's hide stand (the renderer's display mode's place — the
   * mermaid preview; the inner editable stays mounted over the text-sync
   * path). */
  codeBodyHidden: boolean;
  /** The inner editable's ref (the body's scroll container hosts it). */
  innerRef: RefObject<HTMLDivElement | null>;
  /** The inner editable (the entry's single stand over every text type). */
  innerEditable: ReactNode;
}

function CodeBody({ id, block, codeBodyHidden, innerRef, innerEditable }: CodeBodyProps) {
  const lineMetrics = useCodeLineMetrics(block, innerRef, id);

  // The code body state: the logical lines (the line-number rows and the
  // collapsed clamp count), the wrap (the default stands for the absent
  // attr), and the collapsed clamp (the absent attr reads as expanded).
  const isCode = block.type === "code";
  const codeLines = isCode ? textOf(block.content).split("\n").length : 0;
  const codeText = isCode ? textOf(block.content) : "";
  const codeWrap = isCode ? (block.attrs?.wrap ?? true) : true;
  const codeCollapsed = isCode && block.attrs?.collapsed === true;
  const codeLineNumbers = isCode ? (block.attrs?.lineNumbers ?? true) : false;
  // The highlight layer's gate: a curated language carries the background
  // layer (and the inner's transparent ink); every other language (plain,
  // unknown, mermaid) stands the plain visible text, no layer.
  const highlightableCode = isCode && isHighlightable(block.attrs?.language);

  return (
    <div
      data-slot="docblocks/code-body"
      className={cn("flex min-w-0", codeBodyHidden && "hidden")}
      style={codeCollapsed ? COLLAPSED_CLAMP : undefined}
    >
      {codeLineNumbers && (
        <div
          data-slot="docblocks/code-line-numbers"
          aria-hidden
          className="
            relative w-10 shrink-0 pr-2 text-right font-(family-name:--docblocks-mono-font-family) text-muted-foreground
            select-none
          "
        >
          {lineMetrics === null
            ? Array.from({ length: codeLines }, (_, i) => <div key={i}>{i + 1}</div>)
            : lineMetrics.map((metric, i) => (
                <span key={i} className="absolute block" style={{ top: metric.top, height: metric.height }}>
                  {i + 1}
                </span>
              ))}
        </div>
      )}
      <ScrollArea
        data-slot="docblocks/code-scroll"
        className={cn("min-w-0 flex-1", !codeWrap && "overflow-x-auto overflow-y-hidden")}
      >
        {/* The highlight layer (behind the inner, the same scroll box —
            no scroll desync) and the inner editable in one relative stack. */}
        <div data-slot="docblocks/code-highlight-stack" className="relative min-w-full">
          {highlightableCode && block.type === "code" ? (
            <CodeHighlight code={codeText} language={block.attrs?.language} wrap={codeWrap} />
          ) : null}
          {innerEditable}
        </div>
      </ScrollArea>
    </div>
  );
}

export { CodeBody };
export type { CodeBodyProps };
