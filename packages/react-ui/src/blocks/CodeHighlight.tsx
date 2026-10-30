import { useLayoutEffect, useRef } from "react";

import { cn } from "../shared/ui/cn";
import { grammarOf, highlightSync, isGrammarLoaded, loadGrammar } from "./code-highlight";

interface CodeHighlightProps {
  /** The block's source text (the doc's runs flattened). */
  code: string;
  /** The block's language attr (a curated highlight value). */
  language: string | undefined;
  /** The wrap state — the layer must match the inner's line layout. */
  wrap: boolean;
}

/**
 * The code block's highlight background layer.
 *
 * The element stands behind the inner editable (absolute, non-interactive,
 * unselectable) and carries the visible ink of the code: the raw text
 * immediately (the visible text never vanishes into a loading gap) and the
 * highlighted fragment (the token spans) as soon as the language grammar
 * settles. The inner editable renders the same text with transparent ink —
 * the caret and the selection stand (they are CSS properties, not text
 * color).
 *
 * The layer is pure view state (the (text, language) projection): it writes
 * nothing to the doc and takes no part in the diff/selection/clipboard
 * pipelines.
 */
function CodeHighlight({ code, language, wrap }: CodeHighlightProps) {
  const ref = useRef<HTMLPreElement>(null);

  // A layout effect: the raw-text write must land before the first paint
  // (a freshly mounted block — a page load, a remote doc — must not show an
  // empty layer behind the transparent inner for the first frame).
  useLayoutEffect(() => {
    const pre = ref.current;
    if (pre === null) return;
    const grammar = grammarOf(language);
    if (grammar === null) {
      pre.innerHTML = ""; // defensive — the component is not mounted for the plain languages
      return;
    }
    // The raw state stands until the grammar settles (and after a failed
    // load) — the text is visible from the first frame.
    pre.textContent = code;
    // A per-effect generation guard: a stale async paint (an in-flight
    // grammar load settling after a language switch) must not overwrite
    // the newer run's paint.
    let alive = true;
    const paint = () => {
      if (!alive || ref.current === null) return;
      const html = highlightSync(code, language);
      if (html !== null) ref.current.innerHTML = html;
    };
    if (isGrammarLoaded(grammar)) {
      paint();
    } else {
      void (async () => {
        try {
          await loadGrammar(grammar);
        } catch {
          // a failed load keeps the raw text
          return;
        }
        paint();
      })();
    }
    return () => {
      alive = false;
    };
  }, [code, language]);

  return (
    <pre
      ref={ref}
      aria-hidden
      data-slot="docblocks/code-highlight"
      className={cn(
        // The same typography and line layout as the inner editable (the
        // font, the inherited size and line height, the wrap mode) — the
        // two layers align on the glyph grid.
        "pointer-events-none absolute inset-0 z-0 m-0 font-(family-name:--docblocks-mono-font-family) select-none",
        wrap ? "whitespace-pre-wrap" : "whitespace-pre"
      )}
    />
  );
}

export { CodeHighlight };
