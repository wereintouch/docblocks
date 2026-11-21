/**
 * The multi-line text's edit stand (the floating editor over the cell —
 * a portaled layer): the caret's seat over the session's open, the
 * draft's commit over the close (the popover's own close stand), the
 * Escape's cancel (no write over the wire).
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../shared/ui/Popover";
import { Textarea } from "../../../shared/ui/Textarea";
import { preventDefault } from "../../../shared/utils";

interface DatabaseCellTextProps {
  /** The cell's box (the popover's trigger's child). */
  cell: ReactNode;
  editing: boolean;
  textDraft: string | null;
  setTextDraft: (draft: string) => void;
  commitTextDraft: () => void;
  cancelTextDraft: () => void;
  textCancelledRef: { current: boolean };
  textSettledRef: { current: boolean };
  onEditEnd: () => void;
}

function DatabaseCellText({
  cell,
  editing,
  textDraft,
  setTextDraft,
  commitTextDraft,
  cancelTextDraft,
  textCancelledRef,
  textSettledRef,
  onEditEnd,
}: DatabaseCellTextProps) {
  // The multi-line edit's caret seat (the autoFocus's start seat): the
  // session's open focuses the editor and seats the caret at the value's
  // end (the edit stands over the existing text's tail). The seat stands
  // the textarea's ref callback (the portal's content attaches after the
  // commit's effects — a commit-time effect stands the null ref out), the
  // element's identity keeps the re-renders' re-focus out (the typing's
  // caret is never moved), the close's reset stands the next open's
  // re-seat.
  const multiLineSeatRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) multiLineSeatRef.current = null;
  }, [editing]);
  const multiLineRefCallback = (el: HTMLTextAreaElement | null) => {
    if (el !== null && editing && multiLineSeatRef.current !== el) {
      multiLineSeatRef.current = el;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  };

  // The multi-line text's edit stand (the text's cell): the double press
  // opens the floating editor over the cell (a portaled layer: the
  // editor's top edge stands a few px over the
  // cell's top edge, the width stands the cell's, the 6-row's box stands
  // over the rows below — the scroller's clip is out, the rows stand no
  // shift). The opaque stand (the popover's background) keeps the
  // covered rows out of the sight. The Enter stands the soft break (the
  // raw \n — no commit), the close (the real blur / the outside press /
  // the session's teardown) commits the draft in one updateRow, the
  // Escape cancels (no write — the content's onEscapeKeyDown keeps the
  // radix's own close commit out).
  const multiOnOpenChange = (open: boolean) => {
    if (!open) {
      // The popover's own close (the real blur / the outside press)
      // commits the draft over its own stand; the session's teardown
      // (the other cell's / the outside press over the grid's pointer
      // model) commits over the teardown's effect — the settled ref
      // keeps the repeat commit a no-write.
      if (!textCancelledRef.current) {
        textSettledRef.current = true;
        commitTextDraft();
      }
      onEditEnd();
    }
  };
  const onMultiChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => setTextDraft(event.target.value);
  const onMultiKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") cancelTextDraft();
  };

  return (
    <Popover open={editing} onOpenChange={multiOnOpenChange}>
      <PopoverTrigger asChild>{cell}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        // The editor's top edge stands the cell's top edge over (the box
        // opens over the row's top): the cell's 32px's height + the 8px's
        // stand, the negative offset over the anchor's bottom edge.
        sideOffset={-40}
        onEscapeKeyDown={preventDefault}
        className="w-(--radix-popover-trigger-width) rounded-md border border-border bg-popover p-0 shadow-md ring-0"
      >
        <Textarea
          data-slot="docblocks/database-cell-multiline"
          ref={multiLineRefCallback}
          rows={6}
          className="
            resize-none scrollbar-thin [scrollbar-color:var(--border)_transparent] overflow-y-auto border-border
            bg-transparent px-2.75 py-1.75 shadow-none select-text
            focus-visible:ring-0
            md:text-base
          "
          value={textDraft ?? ""}
          onChange={onMultiChange}
          onBlur={onEditEnd}
          onKeyDown={onMultiKeyDown}
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatabaseCellText };
