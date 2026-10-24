import type { TextRun } from "docblocks-core";

import { INLINE_CODE_CLASS, LINK_CLASS } from "./runs";

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
 */

/** The data-slot of the trailing line-break anchor. */
const LINE_ANCHOR_SLOT = "docblocks/line-anchor";

/** The data-slot of the mention chip (an atomic, display-only inline run). */
const MENTION_SLOT = "docblocks/mention";

/** The zero-width caret seat of the trailing empty line. `contenteditable="false"` keeps the browser from absorbing typed text into the anchor. */
function lineBreakAnchor(): HTMLElement {
  const anchor = document.createElement("span");
  anchor.setAttribute("data-slot", LINE_ANCHOR_SLOT);
  anchor.setAttribute("contenteditable", "false");
  anchor.textContent = "\u200B";
  return anchor;
}

/** The flattened run text as rendered. */
function renderedTextOf(runs: TextRun[]): string {
  return runs.reduce((text, run) => text + run.text, "");
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
 * same structure renderRuns renders: the exclusive code run renders
 * alone; the rest nest link, bold, italic, strike, underline, then the
 * color/highlight span, innermost to outermost). A trailing line break
 * gets the anchor appended after the last run.
 */
function renderRunsInto(runs: TextRun[], container: HTMLElement): void {
  const nodes: Node[] = [];
  for (const run of runs) {
    // The mention renders alone: the chip is the atomic display of the label
    // snapshot. `contenteditable="false"` keeps the caret out of the chip
    // (the label is a data snapshot, not editable text); other marks on the
    // run do not restyle the chip (the mention is display-only).
    const mention = run.marks.mention;
    if (mention !== undefined) {
      const chip = document.createElement("span");
      chip.setAttribute("data-slot", MENTION_SLOT);
      chip.setAttribute("data-mention-kind", mention.kind);
      chip.setAttribute("contenteditable", "false");
      chip.textContent = mention.label;
      nodes.push(chip);
      continue;
    }
    if (run.marks.code === true) {
      const code = document.createElement("code");
      code.className = INLINE_CODE_CLASS;
      code.textContent = run.text;
      nodes.push(code);
      continue;
    }
    let node: Node = document.createTextNode(run.text);
    if (run.marks.link !== undefined) node = wrap(node, "a", { href: run.marks.link.href, class: LINK_CLASS });
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

export { renderRunsInto, LINE_ANCHOR_SLOT, MENTION_SLOT };
