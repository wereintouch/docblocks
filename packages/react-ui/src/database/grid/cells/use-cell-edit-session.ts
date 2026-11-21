/**
 * The cell's edit session's state machine (the text / number's draft + the
 * datetime's draft): the open-time baseline (the deferred commit's pin),
 * the deferred close's commit over the grid's teardown, and the cancel /
 * repeat / no-op's guards (the close stands no double write).
 */
import { useEffect, useRef, useState } from "react";

import { parseCellValue } from "../../bridge";
import type { BridgeColumn } from "../../bridge";
import { dateOnly, formatCellDateTime } from "../utils";

/** The session's inputs (the cell's props' stand over the draft's state). */
interface CellEditSessionParams {
  editing: boolean;
  isText: boolean;
  isNumber: boolean;
  isDateTime: boolean;
  rawValue: string;
  revision: string | undefined;
  column: BridgeColumn;
  onChange: (value: unknown, expectedRevision?: string) => void;
  onEditEnd: () => void;
}

/** The cell's edit session (the draft's state machine — the hook's stand). */
function useCellEditSession({
  editing,
  isText,
  isNumber,
  isDateTime,
  rawValue,
  revision,
  column,
  onChange,
  onEditEnd,
}: CellEditSessionParams) {
  // The text / number's draft stands from the value at the session's open
  // (like the datetime's own stand below): the grid's session teardown — the
  // outside press, the other cell's press — drops the `editing` prop before
  // the input's blur stands (the input unmounts with the session), so the
  // close commits the draft on the teardown itself (the cancel / the
  // repeat guards keep the no-write + the double stand a no-write).
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const textCancelledRef = useRef(false);
  const textSettledRef = useRef(false);
  // The draft's open stand (the deferred commit's pin + the no-write's
  // guard): the mid-session's value changes re-baseline the grid's
  // revision map (the peer's commit over the refetch), so the close's
  // unchanged test + the CAS stand the open-time value + revision — the
  // stale pin's rejection stands the conflict, not a silent overwrite.
  const openValueRef = useRef<string | null>(null);
  const openDateRef = useRef<Date | null>(null);
  const openRevisionRef = useRef<string | undefined>(undefined);

  // A grid-initiated edit (a newly inserted row) uses the same draft and
  // revision initialization as the double-press entry.
  useEffect(() => {
    if (!editing || (!isText && !isNumber) || openValueRef.current !== null) return;
    textCancelledRef.current = false;
    textSettledRef.current = false;
    openValueRef.current = rawValue;
    openRevisionRef.current = revision;
    setTextDraft(rawValue);
  }, [editing]);

  /** The draft's close commit (the single commit path — the blur and the
   * external teardown both end the session, the session's end commits):
   * the parse's invalid stand no commit, the negative's reject stand no
   * commit, the unchanged value stand no commit (no bridge call, no
   * refetch, no no-op undo entry). The unchanged test + the CAS stand the
   * open-time stand (the mid-session's peer's commit stands no clobber). */
  const commitTextDraft = () => {
    const draft = textDraft;
    if (draft === null) return;
    const result = parseCellValue(isNumber ? "number" : "text", draft);
    if (result.ok === false) return;
    const parsed = result.value;
    const rejected = isNumber && column.allowNegative === false && parsed !== null && Number(parsed) < 0;
    if (rejected) return;
    if (draft === openValueRef.current) return;
    onChange(parsed, openRevisionRef.current);
  };

  /** The Escape's cancel: the session closes without a commit (no write
   * over the wire). */
  const cancelTextDraft = () => {
    textCancelledRef.current = true;
    onEditEnd();
  };

  // The external teardown's commit stand (the text / the number — the
  // datetime's own stand below): the grid's session clear (the outside
  // press, the other cell's press) drops the `editing` prop before the
  // input's blur stands, so the draft commits on the teardown itself.
  // The draft + the value stand as of the flip's render: a later draft
  // change is impossible (the input unmounts with the close).
  useEffect(() => {
    if (editing) return;
    if (textDraft === null || textCancelledRef.current || textSettledRef.current) return;
    textSettledRef.current = true;
    commitTextDraft();
  }, [editing]);

  // The datetime's drafts stand from the value at the session's open (the
  // close commits; the in-flight draft never touches the consumer state and
  // stands the mid-session value changes — the picker session's own data
  // until the release). The close's keys stand: the Enter commits the draft
  // (the date + the time as set) and closes, the Escape cancels (the
  // draft's drop — no write over the wire), the close (the trigger's / the
  // outside press / the session's teardown) commits.
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [draftTime, setDraftTime] = useState<string | null>(null);

  const commitDateTime = () => {
    const committed = draftDate === null ? null : dateOnly(draftDate);
    if (draftTime !== null && committed !== null) {
      const [hours, minutes, seconds] = draftTime.split(":");
      committed.setHours(Number(hours), Number(minutes), Number(seconds));
    }
    // A no-op close (the draft stands the OPEN-time value) stands no
    // commit: the peer's mid-session commit stands no clobber over the
    // fresh value.
    if ((committed?.getTime() ?? null) === (openDateRef.current?.getTime() ?? null)) return;
    const iso = formatCellDateTime(committed);
    // A repeat close (the popover's own dispatch after the teardown stand)
    // re-emits the same ISO — the guard (per session: the open resets it)
    // keeps it a no-write.
    if (iso === committedIsoRef.current) return;
    committedIsoRef.current = iso;
    onChange(iso, openRevisionRef.current);
  };

  // The external teardown's commit stand: the grid's session clear (the
  // outside press, the other cell's press) drops the popover's `open` prop
  // without the radix's close callback (the popover unmounts before its
  // deferred dispatch), so the deferred close commit never stands — the
  // cell commits the draft on the teardown itself (the no-op + repeat
  // guards above keep the double stand a no-write).
  const sessionStoodOpenRef = useRef(false);
  const closeCommittedRef = useRef(false);
  const committedIsoRef = useRef<string | null | undefined>(undefined);
  // The Escape's cancel stand (the draft's drop — no write over the wire):
  // the flag guards the close's commit stands out (the session's close
  // commits otherwise — the close's contract).
  const dateTimeCancelledRef = useRef(false);
  useEffect(() => {
    if (!isDateTime) return;
    if (editing) {
      sessionStoodOpenRef.current = true;
      closeCommittedRef.current = false;
      dateTimeCancelledRef.current = false;
      // The repeat-commit guard stands per session: a later session may
      // legitimately re-commit an earlier ISO (the value moved away and
      // back), so the open resets it.
      committedIsoRef.current = undefined;
      return;
    }
    if (!sessionStoodOpenRef.current || closeCommittedRef.current || dateTimeCancelledRef.current) return;
    sessionStoodOpenRef.current = false;
    commitDateTime();
  }, [editing]);

  return {
    textDraft,
    setTextDraft,
    commitTextDraft,
    cancelTextDraft,
    textCancelledRef,
    textSettledRef,
    openValueRef,
    openDateRef,
    openRevisionRef,
    draftDate,
    setDraftDate,
    draftTime,
    setDraftTime,
    commitDateTime,
    closeCommittedRef,
    dateTimeCancelledRef,
  };
}

export { useCellEditSession };
