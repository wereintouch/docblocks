/**
 * docblocks-react-ui/mermaid — the diagram renderer for code blocks.
 *
 * mermaid is an optional peer dependency and is imported only from this
 * subpath: the base entry (`docblocks-react-ui`) never imports it, so a
 * consumer without the package ships zero extra weight.
 *
 * A diagram is not a block type — it is the existing `code` block with
 * `language: "mermaid"` (zero schema change). Wire the renderer per
 * instance: `blockRenderers={{ code: MermaidCodeRenderer }}`. The
 * renderer dispatches on the language: a mermaid code block renders per
 * its code/preview mode (the exclusive rendering — see below), every
 * other code block falls through to the built-in plain code rendering
 * (the same TextBlock the built-in switch uses, so a consumer override
 * keeps full editing for non-mermaid code blocks).
 *
 * Security posture (v1): `mermaid.initialize` runs with
 * `securityLevel: "strict"` — the user's diagram source is sanitized and
 * no click handlers or foreign scripts are bound — and with
 * `suppressErrorRendering: true`, so a rejected render removes its
 * working container from the page before the parse error propagates
 * (without it mermaid leaves a visible temp element in `body` per failed
 * render). A looser mode is a consumer decision outside this package. The preview renders in
 * mermaid's default (light) theme in both the light and the dark editor
 * theme; a theme-aware initialize is a follow-up.
 *
 * The code/preview mode (the `mermaidMode` attr, default `"code"` — it
 * persists and syncs) — the modes are exclusive: `code` renders the
 * editable code only (the diagram stands hidden), `preview` renders the
 * diagram only (the code body is hidden — the editable stays mounted for
 * the text sync). The mode segment (the CodeXml / Eye toggle buttons with
 * the sliding highlight) stands in the header's left group, right of the
 * language button, and is visible only while the block is hovered (the
 * header controls' reveal).
 */
import mermaid from "mermaid";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { childrenSlot } from "../blocks/BlockView";
import { CodeHeader } from "../blocks/CodeHeader";
import { TextBlock, textOf } from "../blocks/TextBlock";
import type { BlockRendererProps } from "../blocks/renderers";
import { Alert, AlertDescription, AlertTitle } from "../shared/ui/Alert";
import { Skeleton } from "../shared/ui/Skeleton";
import { cn } from "../shared/ui/cn";
import { CodeXml, Eye, LoaderCircle, TriangleAlert } from "../shared/ui/icons";
import { INLINE_CODE_CLASS } from "../text/runs";

// The v1 security posture (see the module doc). Safe to run more than
// once: initialize only sets the config. `suppressErrorRendering` keeps
// rejected renders from leaving their temp container behind.
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });

/** The preview state: the current svg (kept while a re-render runs), or the last error. */
type DiagramState = { svg: string | null; error: string | null };

/** A unique mermaid render id per attempt (mermaid requires one per render). */
let renderSeq = 0;

/** The block id with the characters that are not valid in a DOM id stripped. */
function safeId(id: BlockId): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * The live diagram preview of one mermaid code block: `mermaid.render`
 * into a unique id per attempt, the svg injected into a container. The
 * previous svg stays put while a (re-)render runs (no flicker while
 * typing); a parse error drops the svg and shows the raw text with the
 * error flag. The effect re-runs on every text change — the store-driven
 * re-render passes a fresh block snapshot, so the text prop is the re-render trigger.
 */
function MermaidDiagram({ id, text }: { id: BlockId; text: string }) {
  const [state, setState] = useState<DiagramState>({ svg: null, error: null });

  useEffect(() => {
    renderSeq += 1;
    const renderId = `mb-${renderSeq}-${safeId(id)}`;
    let cancelled = false;
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
  }, [id, text]);

  if (state.error !== null) {
    return (
      <Alert
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
      <div data-slot="docblocks/mermaid" data-state="diagram" className="mt-(--docblocks-block-spacing)">
        <div data-slot="docblocks/mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />
      </div>
    );
  }
  return (
    <div data-slot="docblocks/mermaid" data-state="loading" className="relative mt-(--docblocks-block-spacing)">
      <Skeleton className="h-24 w-full" />
      <div className="absolute inset-0 flex items-center justify-center gap-2">
        <LoaderCircle className="size-4 animate-spin" />
        <span data-slot="docblocks/mermaid-loading">rendering…</span>
      </div>
    </div>
  );
}

/**
 * The code/preview mode segment of one mermaid code block's header (the
 * header's left group — right of the language button). Two plain
 * toggle buttons and one shared sliding pill (a framer-free CSS
 * transition over the measured active-button geometry — the pill is the
 * highlight; the active button carries no styling of its own). The mode
 * is the `mermaidMode` attr (default "code"); a switch is one
 * `updateBlock` (one undo step, one wire update), a repeat of the
 * current mode a no-op.
 */
