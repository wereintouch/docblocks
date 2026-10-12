import type { TextRun } from "docblocks-core";

/**
 * The imperative counterpart of renderRuns (text/runs.tsx): build the
 * marked inline DOM of the runs and replace a container's children with
 * it. The contenteditable content is browser-owned while edited, so the
 * text DOM is managed outside of React — this builder is the single place
 * that (re)writes it from the store runs.
 *
 * Contract: the flat character offsets of the editing layer assume the
 * DOM text length equals the flattened run text, except the trailing
 * line-break anchor (LINE_ANCHOR_SLOT): a rendered-only zero-width caret
 * seat appended when the text ends with a line break (Chromium's
 * contenteditable cannot seat a caret on a final empty line). The offset
 * and diff layers treat the anchor as carrying no logical character.
 * A math run renders its `tex` (mirroring renderRuns), so a math run whose
 * `tex` length differs from its text length breaks the offset mapping (a
 * v1 limitation).
 */

/** The data-slot of the trailing line-break anchor. */
const LINE_ANCHOR_SLOT = "docblocks/line-anchor";

/** The zero-width caret seat of the trailing empty line. `contenteditable="false"` keeps the browser from absorbing typed text into the anchor. */
function lineBreakAnchor(): HTMLElement {
  const anchor = document.createElement("span");
  anchor.setAttribute("data-slot", LINE_ANCHOR_SLOT);
  anchor.setAttribute("contenteditable", "false");
  anchor.textContent = "\u200B";
  return anchor;
}

/** The flattened run text as rendered (math runs contribute their `tex`). */
function renderedTextOf(runs: TextRun[]): string {
  return runs.reduce((text, run) => text + (run.marks.math !== undefined ? run.marks.math.tex : run.text), "");
}

/** Wrap the node in a new element with the given attributes. */
function wrap(node: Node, tag: string, attrs?: Record<string, string>): Node {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) element.setAttribute(name, value);
  element.appendChild(node);
  return element;
}

/**
 * Replace the container's children with the DOM of the given runs (the
 * same structure renderRuns renders: exclusive code/math runs render
 * alone; the rest nest link, bold, italic, strike, underline, then the
 * color/highlight span, innermost to outermost). A trailing line break
 * gets the anchor appended after the last run.
 */
function renderRunsInto(runs: TextRun[], container: HTMLElement): void {
  const nodes: Node[] = [];
  for (const run of runs) {
    if (run.marks.code === true) {
      const code = document.createElement("code");
      code.textContent = run.text;
      nodes.push(code);
      continue;
    }
    if (run.marks.math !== undefined) {
      const math = document.createElement("code");
      math.setAttribute("data-mark", "math");
      math.textContent = run.marks.math.tex;
      nodes.push(math);
      continue;
    }
    let node: Node = document.createTextNode(run.text);
    if (run.marks.link !== undefined) node = wrap(node, "a", { href: run.marks.link.href });
    if (run.marks.bold === true) node = wrap(node, "strong");
    if (run.marks.italic === true) node = wrap(node, "em");
    if (run.marks.strike === true) node = wrap(node, "s");
    if (run.marks.underline === true) node = wrap(node, "u");
    const { color, highlight } = run.marks;
    if (color !== undefined || (highlight !== undefined && highlight.value !== undefined)) {
      const span = document.createElement("span");
      if (color !== undefined) span.style.color = color.value;
      if (highlight !== undefined && highlight.value !== undefined) {
        span.style.backgroundColor = highlight.value;
      }
      span.appendChild(node);
      node = span;
    }
    nodes.push(node);
  }
  container.replaceChildren(...nodes);
  if (renderedTextOf(runs).endsWith("\n")) container.appendChild(lineBreakAnchor());
}

export { renderRunsInto, LINE_ANCHOR_SLOT };
