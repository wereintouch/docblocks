import { type CSSProperties, Fragment, type ReactNode } from "react";

import type { TextRun } from "docblocks-core";

/**
 * Render inline text runs with their marks (lenient reader contract:
 * unknown marks are ignored and the text is kept).
 */
function renderRuns(runs: TextRun[]): ReactNode {
  return runs.map((run, index) => <Fragment key={index}>{renderMarked(run)}</Fragment>);
}

/** One run: exclusive marks (code, math) render alone; the rest nest. */
function renderMarked(run: TextRun): ReactNode {
  const { marks } = run;

  if (marks.code === true) return <code>{run.text}</code>;
  if (marks.math !== undefined) return <code data-mark="math">{marks.math.tex}</code>;

  let node: ReactNode = run.text;
  if (marks.link !== undefined) node = <a href={marks.link.href}>{node}</a>;
  if (marks.bold === true) node = <strong>{node}</strong>;
  if (marks.italic === true) node = <em>{node}</em>;
  if (marks.strike === true) node = <s>{node}</s>;
  if (marks.underline === true) node = <u>{node}</u>;

  const style: CSSProperties = {};
  if (marks.color !== undefined) style.color = marks.color.value;
  if (marks.highlight !== undefined && marks.highlight.value !== undefined) {
    style.backgroundColor = marks.highlight.value;
  }
  if (Object.keys(style).length > 0) node = <span style={style}>{node}</span>;

  return node;
}

export { renderRuns };