function MermaidModeSelector({ id, block }: { id: BlockId; block: CodeBlock }) {
  const { doc } = useEditorContext();
  const mode = block.attrs?.mermaidMode ?? "code";
  const listRef = useRef<HTMLDivElement>(null);
  /** The sliding pill's geometry (the active button's position and size in the list). */
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Measure the active button before paint (no first-mount flash) and on
  // every list resize (a font or theme change). The reference-equality
  // guard keeps the state stable across re-renders.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = (): void => {
      const button = list.querySelector<HTMLElement>(`[data-mermaid-mode-button="${mode}"]`);
      if (button === null) return;
      const listRect = list.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const next = {
        left: buttonRect.left - listRect.left,
        top: buttonRect.top - listRect.top,
        width: buttonRect.width,
        height: buttonRect.height,
      };
      setPill((prev) =>
        prev !== null &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      );
    };
    measure();
    // jsdom (and SSR) have no ResizeObserver — the measurement on mount and
    // on every mode change still runs; the resize watch is a browser bonus.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [mode]);

  const pick = (value: "code" | "preview"): void => {
    if (mode === value) return;
    doc.updateBlock(id, { mermaidMode: value });
  };

  const buttonClass = (value: "code" | "preview"): string =>
    cn(
      `
        relative z-10 flex size-6 items-center justify-center rounded-md transition-colors
        focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
        focus-visible:outline-ring
      `,
      mode === value ? "text-foreground" : "hover:text-foreground"
    );

  return (
    <div
      ref={listRef}
      role="group"
      aria-label="Mermaid display mode"
      data-slot="docblocks/mermaid-mode"
      className="relative inline-flex items-center rounded-lg bg-muted p-0.75 text-muted-foreground"
    >
      {pill !== null && (
        <span
          data-slot="docblocks/mermaid-mode-pill"
          aria-hidden
          className="
            absolute top-0 left-0 rounded-md bg-background shadow-sm transition-[transform,width,height] duration-200
            ease-out
          "
          style={{
            transform: `translate(${pill.left}px, ${pill.top}px)`,
            width: pill.width,
            height: pill.height,
          }}
        />
      )}
      <button
        type="button"
        data-mermaid-mode-button="code"
        aria-pressed={mode === "code"}
        aria-label="Show the code"
        title="Code"
        className={buttonClass("code")}
        onClick={() => pick("code")}
      >
        <CodeXml className="size-4" />
      </button>
      <button
        type="button"
        data-mermaid-mode-button="preview"
        aria-pressed={mode === "preview"}
        aria-label="Show the diagram preview"
        title="Preview"
        className={buttonClass("preview")}
        onClick={() => pick("preview")}
      >
        <Eye className="size-4" />
      </button>
    </div>
  );
}

/**
 * One code block with the diagram capability: a `language: "mermaid"`
 * block renders per its `mermaidMode` (default "code") — the modes are
 * exclusive: `code` renders the editable code only (the diagram stands
 * hidden), `preview` renders the diagram only (the code body hidden —
 * the editable stays mounted for the text sync); every other code block
 * is the plain built-in code rendering.
 */
function MermaidCodeBlock({ id, block }: { id: BlockId; block: CodeBlock }) {
  const nested = childrenSlot(id, block.children);
  if (block.attrs?.language !== "mermaid") {
    return <TextBlock id={id} block={block} tag="pre" header={<CodeHeader id={id} block={block} />} nested={nested} />;
  }
  // The mode is the `mermaidMode` attr (default "code"): the modes are
  // exclusive — the preview renders the diagram instead of the code body.
  const mode = block.attrs?.mermaidMode ?? "code";
  return (
    <TextBlock
      id={id}
      block={block}
      tag="pre"
      header={<CodeHeader id={id} block={block} center={<MermaidModeSelector id={id} block={block} />} />}
      codeBodyHidden={mode === "preview"}
      nested={
        mode === "preview" ? (
          <>
            <MermaidDiagram id={id} text={textOf(block.content)} />
            {nested}
          </>
        ) : (
          nested
        )
      }
    />
  );
}

/**
 * A BlockRenderer for the `code` type. The registry dispatches by type:
 * a renderer registered under "code" only receives code blocks (the union
 * cannot express that narrowing at the call site).
 */
function MermaidCodeRenderer({ id, block }: BlockRendererProps) {
  return <MermaidCodeBlock id={id} block={block as CodeBlock} />;
}

export { MermaidCodeRenderer };
