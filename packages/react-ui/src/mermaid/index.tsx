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
 * render). A looser mode is a consumer decision outside this package.
 * The preview follows the editor's theme: the `dark` class on the editor
 * root or any ancestor (the v1 theme contract) sets the mermaid theme in
 * the same task as the `render` call (the global config is read
 * synchronously at the render's start), and a theme flip re-renders the
 * diagram (an ancestor class watch).
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

import { useEffect, useRef, useState } from "react";

import type { BlockId, CodeBlock } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { childrenSlot } from "../blocks/BlockView";
import { CodeHeader } from "../blocks/CodeHeader";
import { TextBlock, textOf } from "../blocks/TextBlock";
import type { BlockRendererProps } from "../blocks/renderers";
import { Alert, AlertDescription, AlertTitle } from "../shared/ui/Alert";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { Skeleton } from "../shared/ui/Skeleton";
import { CodeXml, Eye, LoaderCircle, TriangleAlert } from "../shared/ui/icons";
import { INLINE_CODE_CLASS } from "../text/runs";

// The v1 security + behavior stand (see the module doc). Safe to run
// more than once: initialize only sets the config.
// `suppressErrorRendering` keeps rejected renders from leaving their
// temp container behind.
const MERMAID_CONFIG_STAND = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
} as const;

/**
 * Sets the global mermaid config for the editor's theme. Mermaid 12
 * reads the config synchronously at the start of `render` (before its
 * first await), so setting it in the same task as the render call is
 * race-free across the page's instances (the global config is the only
 * theme lever — `render` takes no per-render config).
 */
function configureMermaidTheme(theme: "light" | "dark"): void {
  mermaid.initialize({ ...MERMAID_CONFIG_STAND, theme: theme === "dark" ? "dark" : "default" });
}

// The module-scope stand: the light default before the first mount.
configureMermaidTheme("light");

/** The editor's theme as seen from one element: the `dark` class on the element or any ancestor. */
function detectEditorTheme(el: Element | null): "light" | "dark" {
  return el !== null && el.closest(".dark") !== null ? "dark" : "light";
}

/**
 * The editor's theme for one ref'd element, reactive to a theme flip:
 * a single MutationObserver watches the `class` attribute of the
 * element's ancestor chain (collected on mount — the preview's branch
 * swap keeps the same ancestors). A flip re-renders the diagram through
 * the value change (a repeat of the current value is a React no-op).
 */
function useContainerTheme<T extends Element>(ref: React.RefObject<T | null>): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => detectEditorTheme(ref.current));

  useEffect(() => {
    const apply = (): void => setTheme(detectEditorTheme(ref.current));
    apply();
    const targets: Element[] = [];
    for (let node: Element | null = ref.current; node !== null; node = node.parentElement) {
      targets.push(node);
    }
    if (targets.length === 0) return;
    const observer = new MutationObserver(apply);
    for (const target of targets) observer.observe(target, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [ref]);

  return theme;
}

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
 * error flag. The effect re-runs on every text change (the store-driven
 * re-render passes a fresh block snapshot, so the text prop is the
 * re-render trigger) and on an editor-theme flip (the theme is the
 * global config's stand, set in the same task as the render call).
 */
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

/**
 * The code/preview mode segment of one mermaid code block's header (the
 * header's left group — right of the language button). The mode is the
 * `mermaidMode` attr (default "code"); a switch is one `updateBlock` (one
 * undo step, one wire update), a repeat of the current mode a no-op.
 */
function MermaidModeSelector({ id, block }: { id: BlockId; block: CodeBlock }) {
  const { doc } = useEditorContext();
  const mode = block.attrs?.mermaidMode ?? "code";
  const pick = (next: "code" | "preview"): void => {
    if (next === mode) return;
    doc.updateBlock(id, { mermaidMode: next });
  };
  return (
    <SegmentSelector
      options={[
        { value: "code", label: "Show the code", icon: <CodeXml className="size-4" /> },
        { value: "preview", label: "Show the diagram preview", icon: <Eye className="size-4" /> },
      ]}
      value={mode}
      onChange={pick}
      ariaLabel="Mermaid display mode"
      slot="docblocks/mermaid-mode"
      pillSlot="docblocks/mermaid-mode-pill"
      buttonAttrName="mermaid-mode-button"
    />
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
