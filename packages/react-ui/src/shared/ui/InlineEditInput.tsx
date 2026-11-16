/**
 * The inline edit's input (the document meta's inline editors — the
 * header's title / the attributes panel's rows): the focus with the caret
 * seated at the end (no select-all) on mount, the commit on the blur /
 * the Enter (one write), the Escape cancels without a write (the guard
 * stops the blur's commit over the unmount).
 */
import { useEffect, useRef } from "react";

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
  selectOnMount,
  onCommit,
  onCancel,
}: InlineEditInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);
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
      placeholder={placeholder}
      defaultValue={initial}
      className={className}
      onChange={rearm}
      onBlur={onInputBlur}
      onKeyDown={onInputKeyDown}
    />
  );
}

export { InlineEditInput };
export type { InlineEditInputProps };
