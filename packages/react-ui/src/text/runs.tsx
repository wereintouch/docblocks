import { type CSSProperties, Fragment, type ReactNode } from "react";

import { isSafeLinkHref, type TextRun } from "docblocks-core";

/**
 * Render inline text runs with their marks (lenient reader contract:
 * unknown marks are ignored and the text is kept). The link's href is
 * gated over the public contract (the remote input is not validated —
 * an unsafe scheme stands the plain text, never the raw <a>).
 */
function renderRuns(runs: TextRun[]): ReactNode {
  return runs.map((run, index) => <Fragment key={index}>{renderMarked(run)}</Fragment>);
}

/** The inline code run class (the token-driven inline styling). */
const INLINE_CODE_CLASS =
  "bg-(--docblocks-inline-code-background) rounded-(--docblocks-radius) p-(--docblocks-inline-code-padding)";

/** The link mark class (the link color token). */
const LINK_CLASS = "text-(--docblocks-link-color)";

/** The link's href over the public contract (the unsafe stand is none —
 *  the text renders plain). */
const linkHrefOf = (run: TextRun): string | undefined =>
  run.marks.link !== undefined && isSafeLinkHref(run.marks.link.href) ? run.marks.link.href : undefined;

/** One run: the exclusive code mark renders alone; the rest nest. */
function renderMarked(run: TextRun): ReactNode {
  const { marks } = run;

  if (marks.mention !== undefined) {
    return (
      <span data-slot="docblocks/mention" data-mention-kind={marks.mention.kind} contentEditable={false}>
        {marks.mention.label}
      </span>
    );
  }

  if (marks.code === true) return <code className={INLINE_CODE_CLASS}>{run.text}</code>;

  let node: ReactNode = run.text;
  const linkHref = linkHrefOf(run);
  if (linkHref !== undefined) node = <a href={linkHref} className={LINK_CLASS}>{node}</a>;
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
export { INLINE_CODE_CLASS, LINK_CLASS };
