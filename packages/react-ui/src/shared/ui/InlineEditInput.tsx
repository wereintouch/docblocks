/**
 * The inline edit's input (the document meta's inline editors — the
 * header's title / the attributes panel's rows): the focus with the caret
 * seated at the end (no select-all) on mount, the commit on the blur /
 * the Enter (one write), the Escape cancels without a write (the guard
 * stops the blur's commit over the unmount).
 *
 * The seed's reseed over an open edit: the incoming value may change
 * while the field stands (the built-in document path — a peer's write, a
 * command — or the consumer's own read, e.g. the description's). A
 * PRISTINE field (the user has not typed away from the seed) follows the
 * incoming value, the caret kept in place; a typed draft stands (the
 * user's text is never clobbered mid-edit — the input wins until the
 * commit or the cancel).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Input } from "./Input";

interface InlineEditInputProps {
  /** The value the edit starts from (the field's seed). */
  initial: string;
  /** The field's accessible name. */
  ariaLabel: string;
  /** The structural data-slot of the field. */
  slot: string;
  className?: string;
  /** The field's placeholder (the empty value's stand). */
  placeholder?: string;
  /** The invalid stand (the commit's typed error's keep — the field's
   *  `aria-invalid`'s destructive frame over the open stand). */
  invalid?: boolean;
  /** The field's look: the standard's form stand (the default — the
   *  header / the portaled forms) or the row's inline stand (the panel's
   *  flat field over the row's zone — the focus's border stand only). */
  variant?: "default" | "inline";
  /** The mount's select-all (the rename's replace stand — the default
   *  stands the caret's end seat). */
  selectOnMount?: boolean;
  /** The blur / Enter commit (one write). */
  onCommit: (value: string) => void;
  /** The Escape cancel (no write). */
  onCancel: () => void;
}

function InlineEditInput({
  initial,
  ariaLabel,
  slot,
  className,
  placeholder,
  invalid,
  variant,
  selectOnMount,
  onCommit,
  onCancel,
}: InlineEditInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);
  // The controlled value: the seed's mirror (the reseed's stand) with the
  // user's typed draft over it.
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  valueRef.current = value;
  // The last incoming value the field was seeded with (the reseed's
  // comparison — the draft equals it while the user has not typed).
  const seedRef = useRef(initial);
  // The caret's offset over a reseed (the controlled write's default
  // moves it to the end; the stand keeps the user's position).
  const caretRef = useRef<number | null>(null);
  // The select's flag's ref (the mount effect's dep-free stand — the
  // field's remount per edit is the re-seed's stand).
  const selectRef = useRef(selectOnMount);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    if (selectRef.current) {
      // The rename's replace stand: the value's whole selection (a
      // first keystroke would replace it).
      input.select();
      return;
    }
    // The caret seats at the end (the edit continues the value — a
    // select-all would replace it on the first keystroke).
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  useEffect(() => {
    if (initial === seedRef.current) return;
    const previous = seedRef.current;
    seedRef.current = initial;
    // The typed draft wins: the input's text is not clobbered mid-edit.
    if (valueRef.current !== previous) return;
    const input = inputRef.current;
    caretRef.current = input !== null && document.activeElement === input ? input.selectionStart : null;
    setValue(initial);
  }, [initial]);

  // The caret's stand over the reseed (the controlled value's write moves
  // it to the end by the browser's default).
  useLayoutEffect(() => {
    const caret = caretRef.current;
    caretRef.current = null;
    const input = inputRef.current;
    if (caret === null || input === null) return;
    const offset = Math.min(caret, input.value.length);
    input.setSelectionRange(offset, offset);
  }, [value]);

  const commit = (value: string): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  };
  // The re-type's re-arm: the guard is the double-fire's stand (the
  // Enter's commit + the unmount's blur) — the open stand's re-type (the
  // invalid target's keep) arms the next commit.
  const rearm = (): void => {
    committedRef.current = false;
  };

  const onInputBlur = (event: React.FocusEvent<HTMLInputElement>) => commit(event.target.value);
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      // The guard stops the blur's commit (the unmount's blur).
      committedRef.current = true;
      onCancel();
    }
  };

  return (
    <Input
      ref={inputRef}
      data-slot={slot}
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      variant={variant}
      placeholder={placeholder}
      value={value}
      className={className}
      onChange={(event) => {
        setValue(event.target.value);
        rearm();
      }}
      onBlur={onInputBlur}
      onKeyDown={onInputKeyDown}
    />
  );
}

export { InlineEditInput };
export type { InlineEditInputProps };
