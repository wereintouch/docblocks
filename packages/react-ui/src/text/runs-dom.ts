import type { TextRun } from "docblocks-core";

/**
 * The imperative counterpart of renderRuns (text/runs.tsx): build the
 * marked inline DOM of the runs and replace a container's children with
 * it. The contenteditable content is browser-owned while edited, so the
 * text DOM is managed outside of React — this builder is the single place
 * that (re)writes it from the store runs.
 *
 * Contract: the flat character offsets of the editing layer assume the
 * DOM text length equals the flattened run text. A math run renders its
 * `tex` (mirroring renderRuns), so a math run whose `tex` length differs
 * from its text length breaks the offset mapping (a v1 limitation).
 */

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
 * color/highlight span, innermost to outermost).
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
}

export { renderRunsInto };
