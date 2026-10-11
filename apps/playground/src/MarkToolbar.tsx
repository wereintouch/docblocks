import { markToggleAction, useBlock, useDoc, useSelection } from "docblocks-react-ui";
import type { FormatMark } from "docblocks-react-ui";

/** The marks the toolbar toggles, in display order. */
const MARKS: { mark: FormatMark; label: string }[] = [
  { mark: "bold", label: "B" },
  { mark: "italic", label: "I" },
  { mark: "underline", label: "U" },
  { mark: "strike", label: "S" },
  { mark: "code", label: "code" },
];

/**
 * The harness's mark toolbar: a row of toggle buttons built on the public
 * hooks and `markToggleAction` (a consumer-side component, not a package
 * component). A text-kind range selection inside a non-code block enables
 * the row; a button is active when every run of the selected range carries
 * the mark, and a click applies set/unset in one transaction. The selected
 * block's snapshot is subscribed so a mark toggle (local or remote) refresh
 * the active states without a selection change.
 */
function MarkToolbar({ client }: { client: "a" | "b" }) {
  const doc = useDoc();
  const selection = useSelection();

  const textSelection =
    selection.kind === "text"
      ? {
          blockId: selection.from.blockId,
          from: selection.from.offset,
          to: selection.to?.offset ?? selection.from.offset,
        }
      : null;

  // The selected block's snapshot: mark-only changes refresh the row
  // (core rejects marks on code blocks, so the row is disabled there).
  const selectedBlock = useBlock(textSelection?.blockId ?? "");
  const disabled =
    textSelection === null ||
    textSelection.from === textSelection.to ||
    (selectedBlock !== undefined && selectedBlock.type === "code");

  const onToggle = (mark: FormatMark) => {
    if (disabled) return;
    const { blockId, from, to } = textSelection!;
    const action = markToggleAction(doc, blockId, from, to, mark);
    doc.transact(() => {
      if (action === "unset") doc.unsetMark(blockId, from, to, mark);
      else doc.setMark(blockId, from, to, { type: mark });
    });
  };

  return (
    <div
      data-testid={`marktoolbar-${client}`}
      style={{ display: "flex", gap: 4, padding: "4px 8px", borderBottom: "1px solid #ccc" }}
    >
      {MARKS.map(({ mark, label }) => {
        const active =
          !disabled &&
          markToggleAction(doc, textSelection!.blockId, textSelection!.from, textSelection!.to, mark) === "unset";
        return (
          <button
            key={mark}
            type="button"
            data-testid={`markbtn-${client}-${mark}`}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onToggle(mark)}
            style={{
              padding: "2px 8px",
              fontSize: 12,
              fontWeight: mark === "bold" ? 700 : 400,
              fontStyle: mark === "italic" ? "italic" : "normal",
              textDecoration: mark === "underline" ? "underline" : mark === "strike" ? "line-through" : "none",
              fontFamily: mark === "code" ? "monospace" : "inherit",
              background: active ? "#dbeafe" : "#f6f8fa",
              opacity: disabled ? 0.4 : 1,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export { MarkToolbar };
